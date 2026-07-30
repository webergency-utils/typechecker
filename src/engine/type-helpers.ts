import ts from 'typescript';
import { isTagKey } from './tagKeys.js';
export { isTagKey };

export const BUFFER_LIKE: ReadonlySet<string> = new Set([
    'Buffer', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array',
    'Float32Array', 'Float64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView'
]);

export type ParsedConstraint =
{
    type     : string
    value?   : any
    message? : string
};

export type TaggedUnionInfo =
{
    key  : string
    arms : { tag: string | number, type: ts.Type }[]
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
    const fromSymbol = ( checker as ts.TypeChecker & { getTypeOfSymbol?: ( s: ts.Symbol ) => ts.Type }).getTypeOfSymbol?.( prop );

    if( fromSymbol && typeof fromSymbol.getFlags === 'function' && !( fromSymbol.flags & ts.TypeFlags.Any )){ return fromSymbol }

    const declaration = prop.valueDeclaration || prop.declarations?.[0];

    if( declaration && typeof checker.getTypeOfSymbolAtLocation === 'function' )
    {
        const fromDecl = checker.getTypeOfSymbolAtLocation( prop, declaration );

        if( fromDecl && typeof fromDecl.getFlags === 'function' && !( fromDecl.flags & ts.TypeFlags.Any )){ return fromDecl }
    }

    if( ( prop as any ).type && typeof ( prop as any ).type.getFlags === 'function' )
    {
        return ( prop as any ).type;
    }

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
    if( typeof type.getProperties === 'function' ){ return type.getProperties() }

    if( typeof checker.getPropertiesOfType === 'function' ){ return checker.getPropertiesOfType( type ) }

    return [];
}

export function typeSymbolName( type: ts.Type ): string | undefined
{
    const symbol = typeof type.getSymbol === 'function' ? type.getSymbol() : type.symbol || ( type as any ).aliasSymbol;

    if( symbol && typeof symbol.getName === 'function' ){ return symbol.getName() }

    return typeof symbol?.name === 'string' ? symbol.name : undefined;
}

export function typeHasDefaultTag( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    if( typeof type.isUnionOrIntersection === 'function' && type.isUnionOrIntersection())
    {
        return type.types.some( t => typeHasDefaultTag( t, checker ));
    }

    return getTypeProps( type, checker ).some( p => p.getName() === '__default' );
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

/** Phantom brand object arms — props exist but none are real tags or meaningful data for runtime. */
export function isBrandOnlyType( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    const props = getTypeProps( type, checker );

    if( props.length === 0 ){ return false }

    return props.every( p => !isTagKey( p.getName()) && p.getName().startsWith( '__' ));
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
        const arms: { tag: string | number, type: ts.Type }[] = [];
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

export function tryMergeObjectTypes( types: readonly ts.Type[], checker: ts.TypeChecker ): MergedObjectInfo | undefined
{
    const objectTypes = types.filter( t =>
    {
        if( isConstraintOnlyType( t, checker ) || isBrandOnlyType( t, checker )){ return false }

        const flags = t.getFlags();

        return (( flags & ts.TypeFlags.Object ) !== 0 ) || ( typeof ( t as any ).isClassOrInterface === 'function' && ( t as any ).isClassOrInterface());
    });

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

function stripUndefinedFromType( type: ts.Type ): ts.Type
{
    if( !type.isUnion()){ return type }

    const nonUndefined = type.types.filter( t => !( t.getFlags() & ts.TypeFlags.Undefined ));

    if( nonUndefined.length === 1 ){ return nonUndefined[0] }

    return type;
}

function getTagPropertyValue( type: ts.Type ): any
{
    const actual = stripUndefinedFromType( type );
    let val = ( actual as any ).value;

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

function getStringLiteralValue( type: ts.Type ): string | undefined
{
    if( type.isStringLiteral()){ return type.value }

    if( type.isUnion())
    {
        const literalType = type.types.find( t => t.isStringLiteral());

        if( literalType && literalType.isStringLiteral()){ return literalType.value }
    }

    return undefined;
}

function collectConstraintsFromProps( props: ts.Symbol[], checker: ts.TypeChecker ): ParsedConstraint[]
{
    const constraints: ParsedConstraint[] = [];

    for( const prop of props )
    {
        const pName = prop.getName();

        if( !isTagKey( pName )){ continue }

        if( pName.endsWith( '_message' )){ continue }

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

        if( pName === '__transform_lowercase' ){ constraints.push({ type : 'transform', value : 'lowercase' }); continue }

        if( pName === '__transform_uppercase' ){ constraints.push({ type : 'transform', value : 'uppercase' }); continue }

        if( pName === '__transform_trim' ){ constraints.push({ type : 'transform', value : 'trim' }); continue }

        if( pName === '__transform_capitalize' ){ constraints.push({ type : 'transform', value : 'capitalize' }); continue }

        if( pName === '__transform_tonumber' ){ constraints.push({ type : 'transform', value : 'tonumber' }); continue }

        if( pName === '__transform_toboolean' ){ constraints.push({ type : 'transform', value : 'toboolean' }); continue }

        if( pName === '__transform_todate' ){ constraints.push({ type : 'transform', value : 'todate' }); continue }

        // custom / transform_custom skipped in parse (require function identity binding)
        if( pName === '__transform_custom' || pName === '__custom' ){ continue }

        if( pName === '__uniqueItems' ){ constraints.push({ type : 'uniqueItems', value : true, message : constraintMsg }); continue }

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
            __minLength         : 'minLength',
            __maxLength         : 'maxLength',
            __minimum           : 'minimum',
            __maximum           : 'maximum',
            __exclusiveMinimum  : 'exclusiveMinimum',
            __exclusiveMaximum  : 'exclusiveMaximum',
            __multipleOf        : 'multipleOf',
            __pattern           : 'pattern',
            __format            : 'format',
            __minItems          : 'minItems',
            __maxItems          : 'maxItems'
        };

        const mapped = map[pName];

        if( mapped ){ constraints.push({ type : mapped, value : val, message : constraintMsg }) }
    }

    return constraints;
}

/**
 * Peel tag / brand phantoms from an intersection. Returns base runtime type + constraints.
 * Brand-only arms are dropped. Constraint-only arms contribute tags only.
 */
export function peelTaggedIntersection( type: ts.Type, checker: ts.TypeChecker ): PeelResult | undefined
{
    if( !( typeof type.isIntersection === 'function' && type.isIntersection())){ return undefined }

    const arms = type.types;
    const constraints: ParsedConstraint[] = [];
    const baseCandidates: ts.Type[] = [];

    for( const sub of arms )
    {
        const props = getTypeProps( sub, checker );
        const tags = collectConstraintsFromProps( props, checker );
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

        if( withoutBrand.length === 1 )
        {
            return { base : withoutBrand[0], constraints : [], hasTags : false };
        }

        const merged = tryMergeObjectTypes( withoutBrand, checker );

        if( merged )
        {
            // Represent merged objects by synthesizing from first object arm — callers should use tryMergeObjectTypes on peel.base if intersection remains
            return { base : withoutBrand[0], constraints : [], hasTags : false };
        }

        return { base : withoutBrand[0], constraints : [], hasTags : false };
    }

    if( constraints.length === 0 && baseCandidates.length === 0 ){ return undefined }

    let base: ts.Type;

    if( baseCandidates.length === 0 )
    {
        // tags only — fall back to string-like any stub
        base = { getFlags : () => ts.TypeFlags.Any } as any;
    }
    else if( baseCandidates.length === 1 )
    {
        base = baseCandidates[0];
    }
    else
    {
        const merged = tryMergeObjectTypes( baseCandidates, checker );
        base = merged ? baseCandidates[0] : baseCandidates[0];
    }

    return { base, constraints, hasTags : constraints.length > 0 };
}

/** Resolve the effective type for walking: peel brands/tags to base when present. */
export function resolveWalkType( type: ts.Type, checker: ts.TypeChecker ): { type: ts.Type, constraints: ParsedConstraint[] }
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
