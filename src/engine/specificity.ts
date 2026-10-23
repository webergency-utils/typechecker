import ts from 'typescript';
import
{
    BUFFER_LIKE,
    TemplateIndexInfo,
    enumMemberTypes,
    isNativeEnumType,
    peelTaggedIntersection,
    stripUndefinedFromType,
    tryMergeObjectTypes,
    typeSymbolName
}
    from './type-helpers.js';
import { resolveTypeIr } from './type-ir.js';

export const MAX_SPECIFICITY_DEPTH = 16;

interface SpecificityCacheEntry
{
    score     : number
    maxHeight : number
}

interface SpecificityWalkState
{
    hitCycle      : boolean
    hitDepthLimit : boolean
    maxDepth      : number
}

const specificityCacheByChecker = new WeakMap<ts.TypeChecker, Map<number, SpecificityCacheEntry>>();

function getSpecificityCache( checker: ts.TypeChecker ): Map<number, SpecificityCacheEntry>
{
    let cache = specificityCacheByChecker.get( checker );

    if( !cache )
    {
        cache = new Map<number, SpecificityCacheEntry>();
        specificityCacheByChecker.set( checker, cache );
    }

    return cache;
}

function scoreObjectShape(
    props        : { type : ts.Type, isOptional : boolean }[],
    indexType    : ts.Type | undefined,
    patternInfos : TemplateIndexInfo[] | undefined,
    checker      : ts.TypeChecker,
    visited      : Set<number>,
    depth        : number,
    state        : SpecificityWalkState
): number
{
    if( props.length > 0 )
    {
        let score = depth === 0 ? 1000 : 0;

        for( const prop of props )
        {
            const propType = stripUndefinedFromType( prop.type );
            const childScore = getDeepSpecificityInternal( propType, checker, visited, depth + 1, state );
            const weight = 1.0 + 0.95 * childScore;

            score += prop.isOptional ? 0.25 * weight : weight;
        }

        if( patternInfos && patternInfos.length > 0 )
        {
            for( const pInfo of patternInfos )
            {
                score += 0.6 + 0.95 * getDeepSpecificityInternal( pInfo.valueType, checker, visited, depth + 1, state );
            }
        }

        if( indexType )
        {
            score += 0.5 + 0.95 * getDeepSpecificityInternal( indexType, checker, visited, depth + 1, state );
        }

        return score;
    }

    if( patternInfos && patternInfos.length > 0 )
    {
        let score = depth === 0 ? 600 : 0.6;

        for( const pInfo of patternInfos )
        {
            score += 0.95 * getDeepSpecificityInternal( pInfo.valueType, checker, visited, depth + 1, state );
        }

        return score;
    }

    if( indexType )
    {
        return ( depth === 0 ? 500 : 0.5 ) + 0.95 * getDeepSpecificityInternal( indexType, checker, visited, depth + 1, state );
    }

    return depth === 0 ? 200 : 0.2;
}

export function getDeepSpecificity(
    type    : ts.Type,
    checker : ts.TypeChecker,
    visited : Set<number> = new Set(),
    depth   : number = 0
): number
{
    const state: SpecificityWalkState =
    {
        hitCycle      : false,
        hitDepthLimit : false,
        maxDepth      : depth
    };

    return getDeepSpecificityInternal( type, checker, visited, depth, state );
}

function getDeepSpecificityInternal(
    type    : ts.Type,
    checker : ts.TypeChecker,
    visited : Set<number>,
    depth   : number,
    state   : SpecificityWalkState
): number
{
    if( depth > state.maxDepth ){ state.maxDepth = depth }

    if( depth >= MAX_SPECIFICITY_DEPTH )
    {
        state.hitDepthLimit = true;

        return 0;
    }

    const typeId = ( type as any ).id;
    let cache: Map<number, SpecificityCacheEntry> | undefined;
    let cacheKey = 0;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId ))
        {
            state.hitCycle = true;

            return 0;
        }

        cache = getSpecificityCache( checker );
        cacheKey = typeId * 2 + ( depth === 0 ? 0 : 1 );
        const cached = cache.get( cacheKey );

        if( cached && depth + cached.maxHeight < MAX_SPECIFICITY_DEPTH )
        {
            if( depth + cached.maxHeight > state.maxDepth )
            {
                state.maxDepth = depth + cached.maxHeight;
            }

            return cached.score;
        }

        visited.add( typeId );
    }

    const localState: SpecificityWalkState =
    {
        hitCycle      : false,
        hitDepthLimit : false,
        maxDepth      : depth
    };

    try
    {
        const score = computeDeepSpecificityBody( type, checker, visited, depth, localState );

        if( localState.maxDepth > state.maxDepth ){ state.maxDepth = localState.maxDepth }

        if( localState.hitCycle ){ state.hitCycle = true }

        if( localState.hitDepthLimit ){ state.hitDepthLimit = true }

        if( cache && !localState.hitCycle && !localState.hitDepthLimit )
        {
            cache.set( cacheKey, {
                score,
                maxHeight : Math.max( 0, localState.maxDepth - depth )
            });
        }

        return score;
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

function computeDeepSpecificityBody(
    type    : ts.Type,
    checker : ts.TypeChecker,
    visited : Set<number>,
    depth   : number,
    state   : SpecificityWalkState
): number
{
    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        const peeled = peelTaggedIntersection( type, checker );
        const constraintBonus = peeled
            ? ( depth === 0 ? 5 : 0.5 ) * peeled.constraints.length
            : 0;
        const baseType = peeled ? peeled.base : type;

        if( typeof baseType.isIntersection === 'function' && baseType.isIntersection())
        {
            const merged = tryMergeObjectTypes( baseType.types, checker );

            if( merged )
            {
                return constraintBonus + scoreObjectShape( merged.props, merged.indexType, merged.patternIndexInfos, checker, visited, depth, state );
            }

            return constraintBonus;
        }

        if( peeled )
        {
            return constraintBonus + getDeepSpecificityInternal( baseType, checker, visited, depth, state );
        }
    }

    if( isNativeEnumType( type ))
    {
        const members = enumMemberTypes( type, checker );

        if( members.length > 0 )
        {
            return depth === 0 ? 25 : 0.8;
        }
    }

    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

    if( flags & ts.TypeFlags.Boolean ){ return depth === 0 ? 10 : 0.1 }

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        const activeArms = type.types.filter( t =>
        {
            const armFlags = typeof t.getFlags === 'function' ? t.getFlags() : 0;

            return ( armFlags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void )) === 0;
        });

        if( activeArms.length === 0 ){ return 0 }

        if( activeArms.length === 1 )
        {
            return getDeepSpecificityInternal( activeArms[0], checker, visited, depth, state );
        }

        const boolLitArms = activeArms.filter( t =>
        {
            const armFlags = typeof t.getFlags === 'function' ? t.getFlags() : 0;

            return ( armFlags & ts.TypeFlags.BooleanLiteral ) !== 0;
        });

        if( boolLitArms.length >= 2 && activeArms.length === boolLitArms.length ){ return depth === 0 ? 10 : 0.1 }

        const scoredArms = boolLitArms.length >= 2
            ? activeArms.filter( t =>
            {
                const armFlags = typeof t.getFlags === 'function' ? t.getFlags() : 0;

                return ( armFlags & ts.TypeFlags.BooleanLiteral ) === 0;
            })
            : activeArms;

        let minScore = boolLitArms.length >= 2 ? ( depth === 0 ? 10 : 0.1 ) : Infinity;
        let maxScore = boolLitArms.length >= 2 ? ( depth === 0 ? 10 : 0.1 ) : -Infinity;

        for( const arm of scoredArms )
        {
            const s = getDeepSpecificityInternal( arm, checker, visited, depth, state );

            if( s < minScore ){ minScore = s }

            if( s > maxScore ){ maxScore = s }
        }

        return minScore + 0.001 * maxScore;
    }

    if(
        flags & (
            ts.TypeFlags.Any |
            ts.TypeFlags.Unknown |
            ts.TypeFlags.Null |
            ts.TypeFlags.Undefined |
            ts.TypeFlags.Void |
            ts.TypeFlags.Never
        )
    )
    {
        return 0;
    }

    if( flags & ts.TypeFlags.NonPrimitive ){ return depth === 0 ? 5 : 0.05 }

    if(
        ( typeof type.isStringLiteral === 'function' && type.isStringLiteral()) ||
        ( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral()) ||
        ( flags & (
            ts.TypeFlags.StringLiteral |
            ts.TypeFlags.NumberLiteral |
            ts.TypeFlags.BooleanLiteral |
            ts.TypeFlags.BigIntLiteral
        )) !== 0
    )
    {
        return depth === 0 ? 25 : 0.8;
    }

    if( flags & ts.TypeFlags.TemplateLiteral )
    {
        return depth === 0 ? 20 : 0.6;
    }

    if(
        flags & (
            ts.TypeFlags.String |
            ts.TypeFlags.Number |
            ts.TypeFlags.Boolean |
            ts.TypeFlags.BigInt |
            ts.TypeFlags.ESSymbol
        )
    )
    {
        return depth === 0 ? 10 : 0.1;
    }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( type ))
    {
        const typeArgs = ( type as ts.TupleTypeReference ).typeArguments ||
            ( typeof checker.getTypeArguments === 'function' ? checker.getTypeArguments( type as ts.TypeReference ) : []);
        let tupleScore = depth === 0 ? 50 : 0;

        for( const elem of typeArgs )
        {
            tupleScore += 1.0 + 0.95 * getDeepSpecificityInternal( elem, checker, visited, depth + 1, state );
        }

        return tupleScore;
    }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( type ))
    {
        const typeArgs = typeof checker.getTypeArguments === 'function'
            ? checker.getTypeArguments( type as ts.TypeReference )
            : [];
        const elemScore = typeArgs[0]
            ? getDeepSpecificityInternal( typeArgs[0], checker, visited, depth + 1, state )
            : 0;

        return ( depth === 0 ? 15 : 0.3 ) + 0.95 * elemScore;
    }

    const symbolName = typeSymbolName( type );

    if( symbolName === 'Set' || symbolName === 'ReadonlySet' )
    {
        const typeArgs = typeof checker.getTypeArguments === 'function'
            ? checker.getTypeArguments( type as ts.TypeReference )
            : ( type as ts.TypeReference ).typeArguments || [];
        const elemScore = typeArgs[0]
            ? getDeepSpecificityInternal( typeArgs[0], checker, visited, depth + 1, state )
            : 0;

        return ( depth === 0 ? 15 : 0.3 ) + 0.95 * elemScore;
    }

    if( symbolName === 'Map' || symbolName === 'ReadonlyMap' )
    {
        const typeArgs = typeof checker.getTypeArguments === 'function'
            ? checker.getTypeArguments( type as ts.TypeReference )
            : ( type as ts.TypeReference ).typeArguments || [];
        const keyScore = typeArgs[0]
            ? getDeepSpecificityInternal( typeArgs[0], checker, visited, depth + 1, state )
            : 0;
        const valScore = typeArgs[1]
            ? getDeepSpecificityInternal( typeArgs[1], checker, visited, depth + 1, state )
            : 0;

        return ( depth === 0 ? 15 : 0.3 ) + 0.95 * ( keyScore + valScore );
    }

    if(
        symbolName === 'Date' ||
        symbolName === 'URL' ||
        symbolName === 'RegExp' ||
        symbolName === 'Error' ||
        symbolName === 'Promise' ||
        ( symbolName !== undefined && BUFFER_LIKE.has( symbolName ))
    )
    {
        return depth === 0 ? 10 : 0.1;
    }

    if( !( flags & ts.TypeFlags.Object )){ return 0 }

    if( typeof type.getCallSignatures === 'function' && type.getCallSignatures().length > 0 )
    {
        return 0;
    }

    const ir = resolveTypeIr( type, checker );
    const props = ir.getProps();
    const idxType = ir.getStringIndexType();
    const patternInfos = ir.getTemplateIndexInfos();

    return scoreObjectShape( props, idxType, patternInfos, checker, visited, depth, state );
}

export function sortUnionArmsBySpecificity(
    types   : readonly ts.Type[],
    checker : ts.TypeChecker
): ts.Type[]
{
    const scored = types.map(( arm, index ) => ({
        arm,
        index,
        score : getDeepSpecificity( arm, checker )
    }));

    scored.sort(( a, b ) =>
    {
        const diff = b.score - a.score;

        if( Math.abs( diff ) > 1e-9 ){ return diff }

        return a.index - b.index;
    });

    return scored.map( entry => entry.arm );
}

export function isFallbackUnionArm(
    type    : ts.Type,
    checker : ts.TypeChecker,
    visited : Set<number> = new Set()
): boolean
{
    let current = type;
    const typeId = ( current as any ).id;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId )){ return false }

        visited.add( typeId );
    }

    try
    {
        if( typeof current.isIntersection === 'function' && current.isIntersection())
        {
            if( tryMergeObjectTypes( current.types, checker )){ return false }

            const peeled = peelTaggedIntersection( current, checker );

            if( peeled ){ current = peeled.base }
        }

        const flags = typeof current.getFlags === 'function' ? current.getFlags() : 0;

        if( flags & ( ts.TypeFlags.NonPrimitive | ts.TypeFlags.Any | ts.TypeFlags.Unknown )){ return true }

        if( typeof checker.isArrayType === 'function' && checker.isArrayType( current ))
        {
            const typeArgs = typeof checker.getTypeArguments === 'function'
                ? checker.getTypeArguments( current as ts.TypeReference )
                : [];

            return Boolean( typeArgs[0] && isFallbackUnionArm( typeArgs[0], checker, visited ));
        }

        if( typeof checker.isTupleType === 'function' && checker.isTupleType( current ))
        {
            const typeArgs = ( current as ts.TupleTypeReference ).typeArguments ||
                ( typeof checker.getTypeArguments === 'function' ? checker.getTypeArguments( current as ts.TypeReference ) : []);

            return typeArgs.length > 0 &&
                typeArgs.some( elem => containsObjectCandidate( elem, checker, new Set())) &&
                typeArgs.every( elem => !containsObjectCandidate( elem, checker, new Set()) || isFallbackUnionArm( elem, checker, visited ));
        }

        const symbolName = typeSymbolName( current );

        if( symbolName === 'Set' || symbolName === 'ReadonlySet' )
        {
            const typeArgs = typeof checker.getTypeArguments === 'function'
                ? checker.getTypeArguments( current as ts.TypeReference )
                : ( current as ts.TypeReference ).typeArguments || [];

            return Boolean( typeArgs[0] && isFallbackUnionArm( typeArgs[0], checker, visited ));
        }

        if( symbolName === 'Map' || symbolName === 'ReadonlyMap' )
        {
            const typeArgs = typeof checker.getTypeArguments === 'function'
                ? checker.getTypeArguments( current as ts.TypeReference )
                : ( current as ts.TypeReference ).typeArguments || [];

            return Boolean( typeArgs[1] && isFallbackUnionArm( typeArgs[1], checker, visited ));
        }

        return false;
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

type CompetingCategory = 'object' | 'array' | 'tuple' | 'set' | 'map' | 'wildcard';

function containsObjectCandidate(
    type    : ts.Type,
    checker : ts.TypeChecker,
    visited : Set<number>
): boolean
{
    return getCompetingCategory( type, checker, visited ) !== undefined;
}

function getCompetingCategory(
    type    : ts.Type,
    checker : ts.TypeChecker,
    visited : Set<number> = new Set()
): CompetingCategory | undefined
{
    let current = type;
    const typeId = ( current as any ).id;

    if( typeof typeId === 'number' )
    {
        if( visited.has( typeId )){ return undefined }

        visited.add( typeId );
    }

    try
    {
        if( typeof current.isIntersection === 'function' && current.isIntersection())
        {
            if( tryMergeObjectTypes( current.types, checker )){ return 'object' }

            const peeled = peelTaggedIntersection( current, checker );

            if( peeled ){ current = peeled.base }
        }

        if( typeof current.isUnion === 'function' && current.isUnion())
        {
            for( const sub of current.types )
            {
                const cat = getCompetingCategory( sub, checker, visited );

                if( cat ){ return cat }
            }

            return undefined;
        }

        const flags = typeof current.getFlags === 'function' ? current.getFlags() : 0;

        if( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown )){ return 'wildcard' }

        if( flags & ts.TypeFlags.NonPrimitive ){ return 'object' }

        if( !( flags & ts.TypeFlags.Object )){ return undefined }

        if( typeof checker.isArrayType === 'function' && checker.isArrayType( current ))
        {
            const typeArgs = typeof checker.getTypeArguments === 'function'
                ? checker.getTypeArguments( current as ts.TypeReference )
                : [];

            return typeArgs[0] && containsObjectCandidate( typeArgs[0], checker, visited ) ? 'array' : undefined;
        }

        if( typeof checker.isTupleType === 'function' && checker.isTupleType( current ))
        {
            const typeArgs = ( current as ts.TupleTypeReference ).typeArguments ||
                ( typeof checker.getTypeArguments === 'function' ? checker.getTypeArguments( current as ts.TypeReference ) : []);

            return typeArgs.some( elem => containsObjectCandidate( elem, checker, visited )) ? 'tuple' : undefined;
        }

        if( typeof current.getCallSignatures === 'function' && current.getCallSignatures().length > 0 ){ return undefined }

        const symbolName = typeSymbolName( current );

        if( symbolName === 'Set' || symbolName === 'ReadonlySet' )
        {
            const typeArgs = typeof checker.getTypeArguments === 'function'
                ? checker.getTypeArguments( current as ts.TypeReference )
                : ( current as ts.TypeReference ).typeArguments || [];

            return typeArgs[0] && containsObjectCandidate( typeArgs[0], checker, visited ) ? 'set' : undefined;
        }

        if( symbolName === 'Map' || symbolName === 'ReadonlyMap' )
        {
            const typeArgs = typeof checker.getTypeArguments === 'function'
                ? checker.getTypeArguments( current as ts.TypeReference )
                : ( current as ts.TypeReference ).typeArguments || [];
            const hasKeyObj = Boolean( typeArgs[0] && containsObjectCandidate( typeArgs[0], checker, visited ));
            const hasValObj = Boolean( typeArgs[1] && containsObjectCandidate( typeArgs[1], checker, visited ));

            return hasKeyObj || hasValObj ? 'map' : undefined;
        }

        if(
            symbolName === 'Date' ||
            symbolName === 'URL' ||
            symbolName === 'RegExp' ||
            symbolName === 'Error' ||
            symbolName === 'Promise' ||
            ( symbolName !== undefined && BUFFER_LIKE.has( symbolName ))
        )
        {
            return undefined;
        }

        return 'object';
    }
    finally
    {
        if( typeof typeId === 'number' ){ visited.delete( typeId ) }
    }
}

export function hasCompetingObjectArms(
    types   : readonly ts.Type[],
    checker : ts.TypeChecker
): boolean
{
    const counts: Record<Exclude<CompetingCategory, 'wildcard'>, number> =
    {
        object : 0,
        array  : 0,
        tuple  : 0,
        set    : 0,
        map    : 0
    };
    let wildcards = 0;

    for( const arm of types )
    {
        const cat = getCompetingCategory( arm, checker );

        if( !cat ){ continue }

        if( cat === 'wildcard' )
        {
            wildcards++;

            if(
                wildcards >= 2 ||
                counts.object >= 1 ||
                counts.array >= 1 ||
                counts.tuple >= 1 ||
                counts.set >= 1 ||
                counts.map >= 1
            )
            {
                return true;
            }

            continue;
        }

        counts[cat]++;

        if( counts[cat] + wildcards >= 2 ){ return true }
    }

    return false;
}

function acceptsUndefinedOrWildcard( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        const peeled = peelTaggedIntersection( type, checker );

        if( peeled )
        {
            if( peeled.constraints.some( c => c.type === 'default' || c.type === 'transform_custom' ))
            {
                return true;
            }

            return acceptsUndefinedOrWildcard( peeled.base, checker );
        }
    }

    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

    if( flags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Any | ts.TypeFlags.Unknown ))
    {
        return true;
    }

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        return type.types.some( t => acceptsUndefinedOrWildcard( t, checker ));
    }

    return false;
}

/**
 * Inspect whether every arm in an untagged object union has at least one strict required key
 * that does not appear (required or optional) on any other arm in the union.
 * Returns the array of exclusive required keys (aligned 1:1 with `types`) when satisfied.
 */
export function tryExclusiveKeyUnion(
    types   : readonly ts.Type[],
    checker : ts.TypeChecker
): string[] | undefined
{
    if( types.length < 2 ){ return undefined }

    const armPropsList: { allKeys : Set<string>, reqKeys : string[] }[] = [];

    for( const arm of types )
    {
        let current = arm;

        if( typeof current.isIntersection === 'function' && current.isIntersection())
        {
            const peeled = peelTaggedIntersection( current, checker );

            if( peeled && peeled.constraints.length > 0 ){ return undefined }

            const merged = tryMergeObjectTypes( peeled ? ( peeled.base.isIntersection() ? peeled.base.types : [ peeled.base ]) : current.types, checker );

            if( merged )
            {
                if( merged.indexType || ( merged.patternIndexInfos && merged.patternIndexInfos.length > 0 )){ return undefined }

                const allKeys = new Set( merged.props.map( p => p.name ));
                const reqKeys = merged.props
                    .filter( p => !p.isOptional && !p.hasDefault && !acceptsUndefinedOrWildcard( p.type, checker ))
                    .map( p => p.name );

                if( reqKeys.length === 0 ){ return undefined }

                armPropsList.push({ allKeys, reqKeys });
                continue;
            }

            if( peeled ){ current = peeled.base }
            else { return undefined }
        }

        const flags = typeof current.getFlags === 'function' ? current.getFlags() : 0;

        if( !( flags & ts.TypeFlags.Object )){ return undefined }

        if( typeof checker.isArrayType === 'function' && checker.isArrayType( current )){ return undefined }

        if( typeof checker.isTupleType === 'function' && checker.isTupleType( current )){ return undefined }

        if( typeof current.getCallSignatures === 'function' && current.getCallSignatures().length > 0 ){ return undefined }

        const ir = resolveTypeIr( current, checker );
        const symbolName = ir.symbolName;

        if(
            symbolName === 'Date' ||
            symbolName === 'URL' ||
            symbolName === 'Set' ||
            symbolName === 'ReadonlySet' ||
            symbolName === 'Map' ||
            symbolName === 'ReadonlyMap' ||
            symbolName === 'RegExp' ||
            symbolName === 'Error' ||
            symbolName === 'Promise' ||
            ( symbolName !== undefined && BUFFER_LIKE.has( symbolName ))
        )
        {
            return undefined;
        }

        if( ir.getStringIndexType() || ir.getTemplateIndexInfos().length > 0 ){ return undefined }

        const props = ir.getProps();
        const allKeys = new Set( props.map( p => p.name ));
        const reqKeys = props
            .filter( p => !p.isOptional && !p.hasDefault && !acceptsUndefinedOrWildcard( p.type, checker ))
            .map( p => p.name );

        if( reqKeys.length === 0 ){ return undefined }

        armPropsList.push({ allKeys, reqKeys });
    }

    const exclusiveKeys: string[] = [];

    for( let i = 0; i < armPropsList.length; i++ )
    {
        const candidate = armPropsList[i].reqKeys.find( key =>
        {
            for( let j = 0; j < armPropsList.length; j++ )
            {
                if( i !== j && armPropsList[j].allKeys.has( key )){ return false }
            }

            return true;
        });

        if( !candidate ){ return undefined }

        exclusiveKeys.push( candidate );
    }

    return exclusiveKeys;
}

