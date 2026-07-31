import ts from 'typescript';
import { ValidationMode } from '../runtime/validators.js';
import
{
    BUFFER_LIKE,
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
    mode?   : ValidationMode;
    format? : SerializeFormat;
    to?     : SerializeFormat;
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
        return `( function( input ){ const params = []; ${buildQuerySerializer( type, checker, mode, 'input', '""' )} return params.join( "&" ); })( input )`;
    }

    return buildJsonSerializer( type, checker, mode, '', 'input' );
}

function buildJsonSerializer(
    type    : ts.Type,
    checker : ts.TypeChecker,
    mode    : ValidationMode,
    path    : string,
    varName : string
): string
{
    // Peel brands/tags — serialize ignores constraints, walks base
    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        const peeled = peelTaggedIntersection( type, checker );
        const merged = tryMergeObjectTypes( type.types, checker );

        if( merged )
        {
            return buildObjectSerializer( merged.props, merged.indexType, checker, mode, path, varName );
        }

        if( peeled ){ type = peeled.base }
    }

    const flags = typeof type.getFlags === 'function' ? type.getFlags() : ts.TypeFlags.Any;
    const pathLiteral = JSON.stringify( path );

    if( typeof type.isStringLiteral === 'function' && type.isStringLiteral())
    {
        const expected = JSON.stringify( type.value );
        const litCode = `Literal<'${String( type.value ).replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" )}'>`;

        return `( ${varName} === ${expected} ? ${JSON.stringify( JSON.stringify( type.value ))} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( litCode )} ); })() )`;
    }

    if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral())
    {
        const litCode = `Literal<${type.value}>`;

        return `( ${varName} === ${type.value} ? ${JSON.stringify( String( type.value ))} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( litCode )} ); })() )`;
    }

    if( flags & ts.TypeFlags.BooleanLiteral )
    {
        const expected = ( type as any ).intrinsicName === 'true';
        const litCode = `Literal<${expected}>`;

        return `( ${varName} === ${expected} ? ${JSON.stringify( String( expected ))} : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( litCode )} ); })() )`;
    }

    if( flags & ts.TypeFlags.BigIntLiteral )
    {
        const raw = ( type as any ).value;
        const lit = typeof raw === 'object' && raw ? `${raw.negative ? '-' : ''}${raw.base10Value}` : String( raw );

        return JSON.stringify( lit );
    }

    if( flags & ts.TypeFlags.String || flags & ts.TypeFlags.TemplateLiteral )
    {
        return `__tcRuntime.serializeString( ${varName}, ${pathLiteral} )`;
    }

    if( flags & ts.TypeFlags.Number )
    {
        return `( typeof ${varName} === 'number' && !Number.isNaN( ${varName} ) ? String( ${varName} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<number>" ); })() )`;
    }

    if( flags & ts.TypeFlags.Boolean )
    {
        return `( typeof ${varName} === 'boolean' ? ( ${varName} ? 'true' : 'false' ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<boolean>" ); })() )`;
    }

    if( flags & ts.TypeFlags.BigInt )
    {
        return `( typeof ${varName} === 'bigint' ? String( ${varName} ) : ( function(){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<bigint>" ); })() )`;
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
                path,
                varName
            );
        }
    }

    const symbolName = typeSymbolName( type );

    if( symbolName === 'Date' )
    {
        return `__tcRuntime.serializeDate( ${varName}, ${pathLiteral} )`;
    }

    if( symbolName && BUFFER_LIKE.has( symbolName ))
    {
        return `__tcRuntime.serializeBuffer( ${varName}, ${pathLiteral} )`;
    }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
    {
        const typeArgs = ( type as ts.TupleTypeReference ).typeArguments || [];
        const slotVars = typeArgs.map(( _, i ) => `__t${i}` );
        const slotInits = typeArgs.map(( elem, i ) =>
            `const ${slotVars[i]} = ${buildJsonSerializer( elem, checker, mode, `${path}[${i}]`, `${varName}[${i}]` )};`
        ).join( ' ' );
        const joined = slotVars.join( ` + "," + ` );

        return `( function(){ if( !Array.isArray( ${varName} ) || ${varName}.length !== ${typeArgs.length} ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Tuple<${typeArgs.length}>" ); } ${slotInits} return "[" + ${joined} + "]"; })()`;
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        const typeArgs = typeof checker.getTypeArguments === 'function' ? checker.getTypeArguments( type as ts.TypeReference ) : [];
        const elemType = typeArgs[0] || ( { getFlags : () => ts.TypeFlags.Any } as any );
        const elemSer = buildJsonSerializer( elemType, checker, mode, path + '[]', 'item' );

        return `__tcRuntime.serializeArray( ${varName}, item => ${elemSer}, ${pathLiteral} )`;
    }

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        const label = unionExpectedLabel( type, checker );
        const tagged = tryTaggedUnionTypes( type.types, checker );

        if( tagged )
        {
            const cases = tagged.arms.map( arm =>
                `case ${JSON.stringify( arm.tag )}: return ${buildJsonSerializer( arm.type, checker, mode, path, varName )};`
            ).join( ' ' );

            return `( function( val ){ switch( val[${JSON.stringify( tagged.key )}] ){ ${cases} default: throw new __tcRuntime.SerializationError( ${pathLiteral}, ${JSON.stringify( label )} ); } })( ${varName} )`;
        }

        const armFns = type.types.map( arm =>
            `( val ) => ${buildJsonSerializer( arm, checker, mode, path, 'val' )}`
        ).join( ', ' );

        return `__tcRuntime.serializeUnion( ${varName}, ${pathLiteral}, ${JSON.stringify( label )}, [ ${armFns} ] )`;
    }

    const indexType = stringIndexType( type, checker );
    const props = mapStructuralProps( type, checker );

    return buildObjectSerializer( props, indexType, checker, mode, path, varName );
}

function buildObjectSerializer(
    props     : { name: string, type: ts.Type, isOptional: boolean }[],
    indexType : ts.Type | undefined,
    checker   : ts.TypeChecker,
    mode      : ValidationMode,
    path      : string,
    varName   : string
): string
{
    const pathLiteral = JSON.stringify( path );
    const declaredPropNames = props.map( p => p.name );
    const statements: string[] = [];
    statements.push( `if( typeof obj !== 'object' || obj === null || Array.isArray( obj ) ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "Type<Object>" ); }` );
    statements.push( `let parts = [];` );

    if( indexType || mode === 'strict' || mode === 'relaxed' )
    {
        statements.push( `const __keys = new Set( ${JSON.stringify( declaredPropNames )} );` );
    }

    for( const prop of props )
    {
        const valAccess = safePropAccess( 'obj', prop.name );
        const propSer = buildJsonSerializer( prop.type, checker, mode, path ? `${path}.${prop.name}` : prop.name, valAccess );

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
        const idxSer = buildJsonSerializer( indexType, checker, mode, path ? `${path}[k]` : '[k]', 'obj[k]' );
        statements.push( `for( const k in obj ){ if( !__keys.has( k ) && obj[k] !== undefined ){ parts.push( JSON.stringify( k ) + ":" + ${idxSer} ); } }` );
    }
    else if( mode === 'strict' )
    {
        statements.push( `for( const k in obj ){ if( !__keys.has( k ) && obj[k] !== undefined ){ throw new __tcRuntime.SerializationError( ${pathLiteral}, "PropertyNotAllowed<" + k + ">" ); } }` );
    }
    else if( mode === 'relaxed' )
    {
        statements.push( `for( const k in obj ){ if( !__keys.has( k ) && obj[k] !== undefined ){ parts.push( JSON.stringify( k ) + ":" + JSON.stringify( obj[k] ) ); } }` );
    }

    statements.push( `return '{' + parts.join( ',' ) + '}';` );

    return `( function( obj ){ ${statements.join( ' ' )} })( ${varName} )`;
}

function leafQueryEncode( expr: string ): string
{
    return `encodeURIComponent( ${expr} == null ? "" : ( ${expr} instanceof Date ? ${expr}.toISOString() : ( typeof ${expr} === "bigint" ? String( ${expr} ) : String( ${expr} ) ) ) )`;
}

function buildQuerySerializer(
    type    : ts.Type,
    checker : ts.TypeChecker,
    mode    : ValidationMode,
    varName : string,
    prefixExpr : string
): string
{
    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        const peeled = peelTaggedIntersection( type, checker );
        const merged = tryMergeObjectTypes( type.types, checker );

        if( merged )
        {
            return buildQueryObject( merged.props, merged.indexType, checker, mode, varName, prefixExpr );
        }

        if( peeled ){ type = peeled.base }
    }

    const flags = typeof type.getFlags === 'function' ? type.getFlags() : ts.TypeFlags.Any;

    if( flags & ts.TypeFlags.Undefined )
    {
        return `if( ${varName} !== undefined ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<undefined>" ); }`;
    }

    if( flags & ts.TypeFlags.Null )
    {
        return `if( ${varName} !== null ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<null>" ); } params.push( encodeURIComponent( ${prefixExpr} ) + "=" );`;
    }

    if( flags & ( ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean | ts.TypeFlags.BigInt |
        ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral | ts.TypeFlags.BigIntLiteral ))
    {
        return `params.push( encodeURIComponent( ${prefixExpr} ) + "=" + ${leafQueryEncode( varName )} );`;
    }

    const symbolName = typeSymbolName( type );

    if( symbolName === 'Date' )
    {
        return `params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( ${varName} instanceof Date ? ${varName}.toISOString() : String( ${varName} ) ) );`;
    }

    if( symbolName && BUFFER_LIKE.has( symbolName ))
    {
        return `params.push( encodeURIComponent( ${prefixExpr} ) + "=" + encodeURIComponent( Buffer.from( ${varName} ).toString( "base64" ) ) );`;
    }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
    {
        const typeArgs = ( type as ts.TupleTypeReference ).typeArguments || [];
        const parts = typeArgs.map(( elem, i ) =>
            buildQuerySerializer( elem, checker, mode, `${varName}[${i}]`, `(${prefixExpr}) + "[${i}]"` )
        );

        return `if( !Array.isArray( ${varName} ) || ${varName}.length !== ${typeArgs.length} ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Tuple<${typeArgs.length}>" ); } ${parts.join( ' ' )}`;
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        const typeArgs = typeof checker.getTypeArguments === 'function' ? checker.getTypeArguments( type as ts.TypeReference ) : [];
        const elemType = typeArgs[0] || ( { getFlags : () => ts.TypeFlags.Any } as any );
        const elemCode = buildQuerySerializer( elemType, checker, mode, 'item', `(${prefixExpr}) + "[]"` );

        return `if( !Array.isArray( ${varName} ) ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, "Type<Array>" ); } for( const item of ${varName} ){ ${elemCode} }`;
    }

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        const label = unionExpectedLabel( type, checker );
        const tagged = tryTaggedUnionTypes( type.types, checker );

        if( tagged )
        {
            const cases = tagged.arms.map( arm =>
                `case ${JSON.stringify( arm.tag )}: { ${buildQuerySerializer( arm.type, checker, mode, varName, prefixExpr )} break; }`
            ).join( ' ' );

            return `switch( ${varName}[${JSON.stringify( tagged.key )}] ){ ${cases} default: throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( label )} ); }`;
        }

        // Query arms mutate params; serializeUnion returns JSON strings — keep try/catch with shared label.
        return `{ let _ok = false; ${type.types.map(( arm, i ) => `if( !_ok ){ try { ${buildQuerySerializer( arm, checker, mode, varName, prefixExpr )} _ok = true; } catch( _qe${i} ) {} }` ).join( ' ' )} if( !_ok ){ throw new __tcRuntime.SerializationError( ${prefixExpr}, ${JSON.stringify( label )} ); } }`;
    }

    const indexType = stringIndexType( type, checker );
    const props = mapStructuralProps( type, checker );

    return buildQueryObject( props, indexType, checker, mode, varName, prefixExpr );
}

function buildQueryObject(
    props      : { name: string, type: ts.Type, isOptional: boolean }[],
    indexType  : ts.Type | undefined,
    checker    : ts.TypeChecker,
    mode       : ValidationMode,
    varName    : string,
    prefixExpr : string
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
        const body = buildQuerySerializer( prop.type, checker, mode, access, childPrefix );

        if( prop.isOptional )
        {
            statements.push( `if( ${access} !== undefined ){ ${body} }` );
        }
        else
        {
            statements.push( body );
        }
    }

    if( indexType )
    {
        const idxBody = buildQuerySerializer( indexType, checker, mode, `${varName}[k]`, `(${prefixExpr}) === "" ? k : (${prefixExpr}) + "[" + k + "]"` );
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
