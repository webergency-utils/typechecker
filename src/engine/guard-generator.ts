import ts from 'typescript';
import { resolveClassIdentity, type ICustomFunctionScope } from './customFns.js';
import { isSafeRegexSource } from '../runtime/regex.js';
import
{
    assertNotTypeParameter,
    bigIntLiteralText,
    BUFFER_LIKE,
    buildTemplateLiteralRegex,
    collectConstraintsFromProps,
    enumMemberTypes,
    extractTypeJsDocInfo,
    inspectTupleType,
    isBrandOnlyType,
    isConstraintOnlyType,
    isNativeEnumType,
    isTagKey,
    MergedPropInfo,
    ParsedConstraint,
    peelTaggedIntersection,
    safePropAccess,
    stripUndefinedFromUnion,
    tryMergeObjectTypes,
    tryTaggedUnionTypes,
    typeHasDefaultTag,
    typeSymbolName,
    VERBATIM_CUSTOM_SCOPE
}
    from './type-helpers.js';
import { resolveTypeIr } from './type-ir.js';

interface GuardState
{
    checker        : ts.TypeChecker
    scope          : ICustomFunctionScope
    hoisted        : string[]
    active         : Set<number>
    cyclicIds      : Set<number>
    knownCyclicIds : ReadonlySet<number>
    compiledFns    : Map<number, string>
    counter        : number
}

const NOOP_GUARD_CONSTRAINT_TYPES: ReadonlySet<string> = new Set([
    'readOnly',
    'writeOnly',
    'secret',
    'message',
    'tags'
]);

const UNSUPPORTED_GUARD_CONSTRAINT_TYPES: ReadonlySet<string> = new Set([
    'default',
    'transform',
    'transform_split',
    'transform_custom',
    'custom',
    'requires',
    'contains',
    'minContains',
    'maxContains',
    'propertyNames'
]);

function nextVar( state: GuardState, prefix: string ): string
{
    return `__${prefix}_${state.counter++}`;
}

function formatNumOrBigInt( val: unknown ): string
{
    return typeof val === 'bigint' ? `${val}n` : String( val );
}

function emitConstraintChecks(
    constraints : readonly ParsedConstraint[],
    varExpr     : string,
    state       : GuardState
): string[] | undefined
{
    const checks: string[] = [];

    for( const c of constraints )
    {
        if( NOOP_GUARD_CONSTRAINT_TYPES.has( c.type )){ continue }

        if( UNSUPPORTED_GUARD_CONSTRAINT_TYPES.has( c.type )){ return undefined }

        if( c.type === 'minLength' )
        {
            checks.push( `( ${varExpr}.length >= ${c.value} )` );
            continue;
        }

        if( c.type === 'maxLength' )
        {
            checks.push( `( ${varExpr}.length <= ${c.value} )` );
            continue;
        }

        if( c.type === 'minimum' )
        {
            checks.push( `( ${varExpr} >= ${formatNumOrBigInt( c.value )} )` );
            continue;
        }

        if( c.type === 'maximum' )
        {
            checks.push( `( ${varExpr} <= ${formatNumOrBigInt( c.value )} )` );
            continue;
        }

        if( c.type === 'exclusiveMinimum' )
        {
            checks.push( `( ${varExpr} > ${formatNumOrBigInt( c.value )} )` );
            continue;
        }

        if( c.type === 'exclusiveMaximum' )
        {
            checks.push( `( ${varExpr} < ${formatNumOrBigInt( c.value )} )` );
            continue;
        }

        if( c.type === 'multipleOf' )
        {
            checks.push( `__tcRuntime.isMultipleOfValid( ${varExpr}, ${formatNumOrBigInt( c.value )} )` );
            continue;
        }

        if( c.type === 'integer' )
        {
            checks.push( `( typeof ${varExpr} !== 'number' || Number.isInteger( ${varExpr} ) )` );
            continue;
        }

        if( c.type === 'safeInteger' )
        {
            checks.push(
                `( typeof ${varExpr} === 'number' ? Number.isSafeInteger( ${varExpr} ) : ( typeof ${varExpr} !== 'bigint' || ( ${varExpr} >= -9007199254740991n && ${varExpr} <= 9007199254740991n ) ) )`
            );
            continue;
        }

        if( c.type === 'positive' )
        {
            checks.push( `( typeof ${varExpr} === 'bigint' ? ${varExpr} > 0n : ${varExpr} > 0 )` );
            continue;
        }

        if( c.type === 'nonNegative' )
        {
            checks.push( `( typeof ${varExpr} === 'bigint' ? ${varExpr} >= 0n : ${varExpr} >= 0 )` );
            continue;
        }

        if( c.type === 'negative' )
        {
            checks.push( `( typeof ${varExpr} === 'bigint' ? ${varExpr} < 0n : ${varExpr} < 0 )` );
            continue;
        }

        if( c.type === 'finite' )
        {
            checks.push( `( typeof ${varExpr} !== 'number' || Number.isFinite( ${varExpr} ) )` );
            continue;
        }

        if( c.type === 'minDate' )
        {
            checks.push( `__tcRuntime.isMinDateValid( ${varExpr}, ${JSON.stringify( String( c.value ))} )` );
            continue;
        }

        if( c.type === 'maxDate' )
        {
            checks.push( `__tcRuntime.isMaxDateValid( ${varExpr}, ${JSON.stringify( String( c.value ))} )` );
            continue;
        }

        if( c.type === 'pattern' )
        {
            const src = String( c.value );
            let syntaxOk = true;

            try
            {
                new RegExp( src );
            }
            catch
            {
                syntaxOk = false;
            }

            if( !syntaxOk || !isSafeRegexSource( src ))
            {
                checks.push( 'false' );
                continue;
            }

            const reVar = nextVar( state, 're' );
            state.hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( src )} );` );
            checks.push( `( Boolean( ${reVar} ) && __tcRuntime.testRegex( ${reVar}, ${varExpr} ) )` );
            continue;
        }

        if( c.type === 'format' )
        {
            checks.push( `__tcRuntime.isFormatValid( ${varExpr}, ${JSON.stringify( String( c.value ))} )` );
            continue;
        }

        if( c.type === 'minItems' )
        {
            checks.push( `( ( ${varExpr} instanceof Set ? ${varExpr}.size : ${varExpr}.length ) >= ${c.value} )` );
            continue;
        }

        if( c.type === 'maxItems' )
        {
            checks.push( `( ( ${varExpr} instanceof Set ? ${varExpr}.size : ${varExpr}.length ) <= ${c.value} )` );
            continue;
        }

        if( c.type === 'uniqueItems' )
        {
            checks.push( `__tcRuntime.hasUniqueItems( ${varExpr} )` );
            continue;
        }

        if( c.type === 'minProperties' )
        {
            checks.push( `( ( ${varExpr} instanceof Map ? ${varExpr}.size : Object.keys( ${varExpr} ).length ) >= ${c.value} )` );
            continue;
        }

        if( c.type === 'maxProperties' )
        {
            checks.push( `( ( ${varExpr} instanceof Map ? ${varExpr}.size : Object.keys( ${varExpr} ).length ) <= ${c.value} )` );
            continue;
        }

        return undefined;
    }

    return checks;
}

function combineBaseAndConstraints( baseExpr: string, constraintChecks: readonly string[], varExpr: string ): string
{
    if( constraintChecks.length === 0 ){ return baseExpr }

    const constraintExpr = constraintChecks.length === 1
        ? constraintChecks[0]
        : `( ${constraintChecks.join( ' && ' )} )`;
    const guarded = `( ${varExpr} === undefined || ${varExpr} === null ? true : ${constraintExpr} )`;

    if( baseExpr === 'true' ){ return guarded }

    return `( ${baseExpr} && ${guarded} )`;
}

function collectExtraJsDocConstraints(
    propType         : ts.Type,
    jsdocConstraints : readonly ParsedConstraint[] | undefined,
    state            : GuardState
): ParsedConstraint[]
{
    if( !jsdocConstraints || jsdocConstraints.length === 0 ){ return [] }

    let existing = new Set<string>();

    if( typeof propType.isIntersection === 'function' && propType.isIntersection())
    {
        const peeled = peelTaggedIntersection( propType, state.checker, state.scope );

        if( peeled )
        {
            existing = new Set( peeled.constraints.map( c => c.type ));
        }
    }

    return jsdocConstraints.filter( c => !existing.has( c.type ));
}

function emitObjectGuard(
    props           : readonly MergedPropInfo[],
    stringIndexType : ts.Type | undefined,
    varExpr         : string,
    state           : GuardState
): string | undefined
{
    const conds: string[] = [ `__tcRuntime.isPlainObject( ${varExpr} )` ];
    let keysVar: string | undefined;

    if( !stringIndexType )
    {
        if( props.length === 0 )
        {
            conds.push( `( Object.keys( ${varExpr} ).length === 0 )` );
        }
        else
        {
            keysVar = nextVar( state, 'keys' );
            state.hoisted.push( `const ${keysVar} = new Set( ${JSON.stringify( props.map( p => p.name ))} );` );
            conds.push( `__tcRuntime.hasOnlyAllowedKeys( ${varExpr}, ${keysVar} )` );
        }
    }

    for( const prop of props )
    {
        if( prop.hasDefault ){ return undefined }

        const acc = safePropAccess( varExpr, prop.name );
        const keyJson = JSON.stringify( prop.name );
        const effType = prop.isOptional ? stripUndefinedFromUnion( prop.type ) : prop.type;
        let propExpr = emitGuard( effType, acc, state );

        if( propExpr === undefined ){ return undefined }

        const extraJsDoc = collectExtraJsDocConstraints( prop.type, prop.jsdocConstraints, state );

        if( extraJsDoc.length > 0 )
        {
            const extraChecks = emitConstraintChecks( extraJsDoc, acc, state );

            if( extraChecks === undefined ){ return undefined }

            propExpr = combineBaseAndConstraints( propExpr, extraChecks, acc );
        }

        if( prop.isOptional )
        {
            if( propExpr !== 'true' )
            {
                conds.push( `( !Object.hasOwn( ${varExpr}, ${keyJson} ) || ${acc} === undefined || ${propExpr} )` );
            }
        }
        else
        {
            conds.push(
                propExpr === 'true'
                    ? `Object.hasOwn( ${varExpr}, ${keyJson} )`
                    : `( Object.hasOwn( ${varExpr}, ${keyJson} ) && ${propExpr} )`
            );
        }
    }

    if( stringIndexType )
    {
        const valVar = nextVar( state, 'idxv' );
        const idxExpr = emitGuard( stringIndexType, valVar, state );

        if( idxExpr === undefined ){ return undefined }

        if( idxExpr !== 'true' )
        {
            if( props.length > 0 && !keysVar )
            {
                keysVar = nextVar( state, 'keys' );
                state.hoisted.push( `const ${keysVar} = new Set( ${JSON.stringify( props.map( p => p.name ))} );` );
            }

            const fnVar = nextVar( state, 'idx' );
            const skipKnown = keysVar ? `if( ${keysVar}.has( k ) ) continue; ` : '';
            state.hoisted.push(
                `const ${fnVar} = ( o ) => { const ks = Object.keys( o ); for( let i = 0; i < ks.length; i++ ){ const k = ks[i]; ${skipKnown}const ${valVar} = o[k]; if( !( ${idxExpr} ) ) return false; } return true; };`
            );
            conds.push( `${fnVar}( ${varExpr} )` );
        }
    }

    return conds.length === 1 ? conds[0] : `( ${conds.join( ' && ' )} )`;
}

function emitGuardInner( type: ts.Type, varExpr: string, state: GuardState ): string | undefined
{
    assertNotTypeParameter( type );

    const { checker, scope } = state;
    const flags = type.getFlags();
    const appliedConstraintTypes = new Set<string>();

    const isUnion = !( flags & ts.TypeFlags.Boolean ) &&
        Boolean((( flags & ts.TypeFlags.Union ) !== 0 || type.isUnion()) && ( type as any ).types );
    const isIntersection = Boolean((( flags & ts.TypeFlags.Intersection ) !== 0 || type.isIntersection()) && ( type as any ).types );

    let result: string | undefined;

    if( isUnion )
    {
        const rawMembers = ( type as ts.UnionType ).types;

        if( rawMembers.some( m => typeHasDefaultTag( m, checker ))){ return undefined }

        if( rawMembers.length === 1 )
        {
            result = emitGuard( rawMembers[0], varExpr, state );
        }
        else
        {
            const tagged = tryTaggedUnionTypes( rawMembers, checker );

            if( tagged && rawMembers.length >= 4 )
            {
                const cases: string[] = [];

                for( let i = 0; i < rawMembers.length; i++ )
                {
                    const armExpr = emitGuard( rawMembers[i], 'u', state );

                    if( armExpr === undefined ){ return undefined }

                    const tagLit = typeof tagged.arms[i].tag === 'string'
                        ? JSON.stringify( tagged.arms[i].tag )
                        : String( tagged.arms[i].tag );
                    cases.push( `case ${tagLit}: return ${armExpr};` );
                }

                const discFn = nextVar( state, 'tu' );
                const keyJson = JSON.stringify( tagged.key );
                const discAcc = safePropAccess( 'u', tagged.key );
                state.hoisted.push(
                    `const ${discFn} = ( u ) => { if( !__tcRuntime.isPlainObject( u ) || !Object.hasOwn( u, ${keyJson} ) ) return false; switch( ${discAcc} ){ ${cases.join( ' ' )} default: return false; } };`
                );
                result = `${discFn}( ${varExpr} )`;
            }
            else
            {
                const armExprs: string[] = [];

                for( const member of rawMembers )
                {
                    const armExpr = emitGuard( member, varExpr, state );

                    if( armExpr === undefined ){ return undefined }

                    if( armExpr === 'true' )
                    {
                        armExprs.length = 0;
                        armExprs.push( 'true' );
                        break;
                    }

                    if( armExpr !== 'false' ){ armExprs.push( armExpr ) }
                }

                result = armExprs.length === 0
                    ? 'false'
                    : ( armExprs.length === 1 ? armExprs[0] : `( ${armExprs.join( ' || ' )} )` );
            }
        }
    }
    else if( isIntersection )
    {
        const types = ( type as ts.IntersectionType ).types;
        const peeled = peelTaggedIntersection( type, checker, scope );

        if( peeled?.hasTags )
        {
            for( const c of peeled.constraints ){ appliedConstraintTypes.add( c.type ) }

            const constraintChecks = emitConstraintChecks( peeled.constraints, varExpr, state );

            if( constraintChecks === undefined ){ return undefined }

            const nonConstraintTypes = types.filter( t => !isConstraintOnlyType( t, checker ) && !isBrandOnlyType( t, checker ));
            let baseExpr: string | undefined;

            if( nonConstraintTypes.length === 1 )
            {
                baseExpr = emitGuard( nonConstraintTypes[0], varExpr, state );
            }
            else if( nonConstraintTypes.length > 1 )
            {
                const merged = tryMergeObjectTypes( nonConstraintTypes, checker, type );

                if( !merged || ( merged.patternIndexInfos && merged.patternIndexInfos.length > 0 ))
                {
                    return undefined;
                }

                baseExpr = emitObjectGuard( merged.props, merged.indexType, varExpr, state );
            }
            else
            {
                return undefined;
            }

            if( baseExpr === undefined ){ return undefined }

            result = combineBaseAndConstraints( baseExpr, constraintChecks, varExpr );
        }
        else if( peeled )
        {
            result = emitGuard( peeled.base, varExpr, state );
        }
        else
        {
            const merged = tryMergeObjectTypes( types, checker, type );

            if( !merged || ( merged.patternIndexInfos && merged.patternIndexInfos.length > 0 ))
            {
                return undefined;
            }

            result = emitObjectGuard( merged.props, merged.indexType, varExpr, state );
        }
    }
    else if( type.getSymbol()?.name === 'Date' )
    {
        result = `( ${varExpr} instanceof Date && !Number.isNaN( ${varExpr}.getTime() ) )`;
    }
    else if( type.getSymbol()?.name === 'URL' )
    {
        result = `( ${varExpr} instanceof URL )`;
    }
    else if( type.getSymbol()?.name === 'RegExp' )
    {
        result = `( ${varExpr} instanceof RegExp )`;
    }
    else if( type.getSymbol()?.name === 'Set' || type.getSymbol()?.name === 'ReadonlySet' )
    {
        const elemType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        const itemVar = nextVar( state, 'si' );
        const elemExpr = emitGuard( elemType, itemVar, state );

        if( elemExpr === undefined ){ return undefined }

        if( elemExpr === 'true' )
        {
            result = `( ${varExpr} instanceof Set )`;
        }
        else
        {
            const fnVar = nextVar( state, 'set' );
            state.hoisted.push(
                `const ${fnVar} = ( s ) => { if( !( s instanceof Set ) ) return false; for( const ${itemVar} of s ){ if( !( ${elemExpr} ) ) return false; } return true; };`
            );
            result = `${fnVar}( ${varExpr} )`;
        }
    }
    else if( type.getSymbol()?.name === 'Map' || type.getSymbol()?.name === 'ReadonlyMap' )
    {
        const keyType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        const valType = ( type as ts.TypeReference ).typeArguments?.[1] || checker.getAnyType();
        const kVar = nextVar( state, 'mk' );
        const vVar = nextVar( state, 'mv' );
        const keyExpr = emitGuard( keyType, kVar, state );

        if( keyExpr === undefined ){ return undefined }

        const valExpr = emitGuard( valType, vVar, state );

        if( valExpr === undefined ){ return undefined }

        if( keyExpr === 'true' && valExpr === 'true' )
        {
            result = `( ${varExpr} instanceof Map )`;
        }
        else
        {
            const fnVar = nextVar( state, 'map' );
            const entryCond = keyExpr === 'true'
                ? valExpr
                : ( valExpr === 'true' ? keyExpr : `( ${keyExpr} && ${valExpr} )` );
            state.hoisted.push(
                `const ${fnVar} = ( m ) => { if( !( m instanceof Map ) ) return false; for( const [ ${kVar}, ${vVar} ] of m ){ if( !( ${entryCond} ) ) return false; } return true; };`
            );
            result = `${fnVar}( ${varExpr} )`;
        }
    }
    else if(
        type.getSymbol()?.name === 'Promise' ||
        type.getSymbol()?.name === 'File' ||
        type.getSymbol()?.name === 'Blob' ||
        Boolean( type.getSymbol()?.name && BUFFER_LIKE.has( type.getSymbol()!.name ))
    )
    {
        const ctorName = JSON.stringify( type.getSymbol()!.name );
        result = `( typeof globalThis[${ctorName}] === 'function' && ${varExpr} instanceof globalThis[${ctorName}] )`;
    }
    else if( flags & ts.TypeFlags.Null )
    {
        result = `( ${varExpr} === null )`;
    }
    else if( flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Void ))
    {
        result = `( ${varExpr} === undefined )`;
    }
    else if( flags & ts.TypeFlags.StringMapping )
    {
        const kind = typeSymbolName( type );

        if( kind === 'Uppercase' )
        {
            result = `( typeof ${varExpr} === 'string' && ${varExpr} === ${varExpr}.toUpperCase() )`;
        }
        else if( kind === 'Lowercase' )
        {
            result = `( typeof ${varExpr} === 'string' && ${varExpr} === ${varExpr}.toLowerCase() )`;
        }
        else if( kind === 'Capitalize' )
        {
            result = `( typeof ${varExpr} === 'string' && ( ${varExpr}.length === 0 || ${varExpr}.charAt( 0 ) === ${varExpr}.charAt( 0 ).toUpperCase() ) )`;
        }
        else if( kind === 'Uncapitalize' )
        {
            result = `( typeof ${varExpr} === 'string' && ( ${varExpr}.length === 0 || ${varExpr}.charAt( 0 ) === ${varExpr}.charAt( 0 ).toLowerCase() ) )`;
        }
        else
        {
            result = `( typeof ${varExpr} === 'string' )`;
        }
    }
    else if( flags & ts.TypeFlags.String )
    {
        result = `( typeof ${varExpr} === 'string' )`;
    }
    else if( flags & ts.TypeFlags.Number )
    {
        result = `( typeof ${varExpr} === 'number' && !Number.isNaN( ${varExpr} ) )`;
    }
    else if( flags & ts.TypeFlags.BigInt )
    {
        result = `( typeof ${varExpr} === 'bigint' )`;
    }
    else if( flags & ts.TypeFlags.Boolean )
    {
        result = `( typeof ${varExpr} === 'boolean' )`;
    }
    else if( flags & ts.TypeFlags.Never )
    {
        result = 'false';
    }
    else if( flags & ( ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol ) || ( type as any ).intrinsicName === 'symbol' )
    {
        result = `( typeof ${varExpr} === 'symbol' )`;
    }
    else if( flags & ts.TypeFlags.TemplateLiteral )
    {
        const regexStr = buildTemplateLiteralRegex( type as ts.TemplateLiteralType );

        if( !isSafeRegexSource( regexStr )){ return undefined }

        const reVar = nextVar( state, 're' );
        state.hoisted.push( `const ${reVar} = __tcRuntime.getCachedPattern( ${JSON.stringify( regexStr )} );` );
        result = `( typeof ${varExpr} === 'string' && Boolean( ${reVar} ) && __tcRuntime.testRegex( ${reVar}, ${varExpr} ) )`;
    }
    else if( type.isStringLiteral())
    {
        result = `( ${varExpr} === ${JSON.stringify( type.value )} )`;
    }
    else if( type.isNumberLiteral())
    {
        result = `( ${varExpr} === ${type.value} )`;
    }
    else if( flags & ts.TypeFlags.BooleanLiteral )
    {
        result = `( ${varExpr} === ${( type as any ).intrinsicName === 'true'} )`;
    }
    else if( flags & ts.TypeFlags.BigIntLiteral )
    {
        result = `( ${varExpr} === ${bigIntLiteralText( type )}n )`;
    }
    else if( checker.isTupleType( type ))
    {
        const { typeArgs, elementFlags, hasRest, fixedCount, minItems, restType, suffixTypes } = inspectTupleType( type, checker );
        const suffixLen = suffixTypes.length;
        const minPrefix = minItems - suffixLen;
        const maxLen = fixedCount + suffixLen;
        const fnVar = nextVar( state, 'tup' );
        const stmts: string[] = [
            `if( !Array.isArray( a ) || a.length < ${minItems}${hasRest ? '' : ` || a.length > ${maxLen}`} ) return false;`,
            `const restEnd = a.length - ${suffixLen};`,
            `const fixedLim = restEnd < ${fixedCount} ? restEnd : ${fixedCount};`
        ];

        for( let i = 0; i < fixedCount; i++ )
        {
            const isOpt = ( elementFlags[i] & ts.ElementFlags.Optional ) !== 0;
            const elemT = isOpt ? stripUndefinedFromUnion( typeArgs[i]) : typeArgs[i];
            const elemExpr = emitGuard( elemT, `a[${i}]`, state );

            if( elemExpr === undefined ){ return undefined }

            if( i >= minPrefix )
            {
                stmts.push( `if( ${i} < fixedLim && a[${i}] !== undefined && !( ${elemExpr} ) ) return false;` );
            }
            else if( elemExpr !== 'true' )
            {
                stmts.push( `if( !( ${elemExpr} ) ) return false;` );
            }
        }

        if( hasRest && restType )
        {
            const riVar = nextVar( state, 'ri' );
            const restExpr = emitGuard( restType, `a[${riVar}]`, state );

            if( restExpr === undefined ){ return undefined }

            if( restExpr !== 'true' )
            {
                stmts.push( `for( let ${riVar} = fixedLim; ${riVar} < restEnd; ${riVar}++ ){ if( !( ${restExpr} ) ) return false; }` );
            }
        }

        for( let j = 0; j < suffixLen; j++ )
        {
            const sufExpr = emitGuard( suffixTypes[j], `a[restEnd + ${j}]`, state );

            if( sufExpr === undefined ){ return undefined }

            if( sufExpr !== 'true' )
            {
                stmts.push( `if( !( ${sufExpr} ) ) return false;` );
            }
        }

        stmts.push( 'return true;' );
        state.hoisted.push( `const ${fnVar} = ( a ) => { ${stmts.join( ' ' )} };` );
        result = `${fnVar}( ${varExpr} )`;
    }
    else if( checker.isArrayType( type ))
    {
        const elemType = ( type as ts.TypeReference ).typeArguments?.[0] || checker.getAnyType();
        const itemVar = nextVar( state, 'ai' );
        const elemExpr = emitGuard( elemType, itemVar, state );

        if( elemExpr === undefined ){ return undefined }

        result = elemExpr === 'true'
            ? `Array.isArray( ${varExpr} )`
            : `( Array.isArray( ${varExpr} ) && ${varExpr}.every( ( ${itemVar} ) => ${elemExpr} ) )`;
    }
    else if(
        type.getCallSignatures().length > 0 ||
        type.getConstructSignatures().length > 0 ||
        typeSymbolName( type ) === 'Function'
    )
    {
        result = `( typeof ${varExpr} === 'function' )`;
    }
    else if( isNativeEnumType( type ))
    {
        const members = enumMemberTypes( type, checker );

        if( members.length === 0 && type.isUnion())
        {
            const exprs: string[] = [];

            for( const arm of ( type as ts.UnionType ).types )
            {
                const e = emitGuard( arm, varExpr, state );

                if( e === undefined ){ return undefined }

                exprs.push( e );
            }

            result = exprs.length === 1 ? exprs[0] : `( ${exprs.join( ' || ' )} )`;
        }
        else if( members.length === 0 )
        {
            result = `( typeof ${varExpr} === 'number' && !Number.isNaN( ${varExpr} ) )`;
        }
        else
        {
            const exprs: string[] = [];

            for( const member of members )
            {
                const e = emitGuard( member, varExpr, state );

                if( e === undefined ){ return undefined }

                exprs.push( e );
            }

            result = exprs.length === 1 ? exprs[0] : `( ${exprs.join( ' || ' )} )`;
        }
    }
    else
    {
        const classIdentity = resolveClassIdentity( type );

        if( classIdentity )
        {
            const declaration = classIdentity.declaration;
            const fromAmbientGlobal = declaration !== undefined &&
                declaration.getSourceFile().isDeclarationFile &&
                !ts.isExternalModule( declaration.getSourceFile());

            if( fromAmbientGlobal || !declaration )
            {
                const ctorName = JSON.stringify( classIdentity.name );
                result = `( typeof globalThis[${ctorName}] === 'function' && ${varExpr} instanceof globalThis[${ctorName}] )`;
            }
            else
            {
                const localName = scope.bind( classIdentity );
                result = `( typeof ${localName} === 'function' && ${varExpr} instanceof ${localName} )`;
            }
        }
        else
        {
            const ir = resolveTypeIr( type, checker );
            const stringIndexInfo = checker.getIndexInfoOfType( type, ts.IndexKind.String );
            const patternInfos = ir.getTemplateIndexInfos();

            if( patternInfos.length > 0 ){ return undefined }

            const rawProps = checker.getPropertiesOfType( type );
            const hasInterfaceTags = rawProps.some( p => isTagKey( p.getName()));
            const props = ir.getProps();

            if( flags & ts.TypeFlags.NonPrimitive )
            {
                result = `__tcRuntime.isPlainObject( ${varExpr} )`;
            }
            else if( flags & ts.TypeFlags.Object || type.isClassOrInterface() || stringIndexInfo )
            {
                result = emitObjectGuard( props, stringIndexInfo?.type, varExpr, state );

                if( result === undefined ){ return undefined }
            }
            else
            {
                result = 'true';
            }

            if( hasInterfaceTags )
            {
                const rawConstraints = collectConstraintsFromProps( rawProps, checker, scope );

                for( const c of rawConstraints ){ appliedConstraintTypes.add( c.type ) }

                if( rawConstraints.length > 0 )
                {
                    const ifaceChecks = emitConstraintChecks( rawConstraints, varExpr, state );

                    if( ifaceChecks === undefined ){ return undefined }

                    result = combineBaseAndConstraints( result, ifaceChecks, varExpr );
                }
            }
        }
    }

    if( result === undefined ){ return undefined }

    if( !isUnion )
    {
        const typeJsDoc = extractTypeJsDocInfo( type, checker );
        const extraConstraints = typeJsDoc.constraints.filter( c => !appliedConstraintTypes.has( c.type ));

        if( extraConstraints.length > 0 )
        {
            const extraChecks = emitConstraintChecks( extraConstraints, varExpr, state );

            if( extraChecks === undefined ){ return undefined }

            result = combineBaseAndConstraints( result, extraChecks, varExpr );
        }
    }

    return result;
}

function emitGuard( type: ts.Type, varExpr: string, state: GuardState ): string | undefined
{
    const typeId = ( type as any ).id;

    if( typeof typeId !== 'number' )
    {
        return emitGuardInner( type, varExpr, state );
    }

    if( state.knownCyclicIds.has( typeId ))
    {
        const existingFn = state.compiledFns.get( typeId );

        if( existingFn )
        {
            return `${existingFn}( ${varExpr} )`;
        }

        const fnName = nextVar( state, 'g' );
        state.compiledFns.set( typeId, fnName );
        const fnBody = emitGuardInner( type, 'v', state );

        if( fnBody === undefined ){ return undefined }

        state.hoisted.push( `function ${fnName}( v ){ return ${fnBody}; }` );

        return `${fnName}( ${varExpr} )`;
    }

    if( state.active.has( typeId ))
    {
        state.cyclicIds.add( typeId );

        return 'true';
    }

    state.active.add( typeId );

    try
    {
        return emitGuardInner( type, varExpr, state );
    }
    finally
    {
        state.active.delete( typeId );
    }
}

/**
 * Emit a zero-allocation boolean guard expression for `is<T>( input )`, or `undefined`
 * when `T` contains value-mutating defaults/transforms or context-dependent predicates
 * that require the full `ValidationContext` pipeline.
 */
export function generateGuardCode(
    type    : ts.Type,
    checker : ts.TypeChecker,
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): string | undefined
{
    const pass1: GuardState =
    {
        checker,
        scope,
        hoisted        : [],
        active         : new Set(),
        cyclicIds      : new Set(),
        knownCyclicIds : new Set(),
        compiledFns    : new Map(),
        counter        : 0
    };
    const firstBody = emitGuard( type, 'v', pass1 );

    if( firstBody === undefined ){ return undefined }

    if( pass1.cyclicIds.size === 0 )
    {
        if( pass1.hoisted.length === 0 )
        {
            return `( ( v ) => ${firstBody} )`;
        }

        return `( () => { ${pass1.hoisted.join( ' ' )} return ( v ) => ${firstBody}; } )()`;
    }

    const pass2: GuardState =
    {
        checker,
        scope,
        hoisted        : [],
        active         : new Set(),
        cyclicIds      : new Set(),
        knownCyclicIds : pass1.cyclicIds,
        compiledFns    : new Map(),
        counter        : 0
    };
    const cyclicBody = emitGuard( type, 'v', pass2 );

    if( cyclicBody === undefined ){ return undefined }

    return `( () => { ${pass2.hoisted.join( ' ' )} return ( v ) => ${cyclicBody}; } )()`;
}
