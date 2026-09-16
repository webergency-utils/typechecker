import ts from 'typescript';
import { ValidationMode } from '../runtime/validators.js';
import
{
    BUFFER_LIKE,
    constraintTagNames,
    enumMemberTypes,
    isNativeEnumType,
    mapStructuralProps,
    peelTaggedIntersection,
    safePropAccess,
    stringIndexType,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
    typeSymbolName
}
    from './type-helpers.js';

export type SerializationMode = ValidationMode;
export type SerializeFormat = 'json' | 'query';

export interface SerializerGeneratorOptions
{
    mode?   : ValidationMode
    format? : SerializeFormat
    to?     : SerializeFormat
}

function minifyTypeString( str: string ): string
{
    return str
        .replace( /\{\s+/g, '{' )
        .replace( /\s+\}/g, '}' )
        .replace( /;\s*\}/g, '}' )
        .replace( /;\s+/g, ',' )
        .replace( /:\s+/g, ':' )
        .replace( /\s+\|\s+/g, '|' );
}

function unionExpectedLabel( type: ts.Type, checker: ts.TypeChecker ): string
{
    const aliasName = type.aliasSymbol && typeof type.aliasSymbol.getName === 'function'
        ? type.aliasSymbol.getName()
        : undefined;
    const name = aliasName || typeSymbolName( type );

    if( name && !name.startsWith( '__' ) && /^[A-Za-z_][A-Za-z0-9_]*$/.test( name ))
    {
        return `Type<${name}>`;
    }

    try
    {
        return `Type<${minifyTypeString( checker.typeToString( type ))}>`;
    }
    catch
    {
        return 'Type<Union>';
    }
}

function bindTransformed(
    varName  : string,
    pathExpr : string,
    kind     : string,
    tags     : string[],
    body     : ( v: string ) => string
): string
{
    return `( function(){ const __sv = __tcRuntime.applySerializeTransform( ${varName}, ${pathExpr}, transform, ${JSON.stringify( kind )}, ${JSON.stringify( tags )}, input ); return ${body( '__sv' )}; })()`;
}

function bindTransformedStmt(
    varName  : string,
    pathExpr : string,
    kind     : string,
    tags     : string[],
    stmt     : ( v: string ) => string
): string
{
    return `{ const __sv = __tcRuntime.applySerializeTransform( ${varName}, ${pathExpr}, transform, ${JSON.stringify( kind )}, ${JSON.stringify( tags )}, input ); ${stmt( '__sv' )} }`;
}

export function generateSerializerCode(
    type        : ts.Type,
    checker     : ts.TypeChecker,
    options     : SerializerGeneratorOptions = {}
): string
{
    const mode = options.mode || 'strip';
    const format = options.format || options.to || 'json';

    if( format === 'query' )
    {
        return `( function(){ const params = []; ${buildQuerySerializer( type, checker, mode, 'input', '""', new Set())} return params.join( "&" ); })()`;
    }

    return buildJsonSerializer( type, checker, mode, '""', 'input', new Set());
}

function buildJsonSerializer(
    type     : ts.Type,
    checker  : ts.TypeChecker,
    mode     : ValidationMode,
    pathExpr : string,
    varName  : string,
    visited  : Set<number> = new Set()
): string
{
    const typeId = ( type as any ).id;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId ))
        {
            const label = unionExpectedLabel( type, checker );
            throw new Error( `[Webergency] Recursive/cyclic type ${label} is not supported by ahead-of-time serializer codegen; use assert/validate instead.` );
        }

        visited.add( typeId );
    }

    try
    {
        // Peel brands/tags — serialize ignores constraints, walks base; tags feed ctx.tags.
        let tags: string[] = [];

        if( typeof type.isIntersection === 'function' && type.isIntersection())
        {
            const peeled = peelTaggedIntersection( type, checker );
            const merged = tryMergeObjectTypes( type.types, checker );

            if( merged )
            {
                return buildObjectSerializer( merged.props, merged.indexType, checker, mode, pathExpr, varName, visited );
            }

            if( peeled )
            {
                tags = constraintTagNames( peeled.constraints );
                type = peeled.base;
            }
        }

        const flags = typeof type.getFlags === 'function' ? type.getFlags() : ts.TypeFlags.Any;
        const pathLiteral = pathExpr;

        // Match validators.any / parse passthrough — emit JSON for whatever value is there.
        if( flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown )
        {
            return bindTransformed( varName, pathLiteral, 'Object', tags, v => `__tcRuntime.serializeAny( ${v} )` );
        }

        if( typeof type.isStringLiteral === 'function' && type.isStringLiteral())
        {
            const strType = type as ts.StringLiteralType;
            const expected = JSON.stringify( strType.value );
            const litCode = `Literal<'${String( strType.value ).replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" )}'>`;

            return bindTransformed( varName, pathLiteral, 'literal', tags, v =>
                `( ${v} === ${expected} ? ${JSON.stringify( JSON.stringify( strType.value ))} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( litCode )} ); })() )`
            );
        }

        if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral())
        {
            const numType = type as ts.NumberLiteralType;
            const litCode = `Literal<${numType.value}>`;

            return bindTransformed( varName, pathLiteral, 'literal', tags, v =>
                `( ${v} === ${numType.value} ? ${JSON.stringify( String( numType.value ))} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( litCode )} ); })() )`
            );
        }

        if( flags & ts.TypeFlags.BooleanLiteral )
        {
            const expected = ( type as any ).intrinsicName === 'true';
            const litCode = `Literal<${expected}>`;

            return bindTransformed( varName, pathLiteral, 'literal', tags, v =>
                `( ${v} === ${expected} ? ${JSON.stringify( String( expected ))} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( litCode )} ); })() )`
            );
        }

        if( flags & ts.TypeFlags.BigIntLiteral )
        {
            const raw = ( type as any ).value;
            const lit = typeof raw === 'object' && raw ? `${raw.negative ? '-' : ''}${raw.base10Value}` : String( raw );

            return JSON.stringify( lit );
        }

        if( flags & ts.TypeFlags.String || flags & ts.TypeFlags.TemplateLiteral )
        {
            return bindTransformed( varName, pathLiteral, 'string', tags, v => `__tcRuntime.serializeString( ${v}, ${pathLiteral} )` );
        }

        if( flags & ts.TypeFlags.Number )
        {
            return bindTransformed( varName, pathLiteral, 'number', tags, v =>
                `( typeof ${v} === 'number' && !Number.isNaN( ${v} ) ? String( ${v} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<number>" ); })() )`
            );
        }

        if( flags & ts.TypeFlags.Boolean )
        {
            return bindTransformed( varName, pathLiteral, 'boolean', tags, v =>
                `( typeof ${v} === 'boolean' ? ( ${v} ? 'true' : 'false' ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<boolean>" ); })() )`
            );
        }

        if( flags & ts.TypeFlags.BigInt )
        {
            return bindTransformed( varName, pathLiteral, 'bigint', tags, v =>
                `( typeof ${v} === 'bigint' ? String( ${v} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<bigint>" ); })() )`
            );
        }

        if( flags & ts.TypeFlags.Undefined )
        {
            return `( ${varName} === undefined ? 'null' : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<undefined>" ); })() )`;
        }

        if( flags & ts.TypeFlags.Null )
        {
            return `( ${varName} === null ? 'null' : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<null>" ); })() )`;
        }

        if( isNativeEnumType( type ))
        {
            const members = enumMemberTypes( type, checker );

            if( members.length > 0 )
            {
                return buildJsonSerializer(
                    { isUnion : () => true, types : members, getFlags : () => ts.TypeFlags.Union } as any,
                    checker,
                    mode,
                    pathExpr,
                    varName,
                    visited
                );
            }
        }

        const symbolName = typeSymbolName( type );

        if( symbolName === 'Date' )
        {
            return bindTransformed( varName, pathLiteral, 'Date', tags, v => `__tcRuntime.serializeDate( ${v}, ${pathLiteral} )` );
        }

        if( symbolName && BUFFER_LIKE.has( symbolName ))
        {
            return bindTransformed( varName, pathLiteral, 'instance', tags, v => `__tcRuntime.serializeBuffer( ${v}, ${pathLiteral} )` );
        }

        if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
        {
            const typeArgs = ( type as ts.TupleTypeReference ).typeArguments || [];
            const slotVars = typeArgs.map(( _, i ) => `__t${i}` );
            const slotInits = typeArgs.map(( elem, i ) => 
            {
                const childPath = pathExpr === '""' ? `"[" + ${i} + "]"` : `(${pathExpr}) + "[" + ${i} + "]"`;

                return `const ${slotVars[i]} = ${buildJsonSerializer( elem, checker, mode, childPath, `${varName}[${i}]`, visited )};`;
            }).join( ' ' );
            const joined = slotVars.join( ' + "," + ' );

            return `( function(){ if( !Array.isArray( ${varName} ) || ${varName}.length !== ${typeArgs.length} ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Tuple<${typeArgs.length}>" ); } ${slotInits} return "[" + ${joined} + "]"; })()`;
        }

        if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
        {
            const typeArgs = typeof checker.getTypeArguments === 'function' ? checker.getTypeArguments( type as ts.TypeReference ) : [];
            const elemType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const elemPath = pathExpr === '""' ? '"[" + i + "]"' : `(${pathExpr}) + "[" + i + "]"`;
            const elemSer = buildJsonSerializer( elemType, checker, mode, elemPath, 'item', visited );

            return `__tcRuntime.serializeArray( ${varName}, ( item, i ) => ${elemSer}, ${pathLiteral} )`;
        }

        if( typeof type.isUnion === 'function' && type.isUnion())
        {
            const label = unionExpectedLabel( type, checker );
            const tagged = tryTaggedUnionTypes( type.types, checker );

            if( tagged )
            {
                const cases = tagged.arms.map( arm =>
                    `case ${JSON.stringify( arm.tag )}: return ${buildJsonSerializer( arm.type, checker, mode, pathExpr, varName, visited )};`
                ).join( ' ' );

                return `( function( val ){ switch( val && val[${JSON.stringify( tagged.key )}] ){ ${cases} default: throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( label )} ); } })( ${varName} )`;
            }

            const armFns = type.types.map( arm =>
                `( val ) => ${buildJsonSerializer( arm, checker, mode, pathExpr, 'val', visited )}`
            ).join( ', ' );

            return `__tcRuntime.serializeUnion( ${varName}, ${pathLiteral}, ${JSON.stringify( label )}, [ ${armFns} ] )`;
        }

        const indexType = stringIndexType( type, checker );
        const props = mapStructuralProps( type, checker );

        return buildObjectSerializer( props, indexType, checker, mode, pathExpr, varName, visited );
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

function buildObjectSerializer(
    props     : { name : string, type : ts.Type, isOptional : boolean }[],
    indexType : ts.Type | undefined,
    checker   : ts.TypeChecker,
    mode      : ValidationMode,
    pathExpr  : string,
    varName   : string,
    visited?  : Set<number>
): string
{
    const pathLiteral = pathExpr;
    const declaredPropNames = props.map( p => p.name );
    const statements: string[] = [];
    statements.push( `if( typeof obj !== 'object' || obj === null || Array.isArray( obj ) ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<Object>" ); }` );
    statements.push( 'let parts = [];' );

    if( indexType || mode === 'strict' || mode === 'relaxed' )
    {
        statements.push( `const __keys = new Set( ${JSON.stringify( declaredPropNames )} );` );
    }

    for( const prop of props )
    {
        const valAccess = safePropAccess( 'obj', prop.name );
        const childPath = pathExpr === '""'
            ? JSON.stringify( prop.name )
            : `(${pathExpr}) + "." + ${JSON.stringify( prop.name )}`;
        const propSer = buildJsonSerializer( prop.type, checker, mode, childPath, valAccess, visited );

        if( prop.isOptional )
        {
            statements.push( `if( ${valAccess} !== undefined ){ parts.push( ${JSON.stringify( JSON.stringify( prop.name ) + ':' )} + ${propSer} ); }` );
        }
        else
        {
            statements.push( `parts.push( ${JSON.stringify( JSON.stringify( prop.name ) + ':' )} + ${propSer} );` );
        }
    }

    if( indexType )
    {
        const idxPath = pathExpr === '""' ? 'k' : `(${pathExpr}) + "[" + k + "]"`;
        const idxSer = buildJsonSerializer( indexType, checker, mode, idxPath, 'obj[k]', visited );
        statements.push( `for( const k in obj ){ if( !__keys.has( k ) && obj[k] !== undefined ){ parts.push( JSON.stringify( k ) + ":" + ${idxSer} ); } }` );
    }
    else if( mode === 'strict' )
    {
        statements.push( `for( const k in obj ){ if( !__keys.has( k ) && obj[k] !== undefined ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "PropertyNotAllowed<" + k + ">" ); } }` );
    }
    else if( mode === 'relaxed' )
    {
        statements.push( 'for( const k in obj ){ if( !__keys.has( k ) && obj[k] !== undefined ){ parts.push( JSON.stringify( k ) + ":" + JSON.stringify( obj[k] ) ); } }' );
    }

    statements.push( 'return \'{\' + parts.join( \',\' ) + \'}\';' );

    return `( function( obj ){ ${statements.join( ' ' )} })( ${varName} )`;
}

function leafQueryEncode( expr: string ): string
{
    return `encodeURIComponent( ${expr} == null ? "" : ( ${expr} instanceof Date ? ${expr}.toISOString() : ( typeof ${expr} === "bigint" ? String( ${expr} ) : String( ${expr} ) ) ) )`;
}

function buildQuerySerializer(
    type        : ts.Type,
    checker     : ts.TypeChecker,
    mode        : ValidationMode,
    varName     : string,
    prefixExpr  : string,
    visited     : Set<number> = new Set()
): string
{
    const typeId = ( type as any ).id;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId ))
        {
            const label = unionExpectedLabel( type, checker );
            throw new Error( `[Webergency] Recursive/cyclic type ${label} is not supported by ahead-of-time serializer codegen; use assert/validate instead.` );
        }

        visited.add( typeId );
    }

    try
    {
        let tags: string[] = [];

        if( typeof type.isIntersection === 'function' && type.isIntersection())
        {
            const peeled = peelTaggedIntersection( type, checker );
            const merged = tryMergeObjectTypes( type.types, checker );

            if( merged )
            {
                return buildQueryObject( merged.props, merged.indexType, checker, mode, varName, prefixExpr, visited );
            }

            if( peeled )
            {
                tags = constraintTagNames( peeled.constraints );
                type = peeled.base;
            }
        }

        const flags = typeof type.getFlags === 'function' ? type.getFlags() : ts.TypeFlags.Any;

        if( flags & ts.TypeFlags.Any || flags & ts.TypeFlags.Unknown )
        {
            return bindTransformedStmt( varName, prefixExpr, 'Object', tags, v => `__tcRuntime.appendQueryAny( params, ${v}, ${prefixExpr} );` );
        }

        if( flags & ts.TypeFlags.Undefined )
        {
            return `if( ${varName} !== undefined ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<undefined>" ); }`;
        }

        if( flags & ts.TypeFlags.Null )
        {
            return `if( ${varName} !== null ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<null>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" );`;
        }

        if( typeof type.isStringLiteral === 'function' && type.isStringLiteral())
        {
            const strType = type as ts.StringLiteralType;
            const expected = JSON.stringify( strType.value );
            const litCode = `Literal<'${String( strType.value ).replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" )}'>`;

            return bindTransformedStmt( varName, prefixExpr, 'literal', tags, v =>
                `if( ${v} !== ${expected} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( litCode )} ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${v} ) );`
            );
        }

        if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral())
        {
            const numType = type as ts.NumberLiteralType;
            const litCode = `Literal<${numType.value}>`;

            return bindTransformedStmt( varName, prefixExpr, 'literal', tags, v =>
                `if( ${v} !== ${numType.value} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( litCode )} ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( String( ${v} ) ) );`
            );
        }

        if( flags & ts.TypeFlags.BooleanLiteral )
        {
            const expected = ( type as any ).intrinsicName === 'true';
            const litCode = `Literal<${expected}>`;

            return bindTransformedStmt( varName, prefixExpr, 'literal', tags, v =>
                `if( ${v} !== ${expected} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( litCode )} ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + ( ${v} ? "true" : "false" ) );`
            );
        }

        if( flags & ts.TypeFlags.BigIntLiteral )
        {
            const raw = ( type as any ).value;
            const lit = typeof raw === 'object' && raw ? `${raw.negative ? '-' : ''}${raw.base10Value}` : String( raw );

            return `params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${JSON.stringify( lit )} ) );`;
        }

        if( flags & ts.TypeFlags.String || flags & ts.TypeFlags.TemplateLiteral )
        {
            return bindTransformedStmt( varName, prefixExpr, 'string', tags, v =>
                `if( typeof ${v} !== "string" ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<string>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${v} ) );`
            );
        }

        if( flags & ts.TypeFlags.Number )
        {
            return bindTransformedStmt( varName, prefixExpr, 'number', tags, v =>
                `if( typeof ${v} !== "number" || Number.isNaN( ${v} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<number>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( String( ${v} ) ) );`
            );
        }

        if( flags & ts.TypeFlags.Boolean )
        {
            return bindTransformedStmt( varName, prefixExpr, 'boolean', tags, v =>
                `if( typeof ${v} !== "boolean" ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<boolean>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + ( ${v} ? "true" : "false" ) );`
            );
        }

        if( flags & ts.TypeFlags.BigInt )
        {
            return bindTransformedStmt( varName, prefixExpr, 'bigint', tags, v =>
                `if( typeof ${v} !== "bigint" ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<bigint>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( String( ${v} ) ) );`
            );
        }

        const symbolName = typeSymbolName( type );

        if( symbolName === 'Date' )
        {
            return bindTransformedStmt( varName, prefixExpr, 'Date', tags, v =>
                `if( !( ${v} instanceof Date ) || Number.isNaN( ${v}.getTime() ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<Date>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${v}.toISOString() ) );`
            );
        }

        if( symbolName && BUFFER_LIKE.has( symbolName ))
        {
            return bindTransformedStmt( varName, prefixExpr, 'instance', tags, v =>
                `if( !( ${v} instanceof Uint8Array || ( typeof Buffer !== "undefined" && Buffer.isBuffer( ${v} ) ) || ${v} instanceof ArrayBuffer ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<Buffer>" ); } const __b = ${v} instanceof Uint8Array ? ${v} : new Uint8Array( ${v} ); params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( Buffer.from( __b ).toString( "base64" ) ) );`
            );
        }

        if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
        {
            const typeArgs = ( type as ts.TupleTypeReference ).typeArguments || [];
            const parts = typeArgs.map(( elem, i ) =>
                buildQuerySerializer( elem, checker, mode, `${varName}[${i}]`, `(${prefixExpr}) + "[${i}]"`, visited )
            );

            return `if( !Array.isArray( ${varName} ) || ${varName}.length !== ${typeArgs.length} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Tuple<${typeArgs.length}>" ); } ${parts.join( ' ' )}`;
        }

        if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
        {
            const typeArgs = typeof checker.getTypeArguments === 'function' ? checker.getTypeArguments( type as ts.TypeReference ) : [];
            const elemType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const elemCode = buildQuerySerializer( elemType, checker, mode, 'item', `(${prefixExpr}) + "[]"`, visited );

            return `if( !Array.isArray( ${varName} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<Array>" ); } for( const item of ${varName} ){ ${elemCode} }`;
        }

        if( typeof type.isUnion === 'function' && type.isUnion())
        {
            const label = unionExpectedLabel( type, checker );
            const tagged = tryTaggedUnionTypes( type.types, checker );

            if( tagged )
            {
                const cases = tagged.arms.map( arm =>
                    `case ${JSON.stringify( arm.tag )}: { ${buildQuerySerializer( arm.type, checker, mode, varName, prefixExpr, visited )} break; }`
                ).join( ' ' );

                return `switch( ${varName} && ${varName}[${JSON.stringify( tagged.key )}] ){ ${cases} default: throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( label )} ); }`;
            }

            // Query arms mutate params; snapshot params.length before each arm and restore on failure.
            return `{ let _ok = false; ${type.types.map(( arm, i ) =>
                `if( !_ok ){ const _snap${i} = params.length; try { ${buildQuerySerializer( arm, checker, mode, varName, prefixExpr, visited )} _ok = true; } catch( _qe${i} ) { params.length = _snap${i}; } }`
            ).join( ' ' )} if( !_ok ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( label )} ); } }`;
        }

        const indexType = stringIndexType( type, checker );
        const props = mapStructuralProps( type, checker );

        return buildQueryObject( props, indexType, checker, mode, varName, prefixExpr, visited );
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

function buildQueryObject(
    props      : { name : string, type : ts.Type, isOptional : boolean }[],
    indexType  : ts.Type | undefined,
    checker    : ts.TypeChecker,
    mode       : ValidationMode,
    varName    : string,
    prefixExpr : string,
    visited?   : Set<number>
): string
{
    const declared = props.map( p => p.name );
    const statements: string[] = [];
    statements.push( `if( typeof ${varName} !== 'object' || ${varName} === null || Array.isArray( ${varName} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<Object>" ); }` );

    if( indexType || mode === 'strict' || mode === 'relaxed' )
    {
        statements.push( `const __keys = new Set( ${JSON.stringify( declared )} );` );
    }

    for( const prop of props )
    {
        const access = safePropAccess( varName, prop.name );
        const childPrefix = `(${prefixExpr}) === "" ? ${JSON.stringify( prop.name )} : (${prefixExpr}) + ${JSON.stringify( '[' + prop.name + ']' )}`;
        const body = buildQuerySerializer( prop.type, checker, mode, access, childPrefix, visited );

        if( prop.isOptional )
        {
            statements.push( `if( ${access} !== undefined ){ ${body} }` );
        }
        else
        {
            statements.push( `{ ${body} }` );
        }
    }

    if( indexType )
    {
        const idxBody = buildQuerySerializer( indexType, checker, mode, `${varName}[k]`, `(${prefixExpr}) === "" ? k : (${prefixExpr}) + "[" + k + "]"`, visited );
        statements.push( `for( const k in ${varName} ){ if( !__keys.has( k ) && ${varName}[k] !== undefined ){ ${idxBody} } }` );
    }
    else if( mode === 'strict' )
    {
        statements.push( `for( const k in ${varName} ){ if( !__keys.has( k ) && ${varName}[k] !== undefined ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "PropertyNotAllowed<" + k + ">" ); } }` );
    }
    else if( mode === 'relaxed' )
    {
        statements.push( `for( const k in ${varName} ){ if( !__keys.has( k ) && ${varName}[k] !== undefined ){ params.push( encodeURIComponent( (${prefixExpr}) === "" ? k : (${prefixExpr}) + "[" + k + "]" ) + "=" + ${leafQueryEncode( `${varName}[k]` )} ); } }` );
    }

    return statements.join( ' ' );
}
