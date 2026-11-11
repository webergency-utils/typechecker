import ts from 'typescript';
import { resolveClassIdentity, type ICustomFunctionScope } from './customFns.js';
import
{
    assertNotTypeParameter,
    assertValidMapKeyType,
    bigIntLiteralText,
    BUFFER_LIKE,
    collectConstraintsFromProps,
    enumMemberTypes,
    extractTypeJsDocInfo,
    getTypeProps,
    inspectTupleType,
    isBrandOnlyType,
    isConstraintOnlyType,
    isNativeEnumType,
    isTagKey,
    mergeConstraintsWithJsDoc,
    MergedPropInfo,
    ParsedConstraint,
    peelTaggedIntersection,
    stripUndefinedFromUnion,
    TemplateIndexInfo,
    tryMergeObjectTypes,
    typeSymbolName,
    VERBATIM_CUSTOM_SCOPE
}
    from './type-helpers.js';
import { resolveTypeIr } from './type-ir.js';

interface RecRandDef
{
    fnName : string
    type   : ts.Type
}

function collectEffectiveConstraints(
    type       : ts.Type,
    checker    : ts.TypeChecker,
    scope      : ICustomFunctionScope,
    extraJsDoc?: ParsedConstraint[]
): { walkType : ts.Type, constraints : ParsedConstraint[] }
{
    let walkType = type;
    let constraints: ParsedConstraint[] = [];

    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        const peeled = peelTaggedIntersection( type, checker, scope );

        if( peeled )
        {
            walkType = peeled.base;
            constraints = peeled.constraints.slice();
        }
    }

    const isUnionWalk = typeof walkType.isUnion === 'function' && walkType.isUnion();

    if( constraints.length === 0 && !isUnionWalk )
    {
        const rawProps = getTypeProps( walkType, checker );

        if( rawProps.some( p => isTagKey( p.getName())))
        {
            constraints = collectConstraintsFromProps( rawProps, checker, scope );
        }
    }

    if( !isUnionWalk )
    {
        const outerJsDoc = extractTypeJsDocInfo( type, checker );
        constraints = mergeConstraintsWithJsDoc( constraints, outerJsDoc.constraints );

        if( walkType !== type )
        {
            const innerJsDoc = extractTypeJsDocInfo( walkType, checker );
            constraints = mergeConstraintsWithJsDoc( constraints, innerJsDoc.constraints );
        }
    }

    if( extraJsDoc && extraJsDoc.length > 0 )
    {
        constraints = mergeConstraintsWithJsDoc( constraints, extraJsDoc );
    }

    return { walkType, constraints };
}

function typeReferencesAny(
    type    : ts.Type,
    targets : ReadonlySet<number>,
    checker : ts.TypeChecker,
    seen    : Set<object> = new Set()
): boolean
{
    if( !type || typeof type !== 'object' || targets.size === 0 ){ return false }

    const id = ( type as any ).id;

    if( typeof id === 'number' && targets.has( id )){ return true }

    if( seen.has( type )){ return false }

    seen.add( type );

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        return type.types.some( t => typeReferencesAny( t, targets, checker, seen ));
    }

    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        return type.types.some( t => typeReferencesAny( t, targets, checker, seen ));
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        const elem = ( checker as any ).getTypeArguments?.( type as ts.TypeReference )?.[0]
            || ( type as ts.TypeReference ).typeArguments?.[0];

        return elem ? typeReferencesAny( elem, targets, checker, seen ) : false;
    }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
    {
        const { typeArgs } = inspectTupleType( type, checker );

        return typeArgs.some( t => typeReferencesAny( t, targets, checker, seen ));
    }

    return false;
}

function serializeBigIntOrNum( v: unknown ): string
{
    if( typeof v === 'bigint' ){ return `${v}n` }

    return JSON.stringify( v );
}

function buildNumberOptsExpr( constraints: ParsedConstraint[]): string | undefined
{
    const parts: string[] = [];
    const min = constraints.find( c => c.type === 'minimum' )?.value;
    const max = constraints.find( c => c.type === 'maximum' )?.value;
    const exclMin = constraints.find( c => c.type === 'exclusiveMinimum' )?.value;
    const exclMax = constraints.find( c => c.type === 'exclusiveMaximum' )?.value;
    const step = constraints.find( c => c.type === 'multipleOf' )?.value;
    const fmt = constraints.find( c => c.type === 'format' )?.value;

    if( typeof min === 'number' ){ parts.push( `min: ${min}` ) }
    else if( fmt === 'uint32' || fmt === 'uint64' ){ parts.push( 'min: 0' ) }

    if( typeof max === 'number' ){ parts.push( `max: ${max}` ) }

    if( typeof exclMin === 'number' ){ parts.push( `exclMin: ${exclMin}` ) }

    if( typeof exclMax === 'number' ){ parts.push( `exclMax: ${exclMax}` ) }

    if( typeof step === 'number' ){ parts.push( `step: ${step}` ) }

    if( fmt === 'int32' || fmt === 'int64' || fmt === 'uint32' || fmt === 'uint64' )
    {
        parts.push( 'integer: true' );
    }

    return parts.length > 0 ? `{ ${parts.join( ', ' )} }` : undefined;
}

function buildBigIntOptsExpr( constraints: ParsedConstraint[]): string | undefined
{
    const parts: string[] = [];

    for( const [ cType, key ] of [
        [ 'minimum', 'min' ],
        [ 'maximum', 'max' ],
        [ 'exclusiveMinimum', 'exclMin' ],
        [ 'exclusiveMaximum', 'exclMax' ],
        [ 'multipleOf', 'step' ]
    ] as const )
    {
        const raw = constraints.find( c => c.type === cType )?.value;

        if( raw !== undefined )
        {
            const asBig = typeof raw === 'bigint' ? raw : BigInt( Math.trunc( Number( raw )));
            parts.push( `${key}: ${serializeBigIntOrNum( asBig )}` );
        }
    }

    return parts.length > 0 ? `{ ${parts.join( ', ' )} }` : undefined;
}

function buildStringExpr(
    rngExpr     : string,
    constraints : ParsedConstraint[],
    mappingName?: string
): string
{
    const parts: string[] = [];
    const minLen = constraints.find( c => c.type === 'minLength' )?.value;
    const maxLen = constraints.find( c => c.type === 'maxLength' )?.value;
    const fmt = constraints.find( c => c.type === 'format' )?.value;
    const pat = constraints.find( c => c.type === 'pattern' )?.value;
    const transforms = constraints
        .filter( c => c.type === 'transform' && typeof c.value === 'string' )
        .map( c => c.value as string );
    const customTransforms = constraints.filter( c => c.type === 'transform_custom' );

    if( typeof minLen === 'number' ){ parts.push( `minLength: ${minLen}` ) }

    if( typeof maxLen === 'number' ){ parts.push( `maxLength: ${maxLen}` ) }

    if( typeof fmt === 'string' ){ parts.push( `format: ${JSON.stringify( fmt )}` ) }

    if( typeof pat === 'string' ){ parts.push( `pattern: ${JSON.stringify( pat )}` ) }

    if( mappingName ){ parts.push( `mapping: ${JSON.stringify( mappingName )}` ) }

    if( transforms.length > 0 ){ parts.push( `transforms: ${JSON.stringify( transforms )}` ) }

    let expr = parts.length > 0
        ? `__tcRuntime.randString( ${rngExpr}, { ${parts.join( ', ' )} } )`
        : `__tcRuntime.randString( ${rngExpr} )`;

    for( const ct of customTransforms )
    {
        expr = `${ct.value}( ${expr} )`;
    }

    return expr;
}

function buildRandomExpr(
    type        : ts.Type,
    checker     : ts.TypeChecker,
    rngExpr     : string,
    depthExpr   : string,
    scope       : ICustomFunctionScope,
    visited     : Set<number>,
    hoisted     : string[],
    recDefs     : Map<number, RecRandDef>,
    extraJsDoc? : ParsedConstraint[]
): string
{
    assertNotTypeParameter( type );

    const typeId = ( type as any ).id;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId ))
        {
            let def = recDefs.get( typeId );

            if( !def )
            {
                def = { fnName : `__rec_rand_${typeId}_${hoisted.length}`, type };
                recDefs.set( typeId, def );
            }

            return `${def.fnName}( ${rngExpr}, ${depthExpr} + 1 )`;
        }

        visited.add( typeId );
    }

    try
    {
        const { walkType, constraints } = collectEffectiveConstraints( type, checker, scope, extraJsDoc );
        const flags = typeof walkType.getFlags === 'function' ? walkType.getFlags() : ts.TypeFlags.Any;

        if( flags & ts.TypeFlags.Never )
        {
            throw new Error( '[Webergency] Cannot generate random value for type `never`.' );
        }

        if( flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Void ))
        {
            return 'undefined';
        }

        if( flags & ts.TypeFlags.Null )
        {
            return 'null';
        }

        if( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown ))
        {
            return `__tcRuntime.randString( ${rngExpr} )`;
        }

        if( flags & ts.TypeFlags.NonPrimitive )
        {
            return `{ id: __tcRuntime.randString( ${rngExpr} ) }`;
        }

        if( flags & ( ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol ))
        {
            return 'Symbol( "mock" )';
        }

        if( typeof walkType.isStringLiteral === 'function' && walkType.isStringLiteral())
        {
            return JSON.stringify( walkType.value );
        }

        if( typeof walkType.isNumberLiteral === 'function' && walkType.isNumberLiteral())
        {
            return String( walkType.value );
        }

        if( flags & ts.TypeFlags.BooleanLiteral )
        {
            return ( walkType as any ).intrinsicName === 'true' ? 'true' : 'false';
        }

        if( flags & ts.TypeFlags.BigIntLiteral )
        {
            return `${bigIntLiteralText( walkType )}n`;
        }

        if( flags & ts.TypeFlags.TemplateLiteral )
        {
            const tplType = walkType as ts.TemplateLiteralType;
            const chunks: string[] = [];

            for( let i = 0; i < tplType.texts.length; i++ )
            {
                if( tplType.texts[i].length > 0 )
                {
                    chunks.push( JSON.stringify( tplType.texts[i]));
                }

                if( i < tplType.types.length )
                {
                    const slotT = tplType.types[i];
                    const slotFlags = slotT.getFlags();
                    let slotExpr: string;

                    if( slotFlags & ts.TypeFlags.Number )
                    {
                        slotExpr = `String( __tcRuntime.randInt( ${rngExpr}, 0, 999 ) )`;
                    }
                    else if( slotFlags & ts.TypeFlags.BigInt )
                    {
                        slotExpr = `String( __tcRuntime.randInt( ${rngExpr}, 0, 999 ) )`;
                    }
                    else
                    {
                        slotExpr = `String( ${buildRandomExpr( slotT, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs )} )`;
                    }

                    chunks.push( slotExpr );
                }
            }

            return chunks.length > 0 ? `( ${chunks.join( ' + ' )} )` : '""';
        }

        if( flags & ts.TypeFlags.StringMapping )
        {
            const mapping = typeSymbolName( walkType );
            const inner = ( walkType as ts.StringMappingType ).type;

            if( inner && !( inner.getFlags() & ts.TypeFlags.String ))
            {
                const innerExpr = buildRandomExpr( inner, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs );

                if( mapping === 'Uppercase' ){ return `${innerExpr}.toUpperCase()` }

                if( mapping === 'Lowercase' ){ return `${innerExpr}.toLowerCase()` }

                if( mapping === 'Capitalize' )
                {
                    return `( function( s ){ return s.length > 0 ? s.charAt( 0 ).toUpperCase() + s.slice( 1 ) : s; })( ${innerExpr} )`;
                }

                if( mapping === 'Uncapitalize' )
                {
                    return `( function( s ){ return s.length > 0 ? s.charAt( 0 ).toLowerCase() + s.slice( 1 ) : s; })( ${innerExpr} )`;
                }
            }

            return buildStringExpr( rngExpr, constraints, mapping );
        }

        if( flags & ts.TypeFlags.String )
        {
            return buildStringExpr( rngExpr, constraints );
        }

        if( flags & ts.TypeFlags.Number )
        {
            const optsExpr = buildNumberOptsExpr( constraints );

            return optsExpr
                ? `__tcRuntime.randNumber( ${rngExpr}, ${optsExpr} )`
                : `__tcRuntime.randNumber( ${rngExpr} )`;
        }

        if( flags & ts.TypeFlags.Boolean )
        {
            return `__tcRuntime.randBool( ${rngExpr} )`;
        }

        if( flags & ts.TypeFlags.BigInt )
        {
            const optsExpr = buildBigIntOptsExpr( constraints );

            return optsExpr
                ? `__tcRuntime.randBigInt( ${rngExpr}, ${optsExpr} )`
                : `__tcRuntime.randBigInt( ${rngExpr} )`;
        }

        if( isNativeEnumType( walkType ))
        {
            const members = enumMemberTypes( walkType, checker );

            if( members.length === 0 )
            {
                return `__tcRuntime.randInt( ${rngExpr}, 0, 10 )`;
            }

            if( members.length === 1 )
            {
                return buildRandomExpr( members[0], checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs );
            }

            const memberFns = members.map( m =>
                `() => ${buildRandomExpr( m, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs )}`
            );

            return `[ ${memberFns.join( ', ' )} ][ __tcRuntime.randInt( ${rngExpr}, 0, ${members.length - 1} ) ]()`;
        }

        const symName = typeSymbolName( walkType );

        if( symName === 'Date' ){ return `__tcRuntime.randDate( ${rngExpr} )` }

        if( symName === 'URL' ){ return `__tcRuntime.randUrl( ${rngExpr} )` }

        if( symName === 'RegExp' ){ return `__tcRuntime.randRegExp( ${rngExpr} )` }

        if( symName === 'File' ){ return `__tcRuntime.randFile( ${rngExpr} )` }

        if( symName === 'Blob' ){ return `__tcRuntime.randBlob( ${rngExpr} )` }

        if( symName === 'Promise' )
        {
            const valType = ( checker as any ).getTypeArguments?.( walkType as ts.TypeReference )?.[0]
                || ( walkType as ts.TypeReference ).typeArguments?.[0];
            const inner = valType
                ? buildRandomExpr( valType, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs )
                : 'undefined';

            return `Promise.resolve( ${inner} )`;
        }

        if( symName === 'Buffer' ){ return `__tcRuntime.randBuffer( ${rngExpr} )` }

        if( symName && BUFFER_LIKE.has( symName ))
        {
            return `__tcRuntime.randBinary( ${rngExpr}, ${JSON.stringify( symName )} )`;
        }

        if( typeof walkType.getCallSignatures === 'function' && walkType.getCallSignatures().length > 0 )
        {
            const sig = walkType.getCallSignatures()[0];
            const retType = sig ? checker.getReturnTypeOfSignature( sig ) : undefined;
            const retExpr = retType && !( retType.getFlags() & ts.TypeFlags.Never )
                ? buildRandomExpr( retType, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs )
                : 'undefined';

            return `( () => ${retExpr} )`;
        }

        if( typeof checker.isTupleType === 'function' && checker.isTupleType( walkType ))
        {
            const { typeArgs, elementFlags, hasRest, hasOptional, fixedCount, restType, suffixTypes } = inspectTupleType( walkType, checker );

            if( !hasRest && !hasOptional )
            {
                const slots = typeArgs.map( elem =>
                    buildRandomExpr( elem, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs )
                );

                return `[ ${slots.join( ', ' )} ]`;
            }

            const stmts: string[] = [];
            let seenOpt = false;

            for( let i = 0; i < fixedCount; i++ )
            {
                const isOpt = ( elementFlags[i] & ts.ElementFlags.Optional ) !== 0;
                const elemT = isOpt ? stripUndefinedFromUnion( typeArgs[i]) : typeArgs[i];
                const elemGen = buildRandomExpr( elemT, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs );

                if( isOpt )
                {
                    if( !seenOpt )
                    {
                        seenOpt = true;
                        stmts.push( `let __incOpt = ${depthExpr} < 2 && __tcRuntime.randBool( ${rngExpr} );` );
                    }

                    stmts.push( `if( __incOpt ){ out.push( ${elemGen} ); __incOpt = __tcRuntime.randBool( ${rngExpr} ); }` );
                }
                else
                {
                    stmts.push( `out.push( ${elemGen} );` );
                }
            }

            if( hasRest && restType )
            {
                const restGen = buildRandomExpr( restType, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs );
                stmts.push( `const __rc = ${depthExpr} >= 2 ? 0 : __tcRuntime.randInt( ${rngExpr}, 0, 2 ); for( let __ri = 0; __ri < __rc; __ri++ ){ out.push( ${restGen} ); }` );

                for( const sType of suffixTypes )
                {
                    const sGen = buildRandomExpr( sType, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs );
                    stmts.push( `out.push( ${sGen} );` );
                }
            }

            return `( function(){ const out = []; ${stmts.join( ' ' )} return out; })()`;
        }

        if( typeof checker.isArrayType === 'function' && checker.isArrayType( walkType ))
        {
            const elemType = ( checker as any ).getTypeArguments?.( walkType as ts.TypeReference )?.[0]
                || ( walkType as ts.TypeReference ).typeArguments?.[0]
                || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const elemGen = buildRandomExpr( elemType, checker, '__r', `${depthExpr} + 1`, scope, visited, hoisted, recDefs );
            const minItems = constraints.find( c => c.type === 'minItems' )?.value as number | undefined;
            const maxItems = constraints.find( c => c.type === 'maxItems' )?.value as number | undefined;
            const unique = constraints.some( c => c.type === 'uniqueItems' );
            const containsC = constraints.find( c => c.type === 'contains' && c.nestedType );
            const minContains = constraints.find( c => c.type === 'minContains' )?.value as number | undefined;
            const maxContains = constraints.find( c => c.type === 'maxContains' )?.value as number | undefined;
            const optParts: string[] = [];

            if( minItems !== undefined )
            {
                optParts.push( `minItems: ${minItems}` );
            }
            else
            {
                optParts.push( `minItems: ${depthExpr} >= 2 ? 0 : 1` );
            }

            if( maxItems !== undefined )
            {
                optParts.push( `maxItems: ${maxItems}` );
            }
            else
            {
                optParts.push( `maxItems: ${depthExpr} >= 2 ? 0 : 3` );
            }

            if( unique ){ optParts.push( 'unique: true' ) }

            if( containsC?.nestedType )
            {
                const cGen = buildRandomExpr( containsC.nestedType, checker, '__cr', `${depthExpr} + 1`, scope, visited, hoisted, recDefs );
                optParts.push( `containsGen: ( __cr ) => ${cGen}` );

                if( minContains !== undefined ){ optParts.push( `minContains: ${minContains}` ) }

                if( maxContains !== undefined ){ optParts.push( `maxContains: ${maxContains}` ) }
            }

            return `__tcRuntime.randArray( ${rngExpr}, ( __r ) => ${elemGen}, { ${optParts.join( ', ' )} } )`;
        }

        if( symName === 'Set' || symName === 'ReadonlySet' )
        {
            const elemType = ( checker as any ).getTypeArguments?.( walkType as ts.TypeReference )?.[0]
                || ( walkType as ts.TypeReference ).typeArguments?.[0]
                || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const elemGen = buildRandomExpr( elemType, checker, '__r', `${depthExpr} + 1`, scope, visited, hoisted, recDefs );
            const minItems = constraints.find( c => c.type === 'minItems' )?.value as number | undefined;
            const maxItems = constraints.find( c => c.type === 'maxItems' )?.value as number | undefined;
            const minExpr = minItems !== undefined ? String( minItems ) : `( ${depthExpr} >= 2 ? 0 : 1 )`;
            const maxExpr = maxItems !== undefined ? String( maxItems ) : `( ${depthExpr} >= 2 ? 0 : 3 )`;

            return `__tcRuntime.randSet( ${rngExpr}, ( __r ) => ${elemGen}, ${minExpr}, ${maxExpr} )`;
        }

        if( symName === 'Map' || symName === 'ReadonlyMap' )
        {
            const typeArgs = ( checker as any ).getTypeArguments?.( walkType as ts.TypeReference )
                || ( walkType as ts.TypeReference ).typeArguments
                || [];
            const keyType = typeArgs[0] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            const valType = typeArgs[1] || ({ getFlags : () => ts.TypeFlags.Any } as any );
            assertValidMapKeyType( keyType, checker );
            const keyGen = buildRandomExpr( keyType, checker, '__rk', `${depthExpr} + 1`, scope, visited, hoisted, recDefs );
            const valGen = buildRandomExpr( valType, checker, '__rv', `${depthExpr} + 1`, scope, visited, hoisted, recDefs );
            const minProps = constraints.find( c => c.type === 'minProperties' )?.value as number | undefined;
            const maxProps = constraints.find( c => c.type === 'maxProperties' )?.value as number | undefined;
            const minExpr = minProps !== undefined ? String( minProps ) : `( ${depthExpr} >= 2 ? 0 : 1 )`;
            const maxExpr = maxProps !== undefined ? String( maxProps ) : `( ${depthExpr} >= 2 ? 0 : 3 )`;

            return `__tcRuntime.randMap( ${rngExpr}, ( __rk ) => ${keyGen}, ( __rv ) => ${valGen}, ${minExpr}, ${maxExpr} )`;
        }

        if( typeof walkType.isUnion === 'function' && walkType.isUnion())
        {
            const arms = walkType.types.filter( t => !( t.getFlags() & ts.TypeFlags.Never ));

            if( arms.length === 0 )
            {
                throw new Error( '[Webergency] Cannot generate random value for empty union.' );
            }

            if( arms.length === 1 )
            {
                return buildRandomExpr( arms[0], checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs );
            }

            const nonRecIndices: number[] = [];

            for( let i = 0; i < arms.length; i++ )
            {
                if( !typeReferencesAny( arms[i], visited, checker ))
                {
                    nonRecIndices.push( i );
                }
            }

            const armFns = arms.map( arm =>
                `() => ${buildRandomExpr( arm, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs )}`
            );
            const allVar = `__uarms_${hoisted.length}`;
            hoisted.push( `const ${allVar} = [ ${armFns.join( ', ' )} ];` );

            if( nonRecIndices.length > 0 && nonRecIndices.length < arms.length )
            {
                const safeFns = nonRecIndices.map( idx => `${allVar}[${idx}]` );
                const safeVar = `__usafe_${hoisted.length}`;
                hoisted.push( `const ${safeVar} = [ ${safeFns.join( ', ' )} ];` );

                return `( ${depthExpr} >= 2 ? ${safeVar}[ __tcRuntime.randInt( ${rngExpr}, 0, ${safeFns.length - 1} ) ]() : ${allVar}[ __tcRuntime.randInt( ${rngExpr}, 0, ${armFns.length - 1} ) ]() )`;
            }

            return `${allVar}[ __tcRuntime.randInt( ${rngExpr}, 0, ${armFns.length - 1} ) ]()`;
        }

        if( typeof walkType.isIntersection === 'function' && walkType.isIntersection())
        {
            const merged = tryMergeObjectTypes( walkType.types, checker, walkType );

            if( merged )
            {
                return buildObjectRandomExpr(
                    merged.props,
                    merged.indexType,
                    merged.patternIndexInfos,
                    constraints,
                    checker,
                    rngExpr,
                    depthExpr,
                    scope,
                    visited,
                    hoisted,
                    recDefs
                );
            }

            const nonTag = walkType.types.filter( t => !isConstraintOnlyType( t, checker ) && !isBrandOnlyType( t, checker ));

            if( nonTag.length === 1 )
            {
                return buildRandomExpr( nonTag[0], checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs );
            }

            const armExprs = nonTag.map( arm =>
                buildRandomExpr( arm, checker, rngExpr, depthExpr, scope, visited, hoisted, recDefs )
            );

            return `Object.assign( {}, ${armExprs.join( ', ' )} )`;
        }

        const classIdentity = resolveClassIdentity( walkType );

        if( classIdentity )
        {
            const decl = classIdentity.declaration;
            const fromGlobal = decl !== undefined
                && decl.getSourceFile().isDeclarationFile
                && !ts.isExternalModule( decl.getSourceFile());
            const ctorExpr = ( fromGlobal || !decl )
                ? `( globalThis[${JSON.stringify( classIdentity.name )}] )`
                : scope.bind( classIdentity );
            const ir = resolveTypeIr( walkType, checker );
            const propAssigns = ir.getProps().map( p =>
            {
                const effType = p.isOptional ? stripUndefinedFromUnion( p.type ) : p.type;
                const valExpr = buildRandomExpr( effType, checker, rngExpr, `${depthExpr} + 1`, scope, visited, hoisted, recDefs, p.jsdocConstraints );

                if( p.isOptional )
                {
                    return `if( ${depthExpr} < 2 && __tcRuntime.randBool( ${rngExpr} ) ){ __tcRuntime.setSafeProp( inst, ${JSON.stringify( p.name )}, ${valExpr} ); }`;
                }

                return `__tcRuntime.setSafeProp( inst, ${JSON.stringify( p.name )}, ${valExpr} );`;
            }).join( ' ' );

            return `( function(){ const inst = Object.create( ${ctorExpr}.prototype ); ${propAssigns} return inst; })()`;
        }

        const ir = resolveTypeIr( walkType, checker );

        return buildObjectRandomExpr(
            ir.getProps(),
            ir.getStringIndexType(),
            ir.getTemplateIndexInfos(),
            constraints,
            checker,
            rngExpr,
            depthExpr,
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

function collectRequiredSiblingNames( props: readonly MergedPropInfo[], objConstraints: ParsedConstraint[], checker: ts.TypeChecker, scope: ICustomFunctionScope ): Set<string>
{
    const needed = new Set<string>();
    const addReq = ( val: unknown ): void =>
    {
        const items = Array.isArray( val ) ? val : [ val ];

        for( const item of items )
        {
            if( typeof item === 'string' && !item.includes( '.' ))
            {
                needed.add( item );
            }
        }
    };

    for( const c of objConstraints )
    {
        if( c.type === 'requires' ){ addReq( c.value ) }
    }

    for( const p of props )
    {
        const { constraints } = collectEffectiveConstraints( p.type, checker, scope, p.jsdocConstraints );

        for( const c of constraints )
        {
            if( c.type === 'requires' ){ addReq( c.value ) }
        }
    }

    return needed;
}

function buildObjectRandomExpr(
    props             : readonly MergedPropInfo[],
    indexType         : ts.Type | undefined,
    patternIndexInfos : readonly TemplateIndexInfo[] | undefined,
    constraints       : ParsedConstraint[],
    checker           : ts.TypeChecker,
    rngExpr           : string,
    depthExpr         : string,
    scope             : ICustomFunctionScope,
    visited           : Set<number>,
    hoisted           : string[],
    recDefs           : Map<number, RecRandDef>
): string
{
    const minProps = constraints.find( c => c.type === 'minProperties' )?.value as number | undefined;
    const maxProps = constraints.find( c => c.type === 'maxProperties' )?.value as number | undefined;
    const propNamesC = constraints.find( c => c.type === 'propertyNames' && c.nestedType );
    const requiredSiblings = collectRequiredSiblingNames( props, constraints, checker, scope );

    const initialProps: string[] = [];
    const postInit: string[] = [];
    let guaranteedCount = 0;

    for( const prop of props )
    {
        if( !prop.isOptional || requiredSiblings.has( prop.name ))
        {
            guaranteedCount++;
        }
    }

    let remainingForcedOpt = minProps !== undefined ? Math.max( 0, minProps - guaranteedCount ) : 0;

    for( const prop of props )
    {
        const forceInclude = !prop.isOptional || requiredSiblings.has( prop.name ) || remainingForcedOpt > 0;

        if( prop.isOptional && !requiredSiblings.has( prop.name ) && remainingForcedOpt > 0 )
        {
            remainingForcedOpt--;
        }

        const effType = prop.isOptional ? stripUndefinedFromUnion( prop.type ) : prop.type;
        const valExpr = buildRandomExpr(
            effType,
            checker,
            rngExpr,
            `${depthExpr} + 1`,
            scope,
            visited,
            hoisted,
            recDefs,
            prop.jsdocConstraints
        );

        if( forceInclude )
        {
            if( prop.name === '__proto__' )
            {
                postInit.push( `__tcRuntime.setSafeProp( res, "__proto__", ${valExpr} );` );
            }
            else
            {
                initialProps.push( `${JSON.stringify( prop.name )}: ${valExpr}` );
            }
        }
        else
        {
            const maxGuard = maxProps !== undefined ? ` && Object.keys( res ).length < ${maxProps}` : '';
            postInit.push(
                `if( ${depthExpr} < 2 && __tcRuntime.randBool( ${rngExpr} )${maxGuard} ){ __tcRuntime.setSafeProp( res, ${JSON.stringify( prop.name )}, ${valExpr} ); }`
            );
        }
    }

    if( patternIndexInfos && patternIndexInfos.length > 0 )
    {
        for( const pInfo of patternIndexInfos )
        {
            const patVal = buildRandomExpr( pInfo.valueType, checker, rngExpr, `${depthExpr} + 1`, scope, visited, hoisted, recDefs );
            const maxGuard = maxProps !== undefined ? `if( Object.keys( res ).length < ${maxProps} )` : '';
            postInit.push(
                `${maxGuard}{ const __pk = __tcRuntime.randFromPattern( ${rngExpr}, ${JSON.stringify( pInfo.pattern )} ); if( !Object.hasOwn( res, __pk ) ){ __tcRuntime.setSafeProp( res, __pk, ${patVal} ); } }`
            );
        }
    }

    if( indexType )
    {
        const keyGen = propNamesC?.nestedType
            ? buildRandomExpr( propNamesC.nestedType, checker, '__rk', `${depthExpr} + 1`, scope, visited, hoisted, recDefs )
            : '__tcRuntime.randString( __rk, { minLength: 4, maxLength: 8 } )';
        const valGen = buildRandomExpr( indexType, checker, '__rv', `${depthExpr} + 1`, scope, visited, hoisted, recDefs );
        const minArg = minProps !== undefined ? String( minProps ) : '0';
        const maxArg = maxProps !== undefined ? String( maxProps ) : 'undefined';
        postInit.push( `__tcRuntime.randRecord( ${rngExpr}, ( __rk ) => ${keyGen}, ( __rv ) => ${valGen}, res, ${minArg}, ${maxArg} );` );
    }

    if( postInit.length === 0 )
    {
        return `( { ${initialProps.join( ', ' )} } )`;
    }

    return `( function(){ const res = { ${initialProps.join( ', ' )} }; ${postInit.join( ' ' )} return res; })()`;
}

export function generateRandomCode(
    type    : ts.Type,
    checker : ts.TypeChecker,
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): string
{
    assertNotTypeParameter( type );

    const hoisted: string[] = [];
    const recDefs = new Map<number, RecRandDef>();
    const body = buildRandomExpr( type, checker, 'rng', '0', scope, new Set(), hoisted, recDefs );
    const generated = new Set<number>();

    while( generated.size < recDefs.size )
    {
        for( const [ id, def ] of recDefs.entries())
        {
            if( generated.has( id )){ continue }

            generated.add( id );
            const recBody = buildRandomExpr( def.type, checker, 'rng', 'depth', scope, new Set(), hoisted, recDefs );
            hoisted.push( `function ${def.fnName}( rng, depth ){ return ${recBody}; }` );
        }
    }

    const fnExpr = `( function( rng ){ return ${body}; })`;

    if( hoisted.length === 0 ){ return fnExpr }

    return `( function(){ ${hoisted.join( ' ' )} return ${fnExpr}; })()`;
}
