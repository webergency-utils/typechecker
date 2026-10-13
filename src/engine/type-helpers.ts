import ts from 'typescript';
import { isTagKey } from './tagKeys.js';
import { resolveFunctionIdentity, type ICustomFunctionScope } from './customFns.js';
export { isTagKey };

export const BUFFER_LIKE: ReadonlySet<string> = new Set([
    'Buffer', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
    'Float32Array', 'Float64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView'
]);

export type ParsedConstraint =
    {
        type         : string
        value?       : any
        message?     : string
        /** Nested schema type for `contains` / `propertyNames`. */
        nestedType?  : ts.Type
        /** AOT validator expression attached by the resolver before emit. */
        nestedCheck? : ts.Expression
    };

/** No-op scope for codegen unit tests that never hit Custom tags. */
export const VERBATIM_CUSTOM_SCOPE: ICustomFunctionScope =
{
    bind    : identity => identity.name,
    imports : []
};

export type TaggedUnionInfo =
    {
        key  : string
        arms : { tag : string | number, type : ts.Type }[]
    };

export type MergedPropInfo =
    {
        name       : string
        symbol     : ts.Symbol
        type       : ts.Type
        isOptional : boolean
        hasDefault : boolean
    };

export type MergedObjectInfo =
    {
        props      : MergedPropInfo[]
        indexType? : ts.Type
    };

export type PeelResult =
    {
        base        : ts.Type
        constraints : ParsedConstraint[]
        hasTags     : boolean
    };

export function getPropertyType( parentType: ts.Type, prop: ts.Symbol, checker: ts.TypeChecker ): ts.Type
{
    const fromSymbol = ( checker as ts.TypeChecker & { getTypeOfSymbol? : ( s: ts.Symbol ) => ts.Type }).getTypeOfSymbol?.( prop );

    if( fromSymbol && typeof fromSymbol.getFlags === 'function' && !( fromSymbol.flags & ts.TypeFlags.Any )){ return fromSymbol }

    const declaration = prop.valueDeclaration || prop.declarations?.[0];

    if( declaration && typeof checker.getTypeOfSymbolAtLocation === 'function' )
    {
        const fromDecl = checker.getTypeOfSymbolAtLocation( prop, declaration );

        if( fromDecl && typeof fromDecl.getFlags === 'function' && !( fromDecl.flags & ts.TypeFlags.Any )){ return fromDecl }
    }

    // Mapped / conditional results often have no declaration; re-lookup on the parent can recover Defaults.
    if( typeof checker.getPropertyOfType === 'function' )
    {
        const parentProp = checker.getPropertyOfType( parentType, prop.getName());

        if( parentProp && parentProp !== prop )
        {
            const fromParent = ( checker as ts.TypeChecker & { getTypeOfSymbol? : ( s: ts.Symbol ) => ts.Type }).getTypeOfSymbol?.( parentProp );

            if( fromParent && typeof fromParent.getFlags === 'function' && !( fromParent.flags & ts.TypeFlags.Any ))
            {
                return fromParent;
            }
        }
    }

    if(( prop as any ).type && typeof ( prop as any ).type.getFlags === 'function' )
    {
        return ( prop as any ).type;
    }

    if( typeof checker.getAnyType === 'function' ){ return checker.getAnyType() }

    return { getFlags : () => ts.TypeFlags.Any } as any;
}

export function safePropAccess( varName: string, propName: string ): string
{
    if( /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test( propName ))
    {
        return `${varName}.${propName}`;
    }

    return `${varName}[${JSON.stringify( propName )}]`;
}

export function getTypeProps( type: ts.Type, checker: ts.TypeChecker ): ts.Symbol[]
{
    // Prefer the checker: `type.getProperties()` can omit declaration-backed types on tag phantoms
    // (e.g. `Message<"…">`), which drops literal values used for fallback messages.
    if( typeof checker.getPropertiesOfType === 'function' )
    {
        return checker.getPropertiesOfType( type );
    }

    if( typeof type.getProperties === 'function' ){ return type.getProperties() }

    return [];
}

export function typeSymbolName( type: ts.Type ): string | undefined
{
    const symbol = typeof type.getSymbol === 'function' ? type.getSymbol() : type.symbol || ( type as any ).aliasSymbol;

    if( symbol && typeof symbol.getName === 'function' ){ return symbol.getName() }

    return typeof symbol?.name === 'string' ? symbol.name : undefined;
}

export function minifyTypeString( str: string ): string
{
    return str
        .replace( /\{\s+/g, '{' )
        .replace( /\s+\}/g, '}' )
        .replace( /;\s*\}/g, '}' )
        .replace( /;\s+/g, ',' )
        .replace( /:\s+/g, ':' )
        .replace( /\s+\|\s+/g, '|' );
}

export function unionExpectedLabel( type: ts.Type, checker: ts.TypeChecker ): string
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

export function typeHasDefaultTag( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    if( typeof type.isUnionOrIntersection === 'function' && type.isUnionOrIntersection())
    {
        return type.types.some( t => typeHasDefaultTag( t, checker ));
    }

    return getTypeProps( type, checker ).some( p => p.getName() === '__default' );
}

export function mapStructuralProps( type: ts.Type, checker: ts.TypeChecker ): MergedPropInfo[]
{
    return getTypeProps( type, checker )
        .filter( p => !isTagKey( p.getName()))
        .map( prop =>
        {
            const propType = getPropertyType( type, prop, checker );

            return {
                name       : prop.getName(),
                symbol     : prop,
                type       : propType,
                isOptional : Boolean( prop.flags & ts.SymbolFlags.Optional ),
                hasDefault : typeHasDefaultTag( propType, checker )
            };
        });
}

export function isNativeEnumType( type: ts.Type ): boolean
{
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

    if( flags & ts.TypeFlags.Enum ){ return true }

    const symbol = typeof type.getSymbol === 'function' ? type.getSymbol() : type.symbol;

    if( !symbol ){ return false }

    return ( symbol.flags & ( ts.SymbolFlags.RegularEnum | ts.SymbolFlags.ConstEnum )) !== 0;
}

export function enumMemberTypes( type: ts.Type, checker: ts.TypeChecker ): ts.Type[]
{
    const symbol = typeof type.getSymbol === 'function' ? type.getSymbol() : type.symbol;
    const members: ts.Type[] = [];

    if( symbol?.exports )
    {
        symbol.exports.forEach( member =>
        {
            if( !( member.flags & ts.SymbolFlags.EnumMember )){ return }

            const declaration = member.valueDeclaration || member.declarations?.[0];

            if( !declaration ){ return }

            members.push( checker.getTypeOfSymbolAtLocation( member, declaration ));
        });
    }

    if( members.length === 0 && typeof type.isUnion === 'function' && type.isUnion())
    {
        return type.types.slice();
    }

    return members;
}

export function isConstraintOnlyType( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    const props = getTypeProps( type, checker );

    return props.length > 0 && props.every( p => isTagKey( p.getName()));
}

/** Phantom brand object arms — typically `{ __brand: 'X' }`, not arbitrary `__*` data like `__typename`. */
export function isBrandOnlyType( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    const props = getTypeProps( type, checker );

    if( props.length === 0 ){ return false }

    return props.every( p =>
    {
        const name = p.getName();

        return !isTagKey( name ) && ( name === '__brand' || name.startsWith( '__brand' ));
    });
}

export function isDiscriminableObject( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    if( !( type.getFlags() & ts.TypeFlags.Object )){ return false }

    if( checker.isArrayType( type ) || checker.isTupleType( type )){ return false }

    if( typeof type.getCallSignatures === 'function' && type.getCallSignatures().length > 0 ){ return false }

    const name = typeSymbolName( type );

    return name !== 'Date' && name !== 'Set' && name !== 'Map' && name !== 'RegExp';
}

export function singleLiteralValue( type: ts.Type ): string | number | undefined
{
    if( typeof type.isStringLiteral === 'function' && type.isStringLiteral()){ return type.value }

    if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral()){ return type.value }

    return undefined;
}

export function tryTaggedUnionTypes( members: readonly ts.Type[], checker: ts.TypeChecker ): TaggedUnionInfo | undefined
{
    if( members.length < 2 ){ return undefined }

    const literalsByMember: Map<string, string | number>[] = [];

    for( const member of members )
    {
        if( !isDiscriminableObject( member, checker )){ return undefined }

        const literals = new Map<string, string | number>();

        for( const prop of getTypeProps( member, checker ))
        {
            const declaration = prop.valueDeclaration || prop.declarations?.[0];

            if( !declaration ){ continue }

            const value = singleLiteralValue( checker.getTypeOfSymbolAtLocation( prop, declaration ));

            if( value !== undefined ){ literals.set( prop.getName(), value ) }
        }

        if( literals.size === 0 ){ return undefined }

        literalsByMember.push( literals );
    }

    for( const key of literalsByMember[0].keys())
    {
        const arms: { tag : string | number, type : ts.Type }[] = [];
        const seen = new Set<string | number>();

        for( let i = 0; i < literalsByMember.length; i++ )
        {
            const value = literalsByMember[i].get( key );

            if( value === undefined || seen.has( value )){ break }

            seen.add( value );
            arms.push({ tag : value, type : members[i] });
        }

        if( arms.length === members.length ){ return { key, arms } }
    }

    return undefined;
}

export function stringIndexType( type: ts.Type, checker: ts.TypeChecker ): ts.Type | undefined
{
    if( typeof checker.getIndexInfoOfType !== 'function' ){ return undefined }

    return checker.getIndexInfoOfType( type, ts.IndexKind.String )?.type;
}

function isMergeableObjectType( t: ts.Type, checker: ts.TypeChecker ): boolean
{
    if( isConstraintOnlyType( t, checker ) || isBrandOnlyType( t, checker )){ return false }

    const flags = typeof t.getFlags === 'function' ? t.getFlags() : 0;
    const isObj = (( flags & ts.TypeFlags.Object ) !== 0 ) || ( typeof ( t as any ).isClassOrInterface === 'function' && ( t as any ).isClassOrInterface());

    if( !isObj ){ return false }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( t )){ return false }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( t )){ return false }

    if( typeof t.getCallSignatures === 'function' && t.getCallSignatures().length > 0 && ( typeof t.getConstructSignatures !== 'function' || t.getConstructSignatures().length === 0 ))
    {
        return false;
    }

    const symName = typeSymbolName( t );

    if( symName === 'Date' || symName === 'Set' || symName === 'Map' || symName === 'RegExp' || symName === 'Promise' || ( symName !== undefined && BUFFER_LIKE.has( symName )))
    {
        return false;
    }

    return true;
}

export function tryMergeObjectTypes( types: readonly ts.Type[], checker: ts.TypeChecker ): MergedObjectInfo | undefined
{
    const objectTypes = types.filter( t => isMergeableObjectType( t, checker ));

    if( objectTypes.length < 2 ){ return undefined }

    const others = types.filter( t =>
        !isConstraintOnlyType( t, checker ) &&
        !isBrandOnlyType( t, checker ) &&
        !objectTypes.includes( t )
    );

    if( others.length > 0 ){ return undefined }

    const propMap = new Map<string, MergedPropInfo>();
    let indexType: ts.Type | undefined;

    for( const t of objectTypes )
    {
        const idx = stringIndexType( t, checker );

        if( idx ){ indexType = idx }

        for( const prop of getTypeProps( t, checker ))
        {
            const name = prop.getName();

            if( isTagKey( name )){ continue }

            const propType = getPropertyType( t, prop, checker );

            propMap.set( name, {
                name,
                symbol     : prop,
                type       : propType,
                isOptional : ( prop.getFlags() & ts.SymbolFlags.Optional ) !== 0,
                hasDefault : typeHasDefaultTag( propType, checker )
            });
        }
    }

    return { props : [ ...propMap.values() ], indexType };
}

export function stripUndefinedFromType( type: ts.Type ): ts.Type
{
    if( typeof type.isUnion !== 'function' || !type.isUnion()){ return type }

    const nonUndefined = type.types.filter( t => !( t.getFlags() & ts.TypeFlags.Undefined ));

    if( nonUndefined.length === 1 ){ return nonUndefined[0] }

    return type;
}

export function getTagPropertyValue( type: ts.Type ): any
{
    const actual = stripUndefinedFromType( type );
    let val = ( actual as any ).value;

    if(( actual.getFlags() & ts.TypeFlags.BigIntLiteral ) && val && typeof val === 'object' && typeof val.base10Value === 'string' )
    {
        val = BigInt( `${val.negative ? '-' : ''}${val.base10Value}` );
    }

    if( val === undefined && ( actual.getFlags() & ts.TypeFlags.BooleanLiteral ))
    {
        val = ( actual as any ).intrinsicName === 'true';
    }

    if( val === undefined && ( actual.getFlags() & ts.TypeFlags.Null ))
    {
        val = null;
    }

    return val;
}

export function getStringLiteralValue( type: ts.Type ): string | undefined
{
    if( typeof type.isStringLiteral === 'function' && type.isStringLiteral()){ return type.value }

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        const literalType = type.types.find( t => t.isStringLiteral());

        if( literalType && literalType.isStringLiteral()){ return literalType.value }
    }

    return undefined;
}

export function collectConstraintsFromProps(
    props   : ts.Symbol[],
    checker : ts.TypeChecker,
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): ParsedConstraint[]
{
    const constraints: ParsedConstraint[] = [];

    for( const prop of props )
    {
        const pName = prop.getName();

        if( !isTagKey( pName )){ continue }

        // Per-constraint siblings are `__minLength_message`, etc. — not the fallback `__message` tag.
        if( pName.endsWith( '_message' ) && pName !== '__message' ){ continue }

        const declaration = prop.valueDeclaration || prop.declarations?.[0];
        const pType = declaration ? checker.getTypeOfSymbolAtLocation( prop, declaration ) : ( prop as any ).type;
        const actualType = stripUndefinedFromType( pType );
        const val = getTagPropertyValue( pType );

        const msgProp = props.find( p => p.getName() === `${pName}_message` );
        let constraintMsg: string | undefined;

        if( msgProp )
        {
            const msgDecl = msgProp.valueDeclaration || msgProp.declarations?.[0];
            const msgType = msgDecl ? checker.getTypeOfSymbolAtLocation( msgProp, msgDecl ) : undefined;
            constraintMsg = msgType ? getStringLiteralValue( msgType ) : undefined;
        }

        if( pName === '__default' ){ constraints.push({ type : 'default', value : val }); continue }

        if( pName === '__message' ){ constraints.push({ type : 'message', value : val }); continue }

        if( pName === '__tags' )
        {
            const names = collectTagBagNames( actualType, checker );

            if( names.length > 0 ){ constraints.push({ type : 'tags', value : names }) }

            continue;
        }

        if( pName === '__transform_lowercase' ){ constraints.push({ type : 'transform', value : 'lowercase' }); continue }

        if( pName === '__transform_uppercase' ){ constraints.push({ type : 'transform', value : 'uppercase' }); continue }

        if( pName === '__transform_trim' ){ constraints.push({ type : 'transform', value : 'trim' }); continue }

        if( pName === '__transform_capitalize' ){ constraints.push({ type : 'transform', value : 'capitalize' }); continue }

        if( pName === '__transform_tonumber' ){ constraints.push({ type : 'transform', value : 'tonumber' }); continue }

        if( pName === '__transform_toboolean' ){ constraints.push({ type : 'transform', value : 'toboolean' }); continue }

        if( pName === '__transform_todate' ){ constraints.push({ type : 'transform', value : 'todate' }); continue }

        if( pName === '__transform_custom' )
        {
            const identity = resolveFunctionIdentity( actualType, checker, pType );

            if( !identity )
            {
                throw new Error( '[Webergency] Custom transform must reference a named function via typeof (e.g. transform.Custom<typeof myFunc>).' );
            }

            constraints.push({ type : 'transform_custom', value : scope.bind( identity ) });
            continue;
        }

        if( pName === '__custom' )
        {
            const identity = resolveFunctionIdentity( actualType, checker, pType );

            if( !identity )
            {
                throw new Error( '[Webergency] Custom validator must reference a named function via typeof (e.g. constraint.Custom<typeof myFunc>).' );
            }

            constraints.push({ type : 'custom', value : scope.bind( identity ), message : constraintMsg });
            continue;
        }

        if( pName === '__uniqueItems' ){ constraints.push({ type : 'uniqueItems', value : true, message : constraintMsg }); continue }

        if( pName === '__contains' )
        {
            constraints.push({ type : 'contains', nestedType : actualType, message : constraintMsg });
            continue;
        }

        if( pName === '__propertyNames' )
        {
            constraints.push({ type : 'propertyNames', nestedType : actualType, message : constraintMsg });
            continue;
        }

        if( pName === '__requires' )
        {
            let reqVal: string | string[];

            if( actualType.isStringLiteral()){ reqVal = actualType.value }
            else
            {
                const typeArgs = ( actualType as ts.TypeReference ).typeArguments || [];
                const items: string[] = [];

                for( const arg of typeArgs )
                {
                    if( arg.isStringLiteral()){ items.push( arg.value ) }
                }

                reqVal = items;
            }

            constraints.push({ type : 'requires', value : reqVal, message : constraintMsg });
            continue;
        }

        if( val === undefined ){ continue }

        const map: Record<string, string> =
        {
            __minLength        : 'minLength',
            __maxLength        : 'maxLength',
            __minimum          : 'minimum',
            __maximum          : 'maximum',
            __exclusiveMinimum : 'exclusiveMinimum',
            __exclusiveMaximum : 'exclusiveMaximum',
            __multipleOf       : 'multipleOf',
            __pattern          : 'pattern',
            __format           : 'format',
            __minItems         : 'minItems',
            __maxItems         : 'maxItems',
            __minProperties    : 'minProperties',
            __maxProperties    : 'maxProperties',
            __minContains      : 'minContains',
            __maxContains      : 'maxContains'
        };

        const mapped = map[pName];

        if( mapped ){ constraints.push({ type : mapped, value : val, message : constraintMsg }) }
    }

    return mergeTagConstraints( constraints );
}

/** Keys of `{ html?: true, basic?: true }` from `tag<'html' | 'basic'>`. */
export function collectTagBagNames( type: ts.Type, checker: ts.TypeChecker ): string[]
{
    const names = new Set<string>();

    const visit = ( t: ts.Type ) =>
    {
        const actual = stripUndefinedFromType( t );

        if( typeof actual.isIntersection === 'function' && actual.isIntersection())
        {
            for( const arm of actual.types ){ visit( arm ) }

            return;
        }

        if( typeof actual.isUnion === 'function' && actual.isUnion())
        {
            for( const arm of actual.types ){ visit( arm ) }

            return;
        }

        for( const prop of getTypeProps( actual, checker ))
        {
            const name = prop.getName();

            if( !isTagKey( name )){ names.add( name ) }
        }
    };

    visit( type );

    return [ ...names ].sort();
}

export function constraintTagNames( constraints: ParsedConstraint[]): string[]
{
    const found = constraints.find( c => c.type === 'tags' );

    if( !found || !Array.isArray( found.value )){ return [] }

    return found.value as string[];
}

/** Collapse every `tags` constraint into one sorted bag. */
export function mergeTagConstraints( constraints: ParsedConstraint[]): ParsedConstraint[]
{
    const names = new Set<string>();
    const rest: ParsedConstraint[] = [];

    for( const c of constraints )
    {
        if( c.type === 'tags' && Array.isArray( c.value ))
        {
            for( const name of c.value )
            {
                if( typeof name === 'string' && name.length > 0 ){ names.add( name ) }
            }

            continue;
        }

        rest.push( c );
    }

    if( names.size === 0 ){ return rest }

    rest.push({ type : 'tags', value : [ ...names ].sort() });

    return rest;
}

function synthesizeIntersection( original: ts.Type, types: ts.Type[]): ts.Type
{
    const proto = typeof original === 'object' && original !== null ? Object.getPrototypeOf( original ) : Object.prototype;

    return Object.assign( Object.create( proto ), original,
        {
            id                    : undefined,
            types,
            flags                 : ts.TypeFlags.Intersection,
            getFlags              : () => ts.TypeFlags.Intersection,
            isIntersection        : () => true,
            isUnion               : () => false,
            isUnionOrIntersection : () => true
        });
}

function resolveBaseCandidates( original: ts.Type, candidates: ts.Type[], checker: ts.TypeChecker ): ts.Type
{
    if( candidates.length === 1 ){ return candidates[0] }

    if( tryMergeObjectTypes( candidates, checker ))
    {
        return synthesizeIntersection( original, candidates );
    }

    const nonObject = candidates.find( c => !isMergeableObjectType( c, checker ));

    return nonObject ?? candidates[0];
}

/**
 * Peel tag / brand phantoms from an intersection. Returns base runtime type + constraints.
 * Brand-only arms are dropped. Constraint-only arms contribute tags only.
 */
export function peelTaggedIntersection(
    type    : ts.Type,
    checker : ts.TypeChecker,
    scope   : ICustomFunctionScope = VERBATIM_CUSTOM_SCOPE
): PeelResult | undefined
{
    if( !( typeof type.isIntersection === 'function' && type.isIntersection())){ return undefined }

    const arms = type.types;
    const constraints: ParsedConstraint[] = [];
    const baseCandidates: ts.Type[] = [];

    for( const sub of arms )
    {
        const props = getTypeProps( sub, checker );
        const tags = collectConstraintsFromProps( props, checker, scope );
        constraints.push( ...tags );

        if( isConstraintOnlyType( sub, checker ) || isBrandOnlyType( sub, checker )){ continue }

        // Drop tag props conceptually — if arm has only tags we already skipped; mixed arms keep as base
        const dataProps = props.filter( p => !isTagKey( p.getName()));

        if( dataProps.length === 0 && tags.length > 0 && props.length > 0 ){ continue }

        baseCandidates.push( sub );
    }

    if( constraints.length === 0 && baseCandidates.length === arms.length )
    {
        // no tags — still allow brand peel
        const withoutBrand = arms.filter( t => !isBrandOnlyType( t, checker ));

        if( withoutBrand.length === arms.length || withoutBrand.length === 0 ){ return undefined }

        return { base : resolveBaseCandidates( type, withoutBrand, checker ), constraints : [], hasTags : false };
    }

    if( constraints.length === 0 && baseCandidates.length === 0 ){ return undefined }

    let base: ts.Type;

    if( baseCandidates.length === 0 )
    {
        // tags only — fall through toward any
        base = { getFlags : () => ts.TypeFlags.Any } as any;
    }
    else
    {
        base = resolveBaseCandidates( type, baseCandidates, checker );
    }

    return { base, constraints : mergeTagConstraints( constraints ), hasTags : constraints.length > 0 };
}

/** Resolve the effective type for walking: peel brands/tags to base when present. */
export function resolveWalkType( type: ts.Type, checker: ts.TypeChecker ): { type : ts.Type, constraints : ParsedConstraint[] }
{
    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        const peeled = peelTaggedIntersection( type, checker );

        if( peeled )
        {
            const merged = tryMergeObjectTypes(
                type.types.filter( t => !isConstraintOnlyType( t, checker ) && !isBrandOnlyType( t, checker )),
                checker
            );

            if( merged && !peeled.hasTags )
            {
                // Caller should use merged props — return original for object merge path
                return { type, constraints : peeled.constraints };
            }

            return { type : peeled.base, constraints : peeled.constraints };
        }

        const merged = tryMergeObjectTypes( type.types, checker );

        if( merged ){ return { type, constraints : [] } }
    }

    return { type, constraints : [] };
}

export function isValidMapKeyType( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    let walk = type;

    if( typeof walk.isIntersection === 'function' && walk.isIntersection())
    {
        const peeled = peelTaggedIntersection( walk, checker );

        if( peeled ){ walk = peeled.base }
    }

    if( typeof walk.isUnion === 'function' && walk.isUnion())
    {
        return walk.types.length > 0 && walk.types.every( t => isValidMapKeyType( t, checker ));
    }

    const flags = typeof walk.getFlags === 'function' ? walk.getFlags() : 0;

    if( flags & ( ts.TypeFlags.Any | ts.TypeFlags.Unknown )){ return true }

    if(
        flags & (
            ts.TypeFlags.String |
            ts.TypeFlags.Number |
            ts.TypeFlags.Boolean |
            ts.TypeFlags.BigInt |
            ts.TypeFlags.StringLiteral |
            ts.TypeFlags.NumberLiteral |
            ts.TypeFlags.BooleanLiteral |
            ts.TypeFlags.BigIntLiteral |
            ts.TypeFlags.TemplateLiteral
        )
    )
    {
        return true;
    }

    if( typeof walk.isStringLiteral === 'function' && walk.isStringLiteral()){ return true }

    if( typeof walk.isNumberLiteral === 'function' && walk.isNumberLiteral()){ return true }

    if( isNativeEnumType( walk )){ return true }

    return false;
}

export function assertValidMapKeyType( type: ts.Type, checker: ts.TypeChecker ): void
{
    if( isValidMapKeyType( type, checker )){ return }

    let label = 'unknown';

    try
    {
        label = checker.typeToString( type );
    }
    catch
    { /* ignore */ }

    throw new Error(
        `[Webergency] Map key type '${label}' is not supported by ahead-of-time parse/serializer codegen; ` +
        'Map keys must be string, number, boolean, bigint, template literal, enum, or a literal/union of these.'
    );
}

function templateSlotRegex( subType: ts.Type ): string
{
    const subFlags = typeof subType.getFlags === 'function' ? subType.getFlags() : 0;

    if( subFlags & ts.TypeFlags.String ){ return '.*' }

    if( subFlags & ts.TypeFlags.Number ){ return '[+-]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?' }

    if( subFlags & ts.TypeFlags.BigInt ){ return '[+-]?[0-9]+' }

    if( subFlags & ts.TypeFlags.Boolean ){ return '(true|false)' }

    if( typeof subType.isStringLiteral === 'function' && subType.isStringLiteral())
    {
        return String( subType.value ).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
    }

    if( typeof subType.isNumberLiteral === 'function' && subType.isNumberLiteral())
    {
        return String( subType.value ).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
    }

    if( subFlags & ts.TypeFlags.BooleanLiteral )
    {
        return ( subType as any ).intrinsicName === 'true' ? 'true' : 'false';
    }

    if( subFlags & ts.TypeFlags.BigIntLiteral )
    {
        return bigIntLiteralText( subType ).replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
    }

    if( subFlags & ts.TypeFlags.Null ){ return 'null' }

    if( subFlags & ts.TypeFlags.Undefined ){ return 'undefined' }

    if( typeof subType.isUnion === 'function' && subType.isUnion())
    {
        return `(?:${subType.types.map( t => templateSlotRegex( t )).join( '|' )})`;
    }

    return '.*';
}

export function buildTemplateLiteralRegex( templateType: ts.TemplateLiteralType ): string
{
    let regexStr = '^';

    for( let i = 0; i < templateType.texts.length; i++ )
    {
        regexStr += templateType.texts[i].replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );

        if( i < templateType.types.length )
        {
            regexStr += templateSlotRegex( templateType.types[i]);
        }
    }

    regexStr += '$';

    return regexStr;
}

export function bigIntLiteralText( type: ts.Type ): string
{
    const raw = ( type as any ).value;

    return typeof raw === 'object' && raw ? `${raw.negative ? '-' : ''}${raw.base10Value}` : String( raw );
}
