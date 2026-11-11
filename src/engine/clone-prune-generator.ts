import ts from 'typescript';
import { resolveClassIdentity, type ICustomFunctionScope } from './customFns.js';
import
{
    assertNotTypeParameter,
    bigIntLiteralText,
    BUFFER_LIKE,
    buildTemplateLiteralRegex,
    classifyNullableUnion,
    enumMemberTypes,
    inspectTupleType,
    isBrandOnlyType,
    isConstraintOnlyType,
    isNativeEnumType,
    MergedPropInfo,
    peelTaggedIntersection,
    safePropAccess,
    stripUndefinedFromUnion,
    TemplateIndexInfo,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
    typeSymbolName,
    VERBATIM_CUSTOM_SCOPE
}
    from './type-helpers.js';
import { resolveTypeIr } from './type-ir.js';
import { sortUnionArmsBySpecificity } from './specificity.js';

type Mode = 'clone' | 'prune';

interface RecDef
{
    fnName : string
    type   : ts.Type
}

interface ClassBinding
{
    ctorExpr : string
}

function resolveClassBinding( type: ts.Type, scope: ICustomFunctionScope ): ClassBinding | undefined
{
    const identity = resolveClassIdentity( type );

    if( !identity ){ return undefined }

    const decl = identity.declaration;
    const fromGlobal = decl !== undefined
        && decl.getSourceFile().isDeclarationFile
        && !ts.isExternalModule( decl.getSourceFile());
    const ctorExpr = ( fromGlobal || !decl )
        ? `( globalThis[${JSON.stringify( identity.name )}] )`
        : scope.bind( identity );

    return { ctorExpr };
}

function unwrapTaggedBase( type: ts.Type, checker: ts.TypeChecker, scope: ICustomFunctionScope ): ts.Type
{
    let cur = type;

    while( typeof cur.isIntersection === 'function' && cur.isIntersection())
    {
        const peeled = peelTaggedIntersection( cur, checker, scope );

        if( !peeled || peeled.base === cur ){ break }

        cur = peeled.base;
    }

    return cur;
}

function isImmutableLeaf(
    type    : ts.Type,
    checker : ts.TypeChecker,
    scope   : ICustomFunctionScope,
    seen    : Set<object> = new Set()
): boolean
{
    if( !type || typeof type !== 'object' ){ return true }

    if( seen.has( type )){ return false }

    seen.add( type );
    const walk = unwrapTaggedBase( type, checker, scope );
    const flags = typeof walk.getFlags === 'function' ? walk.getFlags() : 0;

    if(
        flags & (
            ts.TypeFlags.Never |
            ts.TypeFlags.Undefined |
            ts.TypeFlags.Void |
            ts.TypeFlags.Null |
            ts.TypeFlags.String |
            ts.TypeFlags.Number |
            ts.TypeFlags.Boolean |
            ts.TypeFlags.BigInt |
            ts.TypeFlags.ESSymbol |
            ts.TypeFlags.UniqueESSymbol |
            ts.TypeFlags.StringLiteral |
            ts.TypeFlags.NumberLiteral |
            ts.TypeFlags.BooleanLiteral |
            ts.TypeFlags.BigIntLiteral |
            ts.TypeFlags.TemplateLiteral |
            ts.TypeFlags.StringMapping
        )
    )
    {
        return true;
    }

    if( typeof walk.getCallSignatures === 'function' && walk.getCallSignatures().length > 0 )
    {
        return true;
    }

    if( isNativeEnumType( walk ))
    {
        return true;
    }

    if( typeof walk.isUnion === 'function' && walk.isUnion())
    {
        return walk.types.every( arm => isImmutableLeaf( arm, checker, scope, seen ));
    }

    return false;
}

function needsPrune(
    type    : ts.Type,
    checker : ts.TypeChecker,
    scope   : ICustomFunctionScope,
    seen    : Set<object> = new Set()
): boolean
{
    if( !type || typeof type !== 'object' ){ return false }

    if( seen.has( type )){ return true }

    seen.add( type );
    const walk = unwrapTaggedBase( type, checker, scope );

    if( isImmutableLeaf( walk, checker, scope )){ return false }

    const flags = typeof walk.getFlags === 'function' ? walk.getFlags() : 0;

    if( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.NonPrimitive ))
    {
        return false;
    }

    const symName = typeSymbolName( walk );

    if(
        symName === 'Date' ||
        symName === 'URL' ||
        symName === 'RegExp' ||
        symName === 'File' ||
        symName === 'Blob' ||
        symName === 'Promise' ||
        ( symName && BUFFER_LIKE.has( symName ))
    )
    {
        return false;
    }

    if( resolveClassIdentity( walk ) !== undefined ){ return false }

    if( typeof walk.isUnion === 'function' && walk.isUnion())
    {
        return walk.types.some( arm => needsPrune( arm, checker, scope, seen ));
    }

    if( typeof walk.isIntersection === 'function' && walk.isIntersection())
    {
        return walk.types.some( arm => needsPrune( arm, checker, scope, seen ));
    }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( walk ))
    {
        const { typeArgs, restType, suffixTypes } = inspectTupleType( walk, checker );

        return typeArgs.some( t => needsPrune( t, checker, scope, seen ))
            || Boolean( restType && needsPrune( restType, checker, scope, seen ))
            || suffixTypes.some( t => needsPrune( t, checker, scope, seen ));
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( walk ))
    {
        const elem = ( checker as any ).getTypeArguments?.( walk as ts.TypeReference )?.[0]
            || ( walk as ts.TypeReference ).typeArguments?.[0];

        return elem ? needsPrune( elem, checker, scope, seen ) : false;
    }

    if( symName === 'Set' || symName === 'ReadonlySet' )
    {
        const elem = ( checker as any ).getTypeArguments?.( walk as ts.TypeReference )?.[0]
            || ( walk as ts.TypeReference ).typeArguments?.[0];

        return elem ? needsPrune( elem, checker, scope, seen ) : false;
    }

    if( symName === 'Map' || symName === 'ReadonlyMap' )
    {
        const args = ( checker as any ).getTypeArguments?.( walk as ts.TypeReference )
            || ( walk as ts.TypeReference ).typeArguments
            || [];

        return Boolean(( args[0] && needsPrune( args[0], checker, scope, seen )) || ( args[1] && needsPrune( args[1], checker, scope, seen )));
    }

    return true;
}

function buildMatchExpr(
    type    : ts.Type,
    checker : ts.TypeChecker,
    varExpr : string,
    scope   : ICustomFunctionScope,
    hoisted : string[],
    visited : Set<number> = new Set()
): string
{
    const typeId = ( type as any ).id;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId )){ return 'true' }

        visited.add( typeId );
    }

    try
    {
        const walk = unwrapTaggedBase( type, checker, scope );
        const flags = typeof walk.getFlags === 'function' ? walk.getFlags() : ts.TypeFlags.Any;

        if( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown )){ return 'true' }

        if( flags & ts.TypeFlags.Never ){ return 'false' }

        if( flags & ts.TypeFlags.Null ){ return `( ${varExpr} === null )` }

        if( flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Void )){ return `( ${varExpr} === undefined )` }

        if( typeof walk.isStringLiteral === 'function' && walk.isStringLiteral())
        {
            return `( ${varExpr} === ${JSON.stringify( walk.value )} )`;
        }

        if( typeof walk.isNumberLiteral === 'function' && walk.isNumberLiteral())
        {
            return `( ${varExpr} === ${walk.value} )`;
        }

        if( flags & ts.TypeFlags.BooleanLiteral )
        {
            const expected = ( walk as any ).intrinsicName === 'true';

            return `( ${varExpr} === ${expected} )`;
        }

        if( flags & ts.TypeFlags.BigIntLiteral )
        {
            return `( ${varExpr} === ${bigIntLiteralText( walk )}n )`;
        }

        if( flags & ts.TypeFlags.TemplateLiteral )
        {
            const regexStr = buildTemplateLiteralRegex( walk as ts.TemplateLiteralType );
            const reVar = `__re_${hoisted.length}`;
            hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( regexStr )} );` );

            return `( typeof ${varExpr} === "string" && Boolean( ${reVar} ) && __tcRuntime.testRegex( ${reVar}, ${varExpr} ) )`;
        }

        if( flags & ts.TypeFlags.StringMapping )
        {
            const mapping = typeSymbolName( walk );

            if( mapping === 'Uppercase' ){ return `( typeof ${varExpr} === "string" && ${varExpr} === ${varExpr}.toUpperCase() )` }

            if( mapping === 'Lowercase' ){ return `( typeof ${varExpr} === "string" && ${varExpr} === ${varExpr}.toLowerCase() )` }

            if( mapping === 'Capitalize' )
            {
                return `( typeof ${varExpr} === "string" && ( ${varExpr}.length === 0 || ${varExpr}.charAt( 0 ) === ${varExpr}.charAt( 0 ).toUpperCase() ) )`;
            }

            if( mapping === 'Uncapitalize' )
            {
                return `( typeof ${varExpr} === "string" && ( ${varExpr}.length === 0 || ${varExpr}.charAt( 0 ) === ${varExpr}.charAt( 0 ).toLowerCase() ) )`;
            }

            return `( typeof ${varExpr} === "string" )`;
        }

        if( flags & ts.TypeFlags.String ){ return `( typeof ${varExpr} === "string" )` }

        if( flags & ts.TypeFlags.Number ){ return `( typeof ${varExpr} === "number" && !Number.isNaN( ${varExpr} ) )` }

        if( flags & ts.TypeFlags.Boolean ){ return `( typeof ${varExpr} === "boolean" )` }

        if( flags & ts.TypeFlags.BigInt ){ return `( typeof ${varExpr} === "bigint" )` }

        if( flags & ( ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol )){ return `( typeof ${varExpr} === "symbol" )` }

        if( isNativeEnumType( walk ))
        {
            const members = enumMemberTypes( walk, checker );

            if( members.length === 0 ){ return `( typeof ${varExpr} === "number" )` }

            return `( ${members.map( m => buildMatchExpr( m, checker, varExpr, scope, hoisted, visited )).join( ' || ' )} )`;
        }

        const symName = typeSymbolName( walk );

        if( symName === 'Date' ){ return `( ${varExpr} instanceof Date )` }

        if( symName === 'URL' ){ return `( ${varExpr} instanceof URL )` }

        if( symName === 'RegExp' ){ return `( ${varExpr} instanceof RegExp )` }

        if( symName === 'File' ){ return `( ${varExpr} instanceof File )` }

        if( symName === 'Blob' ){ return `( ${varExpr} instanceof Blob )` }

        if( symName === 'Promise' ){ return `( ${varExpr} instanceof Promise )` }

        if( symName === 'Buffer' ){ return `Buffer.isBuffer( ${varExpr} )` }

        if( symName && BUFFER_LIKE.has( symName )){ return `( ${varExpr} instanceof ${symName} )` }

        if( symName === 'Set' || symName === 'ReadonlySet' ){ return `( ${varExpr} instanceof Set )` }

        if( symName === 'Map' || symName === 'ReadonlyMap' ){ return `( ${varExpr} instanceof Map )` }

        if( typeof walk.getCallSignatures === 'function' && walk.getCallSignatures().length > 0 )
        {
            return `( typeof ${varExpr} === "function" )`;
        }

        if( typeof checker.isTupleType === 'function' && checker.isTupleType( walk ))
        {
            const { typeArgs, elementFlags, hasRest, fixedCount, minItems } = inspectTupleType( walk, checker );
            const conds: string[] = [ `Array.isArray( ${varExpr} )`, `${varExpr}.length >= ${minItems}` ];

            if( !hasRest )
            {
                conds.push( `${varExpr}.length <= ${fixedCount}` );
            }

            for( let i = 0; i < fixedCount; i++ )
            {
                const isOpt = ( elementFlags[i] & ts.ElementFlags.Optional ) !== 0;
                const elemT = isOpt ? stripUndefinedFromUnion( typeArgs[i]) : typeArgs[i];
                const elemMatch = buildMatchExpr( elemT, checker, `${varExpr}[${i}]`, scope, hoisted, visited );

                if( isOpt )
                {
                    conds.push( `( ${varExpr}.length <= ${i} || ${varExpr}[${i}] === undefined || ${elemMatch} )` );
                }
                else
                {
                    conds.push( elemMatch );
                }
            }

            return `( ${conds.join( ' && ' )} )`;
        }

        if( typeof checker.isArrayType === 'function' && checker.isArrayType( walk ))
        {
            const elem = ( checker as any ).getTypeArguments?.( walk as ts.TypeReference )?.[0]
                || ( walk as ts.TypeReference ).typeArguments?.[0];

            if( !elem ){ return `Array.isArray( ${varExpr} )` }

            const firstMatch = buildMatchExpr( elem, checker, `${varExpr}[0]`, scope, hoisted, visited );

            return `( Array.isArray( ${varExpr} ) && ( ${varExpr}.length === 0 || ${firstMatch} ) )`;
        }

        if( typeof walk.isUnion === 'function' && walk.isUnion())
        {
            return `( ${walk.types.map( arm => buildMatchExpr( arm, checker, varExpr, scope, hoisted, visited )).join( ' || ' )} )`;
        }

        if( typeof walk.isIntersection === 'function' && walk.isIntersection())
        {
            const merged = tryMergeObjectTypes( walk.types, checker, walk );

            if( merged )
            {
                return buildObjectMatchExpr( merged.props, checker, varExpr, scope, hoisted, visited );
            }

            return `( ${walk.types.filter( t => !isConstraintOnlyType( t, checker ) && !isBrandOnlyType( t, checker )).map( arm => buildMatchExpr( arm, checker, varExpr, scope, hoisted, visited )).join( ' && ' )} )`;
        }

        const cls = resolveClassBinding( walk, scope );

        if( cls )
        {
            return `( ${varExpr} instanceof ${cls.ctorExpr} )`;
        }

        if( flags & ts.TypeFlags.NonPrimitive )
        {
            return `( ${varExpr} !== null && typeof ${varExpr} === "object" )`;
        }

        const ir = resolveTypeIr( walk, checker );

        return buildObjectMatchExpr( ir.getProps(), checker, varExpr, scope, hoisted, visited );
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

function buildObjectMatchExpr(
    props   : readonly MergedPropInfo[],
    checker : ts.TypeChecker,
    varExpr : string,
    scope   : ICustomFunctionScope,
    hoisted : string[],
    visited : Set<number>
): string
{
    const conds: string[] = [ `__tcRuntime.isPlainObject( ${varExpr} )` ];

    for( const p of props )
    {
        const acc = safePropAccess( varExpr, p.name );
        const effType = p.isOptional ? stripUndefinedFromUnion( p.type ) : p.type;
        const propMatch = buildMatchExpr( effType, checker, acc, scope, hoisted, visited );

        if( p.isOptional )
        {
            conds.push( `( !Object.hasOwn( ${varExpr}, ${JSON.stringify( p.name )} ) || ${acc} === undefined || ${propMatch} )` );
        }
        else
        {
            conds.push( `( Object.hasOwn( ${varExpr}, ${JSON.stringify( p.name )} ) && ${propMatch} )` );
        }
    }

    return `( ${conds.join( ' && ' )} )`;
}

function extractArmScoreKeys( type: ts.Type, checker: ts.TypeChecker, scope: ICustomFunctionScope ): string[] | undefined
{
    const walk = unwrapTaggedBase( type, checker, scope );

    if( typeof walk.isIntersection === 'function' && walk.isIntersection())
    {
        const merged = tryMergeObjectTypes( walk.types, checker, walk );

        return merged ? merged.props.map( p => p.name ) : undefined;
    }

    const flags = typeof walk.getFlags === 'function' ? walk.getFlags() : 0;

    if( !( flags & ts.TypeFlags.Object )){ return undefined }

    if( checker.isArrayType( walk ) || checker.isTupleType( walk )){ return undefined }

    const symName = typeSymbolName( walk );

    if(
        symName === 'Date' || symName === 'URL' || symName === 'RegExp' ||
        symName === 'File' || symName === 'Blob' || symName === 'Promise' ||
        symName === 'Set' || symName === 'ReadonlySet' || symName === 'Map' || symName === 'ReadonlyMap' ||
        ( symName && BUFFER_LIKE.has( symName )) ||
        resolveClassIdentity( walk ) !== undefined
    )
    {
        return undefined;
    }

    const ir = resolveTypeIr( walk, checker );
    const props = ir.getProps();

    return props.length > 0 ? props.map( p => p.name ) : undefined;
}

function buildTransform(
    type    : ts.Type,
    checker : ts.TypeChecker,
    mode    : Mode,
    varName : string,
    scope   : ICustomFunctionScope,
    visited : Set<number>,
    hoisted : string[],
    recDefs : Map<number, RecDef>
): string
{
    assertNotTypeParameter( type );

    if( isImmutableLeaf( type, checker, scope ))
    {
        return varName;
    }

    if( mode === 'prune' && !needsPrune( type, checker, scope ))
    {
        return varName;
    }

    const typeId = ( type as any ).id;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId ))
        {
            let def = recDefs.get( typeId );

            if( !def )
            {
                def = { fnName : `__rec_${mode}_${typeId}_${hoisted.length}`, type };
                recDefs.set( typeId, def );
            }

            return `${def.fnName}( ${varName} )`;
        }

        visited.add( typeId );
    }

    try
    {
        const walk = unwrapTaggedBase( type, checker, scope );
        const flags = typeof walk.getFlags === 'function' ? walk.getFlags() : ts.TypeFlags.Any;

        if( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.NonPrimitive ))
        {
            return mode === 'clone' ? `__tcRuntime.cloneAny( ${varName} )` : varName;
        }

        const symName = typeSymbolName( walk );

        if( symName === 'Date' )
        {
            return mode === 'clone' ? `__tcRuntime.cloneDate( ${varName} )` : varName;
        }

        if( symName === 'URL' )
        {
            return mode === 'clone' ? `__tcRuntime.cloneUrl( ${varName} )` : varName;
        }

        if( symName === 'RegExp' )
        {
            return mode === 'clone' ? `__tcRuntime.cloneRegExp( ${varName} )` : varName;
        }

        if( symName === 'File' )
        {
            return mode === 'clone' ? `__tcRuntime.cloneFile( ${varName} )` : varName;
        }

        if( symName === 'Blob' )
        {
            return mode === 'clone' ? `__tcRuntime.cloneBlob( ${varName} )` : varName;
        }

        if( symName === 'Promise' )
        {
            return varName;
        }

        if( symName === 'Buffer' )
        {
            return mode === 'clone' ? `__tcRuntime.cloneBuffer( ${varName} )` : varName;
        }

        if( symName && BUFFER_LIKE.has( symName ))
        {
            return mode === 'clone'
                ? `__tcRuntime.cloneBinary( ${varName}, ${JSON.stringify( symName )} )`
                : varName;
        }

        if( typeof checker.isTupleType === 'function' && checker.isTupleType( walk ))
        {
            return buildTupleTransform( walk, checker, mode, varName, scope, visited, hoisted, recDefs );
        }

        if( typeof checker.isArrayType === 'function' && checker.isArrayType( walk ))
        {
            const elemType = ( checker as any ).getTypeArguments?.( walk as ts.TypeReference )?.[0]
                || ( walk as ts.TypeReference ).typeArguments?.[0]
                || ({ getFlags : () => ts.TypeFlags.Any } as any );

            if( mode === 'clone' )
            {
                if( isImmutableLeaf( elemType, checker, scope ))
                {
                    return `${varName}.slice()`;
                }

                const elemExpr = buildTransform( elemType, checker, 'clone', 'arr[i]', scope, visited, hoisted, recDefs );

                return `( function( arr ){ const out = new Array( arr.length ); for( let i = 0; i < arr.length; i++ ){ out[i] = ${elemExpr}; } return out; })( ${varName} )`;
            }

            const elemPrune = buildTransform( elemType, checker, 'prune', 'arr[i]', scope, visited, hoisted, recDefs );

            return `( function( arr ){ if( Array.isArray( arr ) ){ for( let i = 0; i < arr.length; i++ ){ ${elemPrune}; } } return arr; })( ${varName} )`;
        }

        if( symName === 'Set' || symName === 'ReadonlySet' )
        {
            const elemType = ( checker as any ).getTypeArguments?.( walk as ts.TypeReference )?.[0]
                || ( walk as ts.TypeReference ).typeArguments?.[0]
                || ({ getFlags : () => ts.TypeFlags.Any } as any );

            if( mode === 'clone' )
            {
                if( isImmutableLeaf( elemType, checker, scope ))
                {
                    return `new Set( ${varName} )`;
                }

                const elemExpr = buildTransform( elemType, checker, 'clone', 'item', scope, visited, hoisted, recDefs );

                return `__tcRuntime.cloneSet( ${varName}, ( item ) => ${elemExpr} )`;
            }

            const elemPrune = buildTransform( elemType, checker, 'prune', 'item', scope, visited, hoisted, recDefs );

            return `( function( s ){ if( s instanceof Set ){ for( const item of s ){ ${elemPrune}; } } return s; })( ${varName} )`;
        }

        if( symName === 'Map' || symName === 'ReadonlyMap' )
        {
            const typeArgs = ( checker as any ).getTypeArguments?.( walk as ts.TypeReference )
                || ( walk as ts.TypeReference ).typeArguments
                || [];
            const keyType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const valType = typeArgs[1] || ({ getFlags : () => ts.TypeFlags.Any } as any );

            if( mode === 'clone' )
            {
                if( isImmutableLeaf( keyType, checker, scope ) && isImmutableLeaf( valType, checker, scope ))
                {
                    return `new Map( ${varName} )`;
                }

                const keyExpr = buildTransform( keyType, checker, 'clone', 'k', scope, visited, hoisted, recDefs );
                const valExpr = buildTransform( valType, checker, 'clone', 'val', scope, visited, hoisted, recDefs );

                return `__tcRuntime.cloneMap( ${varName}, ( k ) => ${keyExpr}, ( val ) => ${valExpr} )`;
            }

            const keyNeeds = needsPrune( keyType, checker, scope );
            const valNeeds = needsPrune( valType, checker, scope );
            const keyPrune = keyNeeds ? `${buildTransform( keyType, checker, 'prune', 'k', scope, visited, hoisted, recDefs )}; ` : '';
            const valPrune = valNeeds ? `${buildTransform( valType, checker, 'prune', 'val', scope, visited, hoisted, recDefs )}; ` : '';

            return `( function( m ){ if( m instanceof Map ){ for( const [ k, val ] of m.entries() ){ ${keyPrune}${valPrune}} } return m; })( ${varName} )`;
        }

        if( typeof walk.isUnion === 'function' && walk.isUnion())
        {
            return buildUnionTransform( walk, checker, mode, varName, scope, visited, hoisted, recDefs );
        }

        if( typeof walk.isIntersection === 'function' && walk.isIntersection())
        {
            const merged = tryMergeObjectTypes( walk.types, checker, walk );

            if( merged )
            {
                return buildObjectTransform( merged.props, merged.indexType, merged.patternIndexInfos, checker, mode, varName, scope, visited, hoisted, recDefs );
            }

            const nonTag = walk.types.filter( t => !isConstraintOnlyType( t, checker ) && !isBrandOnlyType( t, checker ));

            if( nonTag.length === 1 )
            {
                return buildTransform( nonTag[0], checker, mode, varName, scope, visited, hoisted, recDefs );
            }

            if( mode === 'clone' )
            {
                const armClones = nonTag.map( arm => buildTransform( arm, checker, 'clone', 'v', scope, visited, hoisted, recDefs ));

                return `( function( v ){ if( v === null || typeof v !== "object" ){ return v; } return Object.assign( {}, ${armClones.join( ', ' )} ); })( ${varName} )`;
            }

            const armClones = nonTag.map( arm => buildTransform( arm, checker, 'clone', 'v', scope, visited, hoisted, recDefs ));

            return `( function( v ){ if( v === null || typeof v !== "object" ){ return v; } const __keep = Object.assign( {}, ${armClones.join( ', ' )} ); for( const k of Object.keys( v ) ){ if( !Object.hasOwn( __keep, k ) ){ delete v[k]; } } for( const k of Object.keys( __keep ) ){ __tcRuntime.setSafeProp( v, k, __keep[k] ); } return v; })( ${varName} )`;
        }

        const cls = resolveClassBinding( walk, scope );

        if( cls )
        {
            const ir = resolveTypeIr( walk, checker );
            const props = ir.getProps();
            const keysVar = hoisted.length === 0 ? '__keys' : `__keys_${hoisted.length}`;
            hoisted.push( `const ${keysVar} = new Set( ${JSON.stringify( props.map( p => p.name ))} );` );
            const propCopies = props.map( p =>
            {
                const acc = safePropAccess( 'src', p.name );
                const effType = p.isOptional ? stripUndefinedFromUnion( p.type ) : p.type;
                const cloned = buildTransform( effType, checker, 'clone', acc, scope, visited, hoisted, recDefs );

                return `if( Object.hasOwn( src, ${JSON.stringify( p.name )} ) ){ __tcRuntime.setSafeProp( dst, ${JSON.stringify( p.name )}, ${p.isOptional ? `( ${acc} === undefined ? undefined : ${cloned} )` : cloned} ); }`;
            }).join( ' ' );

            return `__tcRuntime.cloneClassInstance( ${varName}, ( src, dst ) => { ${propCopies} }, ${keysVar} )`;
        }

        const ir = resolveTypeIr( walk, checker );

        return buildObjectTransform(
            ir.getProps(),
            ir.getStringIndexType(),
            ir.getTemplateIndexInfos(),
            checker,
            mode,
            varName,
            scope,
            visited,
            hoisted,
            recDefs
        );
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

function buildTupleTransform(
    type    : ts.Type,
    checker : ts.TypeChecker,
    mode    : Mode,
    varName : string,
    scope   : ICustomFunctionScope,
    visited : Set<number>,
    hoisted : string[],
    recDefs : Map<number, RecDef>
): string
{
    const { typeArgs, elementFlags, hasRest, hasOptional, fixedCount, restType, suffixTypes } = inspectTupleType( type, checker );
    const suffixLen = suffixTypes.length;
    const restEndExpr = suffixLen > 0 ? `arr.length - ${suffixLen}` : 'arr.length';

    if( mode === 'clone' )
    {
        if( !hasRest && !hasOptional )
        {
            const slots = typeArgs.map(( elem, i ) =>
                buildTransform( elem, checker, 'clone', `arr[${i}]`, scope, visited, hoisted, recDefs )
            ).join( ', ' );

            return `( function( arr ){ return [ ${slots} ]; })( ${varName} )`;
        }

        const stmts: string[] = [];

        for( let i = 0; i < fixedCount; i++ )
        {
            const isOpt = ( elementFlags[i] & ts.ElementFlags.Optional ) !== 0;
            const elemType = isOpt ? stripUndefinedFromUnion( typeArgs[i]) : typeArgs[i];
            const elemClone = buildTransform( elemType, checker, 'clone', `arr[${i}]`, scope, visited, hoisted, recDefs );

            if( isOpt )
            {
                stmts.push( `if( ${restEndExpr} > ${i} ){ out.push( arr[${i}] === undefined ? undefined : ${elemClone} ); }` );
            }
            else
            {
                stmts.push( `out.push( ${elemClone} );` );
            }
        }

        if( hasRest && restType )
        {
            const restClone = buildTransform( restType, checker, 'clone', 'arr[i]', scope, visited, hoisted, recDefs );
            stmts.push( `for( let i = ${fixedCount}; i < ${restEndExpr}; i++ ){ out.push( ${restClone} ); }` );

            for( let j = 0; j < suffixLen; j++ )
            {
                const sClone = buildTransform( suffixTypes[j], checker, 'clone', 'arr[__si]', scope, visited, hoisted, recDefs );
                stmts.push( `{ const __si = ${restEndExpr} + ${j}; out.push( ${sClone} ); }` );
            }
        }

        return `( function( arr ){ const out = []; ${stmts.join( ' ' )} return out; })( ${varName} )`;
    }

    const pruneStmts: string[] = [];

    for( let i = 0; i < fixedCount; i++ )
    {
        const isOpt = ( elementFlags[i] & ts.ElementFlags.Optional ) !== 0;
        const elemType = isOpt ? stripUndefinedFromUnion( typeArgs[i]) : typeArgs[i];

        if( !needsPrune( elemType, checker, scope )){ continue }

        const elemPrune = buildTransform( elemType, checker, 'prune', `arr[${i}]`, scope, visited, hoisted, recDefs );
        pruneStmts.push( `if( ${restEndExpr} > ${i} && arr[${i}] !== undefined ){ ${elemPrune}; }` );
    }

    if( hasRest && restType && needsPrune( restType, checker, scope ))
    {
        const restPrune = buildTransform( restType, checker, 'prune', 'arr[i]', scope, visited, hoisted, recDefs );
        pruneStmts.push( `for( let i = ${fixedCount}; i < ${restEndExpr}; i++ ){ ${restPrune}; }` );
    }

    for( let j = 0; j < suffixLen; j++ )
    {
        if( !needsPrune( suffixTypes[j], checker, scope )){ continue }

        const sPrune = buildTransform( suffixTypes[j], checker, 'prune', 'arr[__si]', scope, visited, hoisted, recDefs );
        pruneStmts.push( `{ const __si = ${restEndExpr} + ${j}; if( __si >= 0 && __si < arr.length ){ ${sPrune}; } }` );
    }

    const trimExtra = !hasRest ? `if( arr.length > ${fixedCount} ){ arr.length = ${fixedCount}; } ` : '';

    return `( function( arr ){ if( Array.isArray( arr ) ){ ${pruneStmts.join( ' ' )} ${trimExtra}} return arr; })( ${varName} )`;
}

function buildUnionTransform(
    type    : ts.UnionType,
    checker : ts.TypeChecker,
    mode    : Mode,
    varName : string,
    scope   : ICustomFunctionScope,
    visited : Set<number>,
    hoisted : string[],
    recDefs : Map<number, RecDef>
): string
{
    const { hasUndefined, hasNull, nonNullish } = classifyNullableUnion( type.types );

    if( nonNullish.length === 1 && ( hasUndefined || hasNull ))
    {
        const inner = buildTransform( nonNullish[0], checker, mode, 'v', scope, visited, hoisted, recDefs );

        if( hasUndefined && hasNull )
        {
            return `( function( v ){ return ( v === undefined || v === null ) ? v : ${inner}; })( ${varName} )`;
        }

        if( hasUndefined )
        {
            return `( function( v ){ return v === undefined ? undefined : ${inner}; })( ${varName} )`;
        }

        return `( function( v ){ return v === null ? null : ${inner}; })( ${varName} )`;
    }

    const tagged = tryTaggedUnionTypes( nonNullish, checker );

    if( tagged && nonNullish.length === type.types.length )
    {
        const discAccess = `( v && typeof v === "object" ? ${safePropAccess( 'v', tagged.key )} : undefined )`;
        const cases = tagged.arms.map( arm =>
            `case ${JSON.stringify( arm.tag )}: return ${buildTransform( arm.type, checker, mode, 'v', scope, visited, hoisted, recDefs )};`
        ).join( ' ' );

        return `( function( v ){ switch( ${discAccess} ){ ${cases} default: return v; } })( ${varName} )`;
    }

    const sortedArms = sortUnionArmsBySpecificity( type.types, checker );
    const objectArmCount = sortedArms.filter( a => extractArmScoreKeys( a, checker, scope ) !== undefined ).length;
    const armSpecs = sortedArms.map( arm =>
    {
        const matchCode = buildMatchExpr( arm, checker, 'v', scope, hoisted );
        const runCode = buildTransform( arm, checker, mode, 'v', scope, visited, hoisted, recDefs );
        const scoreKeys = objectArmCount > 1 ? extractArmScoreKeys( arm, checker, scope ) : undefined;
        const scorePart = scoreKeys ? `, scoreKeys: ${JSON.stringify( scoreKeys )}` : '';

        return `{ match: ( v ) => ${matchCode}, run: ( v ) => ${runCode}${scorePart} }`;
    });
    const armsVar = `__arms_${hoisted.length}`;
    hoisted.push( `const ${armsVar} = [ ${armSpecs.join( ', ' )} ];` );

    return `__tcRuntime.dispatchUnion( ${varName}, ${armsVar} )`;
}

function buildObjectTransform(
    props             : readonly MergedPropInfo[],
    indexType         : ts.Type | undefined,
    patternIndexInfos : readonly TemplateIndexInfo[] | undefined,
    checker           : ts.TypeChecker,
    mode              : Mode,
    varName           : string,
    scope             : ICustomFunctionScope,
    visited           : Set<number>,
    hoisted           : string[],
    recDefs           : Map<number, RecDef>
): string
{
    const hasPatterns = Boolean( patternIndexInfos && patternIndexInfos.length > 0 );
    const propNames = props.map( p => p.name );

    if( mode === 'clone' )
    {
        const initialProps: string[] = [];
        const postInit: string[] = [];

        for( const prop of props )
        {
            const rawAccess = safePropAccess( 'o', prop.name );
            const hasOwn = `Object.hasOwn( o, ${JSON.stringify( prop.name )} )`;
            const effType = prop.isOptional ? stripUndefinedFromUnion( prop.type ) : prop.type;
            const clonedVal = buildTransform( effType, checker, 'clone', rawAccess, scope, visited, hoisted, recDefs );

            if( prop.isOptional )
            {
                const assignExpr = prop.name === '__proto__'
                    ? `__tcRuntime.setSafeProp( res, "__proto__", ${rawAccess} === undefined ? undefined : ${clonedVal} );`
                    : `res[${JSON.stringify( prop.name )}] = ${rawAccess} === undefined ? undefined : ${clonedVal};`;
                postInit.push( `if( ${hasOwn} ){ ${assignExpr} }` );
            }
            else if( prop.name === '__proto__' )
            {
                postInit.push( `__tcRuntime.setSafeProp( res, "__proto__", ${clonedVal} );` );
            }
            else
            {
                initialProps.push( `${JSON.stringify( prop.name )}: ${clonedVal}` );
            }
        }

        let dynCode = '';

        if( hasPatterns || indexType )
        {
            const keysVar = hoisted.length === 0 ? '__keys' : `__keys_${hoisted.length}`;
            hoisted.push( `const ${keysVar} = new Set( ${JSON.stringify( propNames )} );` );

            if( hasPatterns )
            {
                const patBranches = patternIndexInfos!.map( pInfo =>
                {
                    const reVar = `__re_${hoisted.length}`;
                    hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( pInfo.pattern )} );` );
                    const patClone = buildTransform( pInfo.valueType, checker, 'clone', 'o[k]', scope, visited, hoisted, recDefs );

                    return `if( ${reVar} && __tcRuntime.testRegex( ${reVar}, k ) ){ __pm = true; __tcRuntime.setSafeProp( res, k, ${patClone} ); }`;
                }).join( ' ' );
                const idxFallback = indexType
                    ? `if( !__pm ){ __tcRuntime.setSafeProp( res, k, ${buildTransform( indexType, checker, 'clone', 'o[k]', scope, visited, hoisted, recDefs )} ); }`
                    : '';
                dynCode = `for( const k of Object.keys( o ) ){ if( ${keysVar}.has( k ) ){ continue; } let __pm = false; ${patBranches} ${idxFallback} } `;
            }
            else if( indexType )
            {
                const idxClone = buildTransform( indexType, checker, 'clone', 'o[k]', scope, visited, hoisted, recDefs );
                dynCode = `for( const k of Object.keys( o ) ){ if( !${keysVar}.has( k ) ){ __tcRuntime.setSafeProp( res, k, ${idxClone} ); } } `;
            }
        }

        const postCode = postInit.length > 0 ? postInit.join( ' ' ) + ' ' : '';

        return `( function( o ){ if( o === null || typeof o !== "object" ){ return o; } const res = { ${initialProps.join( ', ' )} }; ${postCode}${dynCode}return res; })( ${varName} )`;
    }

    const keysVar = hoisted.length === 0 ? '__keys' : `__keys_${hoisted.length}`;
    hoisted.push( `const ${keysVar} = new Set( ${JSON.stringify( propNames )} );` );
    const propPrunes: string[] = [];

    for( const prop of props )
    {
        const effType = prop.isOptional ? stripUndefinedFromUnion( prop.type ) : prop.type;

        if( !needsPrune( effType, checker, scope )){ continue }

        const rawAccess = safePropAccess( 'o', prop.name );
        const prunedExpr = buildTransform( effType, checker, 'prune', rawAccess, scope, visited, hoisted, recDefs );
        propPrunes.push( `if( Object.hasOwn( o, ${JSON.stringify( prop.name )} ) && ${rawAccess} !== undefined ){ ${prunedExpr}; }` );
    }

    let keyLoop: string;

    if( hasPatterns )
    {
        const patBranches = patternIndexInfos!.map( pInfo =>
        {
            const reVar = `__re_${hoisted.length}`;
            hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( pInfo.pattern )} );` );
            const patPrune = needsPrune( pInfo.valueType, checker, scope )
                ? `${buildTransform( pInfo.valueType, checker, 'prune', 'o[k]', scope, visited, hoisted, recDefs )}; `
                : '';

            return `if( ${reVar} && __tcRuntime.testRegex( ${reVar}, k ) ){ __pm = true; ${patPrune}}`;
        }).join( ' ' );
        const idxBranch = indexType
            ? ( needsPrune( indexType, checker, scope )
                ? `if( !__pm && o[k] !== undefined ){ ${buildTransform( indexType, checker, 'prune', 'o[k]', scope, visited, hoisted, recDefs )}; }`
                : '' )
            : 'if( !__pm ){ delete o[k]; }';
        keyLoop = `for( const k of Object.keys( o ) ){ if( ${keysVar}.has( k ) ){ continue; } let __pm = false; ${patBranches} ${idxBranch} }`;
    }
    else if( indexType )
    {
        keyLoop = needsPrune( indexType, checker, scope )
            ? `for( const k of Object.keys( o ) ){ if( !${keysVar}.has( k ) && o[k] !== undefined ){ ${buildTransform( indexType, checker, 'prune', 'o[k]', scope, visited, hoisted, recDefs )}; } }`
            : '';
    }
    else
    {
        keyLoop = `for( const k of Object.keys( o ) ){ if( !${keysVar}.has( k ) ){ delete o[k]; } }`;
    }

    const bodyParts = [ ...propPrunes, keyLoop ].filter( Boolean ).join( ' ' );

    return `( function( o ){ if( !__tcRuntime.isPlainObject( o ) ){ return o; } ${bodyParts} return o; })( ${varName} )`;
}

function generateModeCode(
    type    : ts.Type,
    checker : ts.TypeChecker,
    mode    : Mode,
    scope   : ICustomFunctionScope
): string
{
    assertNotTypeParameter( type );

    const hoisted: string[] = [];
    const recDefs = new Map<number, RecDef>();
    const body = buildTransform( type, checker, mode, 'input', scope, new Set(), hoisted, recDefs );
    const generated = new Set<number>();

    while( generated.size < recDefs.size )
    {
        for( const [ id, def ] of recDefs.entries())
        {
            if( generated.has( id )){ continue }

            generated.add( id );
            const recBody = buildTransform( def.type, checker, mode, 'v', scope, new Set(), hoisted, recDefs );
            hoisted.push( `function ${def.fnName}( v ){ if( v === null || v === undefined ){ return v; } return ${recBody}; }` );
        }
    }

    const fnExpr = `( function( input ){ return ${body}; })`;

    if( hoisted.length === 0 ){ return fnExpr }

    return `( function(){ ${hoisted.join( ' ' )} return ${fnExpr}; })()`;
}

export function generateCloneCode(
    type    : ts.Type,
    checker : ts.TypeChecker,
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): string
{
    return generateModeCode( type, checker, 'clone', scope );
}

export function generatePruneCode(
    type    : ts.Type,
    checker : ts.TypeChecker,
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): string
{
    return generateModeCode( type, checker, 'prune', scope );
}
