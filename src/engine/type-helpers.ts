import ts from 'typescript';
import { isTagKey } from './tagKeys.js';
import { isClassConstructorType, resolveClassIdentity, resolveFunctionIdentity, type ICustomFunctionScope } from './customFns.js';
import { formatCasing, type CasingFormat } from '../runtime/casing.js';
export { isTagKey };

export const BUFFER_LIKE: ReadonlySet<string> = new Set([
    'Buffer', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array',
    'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array',
    'BigInt64Array', 'BigUint64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView'
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

export interface JsDocMetadata
{
    title?       : string
    description? : string
    default?     : unknown
    hasDefault?  : boolean
    examples?    : unknown[]
    deprecated?  : boolean
    readOnly?    : boolean
    writeOnly?   : boolean
    secret?      : boolean
}

export interface JsDocExtraction
{
    metadata    : JsDocMetadata
    constraints : ParsedConstraint[]
}

/** No-op scope for codegen unit tests that never hit Custom tags. */
export const VERBATIM_CUSTOM_SCOPE: ICustomFunctionScope =
{
    bind    : identity => identity.name,
    imports : []
};

export type TaggedUnionInfo =
    {
        key  : string
        arms : { tag : string | number | boolean, type : ts.Type }[]
    };

export type MergedPropInfo =
    {
        name              : string
        symbol            : ts.Symbol
        type              : ts.Type
        isOptional        : boolean
        hasDefault        : boolean
        isReadOnly?       : boolean
        isWriteOnly?      : boolean
        isSecret?         : boolean
        jsdocConstraints? : ParsedConstraint[]
        jsdocMeta?        : JsDocMetadata
    };

export interface TemplateIndexInfo
{
    pattern   : string
    keyType   : ts.Type
    valueType : ts.Type
}

export type MergedObjectInfo =
    {
        props              : MergedPropInfo[]
        indexType?         : ts.Type
        patternIndexInfos? : TemplateIndexInfo[]
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

function typeHasPhantomKey( type: ts.Type, checker: ts.TypeChecker, key: string ): boolean
{
    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        return type.types.some( t => typeHasPhantomKey( t, checker, key ));
    }

    if( typeof type.isUnion === 'function' && type.isUnion())
    {
        const nonNullish = type.types.filter( t => !( t.getFlags() & ( ts.TypeFlags.Undefined | ts.TypeFlags.Null )));

        return nonNullish.length > 0 && nonNullish.every( t => typeHasPhantomKey( t, checker, key ));
    }

    return getTypeProps( type, checker ).some( p => p.getName() === key );
}

export function typeHasReadOnlyTag( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    return typeHasPhantomKey( type, checker, '__readonly' );
}

export function typeHasWriteOnlyTag( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    return typeHasPhantomKey( type, checker, '__writeonly' );
}

export function typeHasSecretTag( type: ts.Type, checker: ts.TypeChecker ): boolean
{
    return typeHasPhantomKey( type, checker, '__secret' );
}

function hasNonPublicModifier( prop: ts.Symbol ): boolean
{
    const decl = prop.valueDeclaration || prop.declarations?.[0];

    if( !decl || typeof ts.canHaveModifiers !== 'function' || !ts.canHaveModifiers( decl )){ return false }

    const mods = ts.getModifiers( decl );

    if( !mods ){ return false }

    return mods.some( m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword );
}

export function isIgnoredPropertySymbol( prop: ts.Symbol, isClassInstance: boolean = false ): boolean
{
    const name = prop.getName();

    if( isTagKey( name )){ return true }

    if( name.startsWith( '__@' ) || name.startsWith( '#' ) || name.startsWith( '__#' )){ return true }

    if( isClassInstance )
    {
        if(( prop.flags & ts.SymbolFlags.Method ) !== 0 ){ return true }

        if( hasNonPublicModifier( prop )){ return true }
    }

    return false;
}

export function assertNotTypeParameter( type: ts.Type ): void
{
    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

    if(( flags & ts.TypeFlags.TypeParameter ) !== 0 )
    {
        const name = typeSymbolName( type ) || 'T';
        throw new Error( `[Webergency] Cannot compile runtime validator for unresolved type parameter '${name}'. Provide a concrete type argument.` );
    }
}

export function resolveWirePropertyName( propName: string, casing?: CasingFormat ): string
{
    if( !casing ){ return propName }

    return formatCasing( propName, casing );
}

export function buildWirePropertyMap(
    propNames : readonly string[],
    casing?   : CasingFormat
): Map<string, string>
{
    const map = new Map<string, string>();
    const seenWire = new Map<string, string>();

    for( const propName of propNames )
    {
        const wireName = resolveWirePropertyName( propName, casing );
        const prev = seenWire.get( wireName );

        if( prev !== undefined && prev !== propName )
        {
            throw new Error(
                `[Webergency] Casing conversion collision: properties '${prev}' and '${propName}' both map to wire key '${wireName}' under propertyCasing '${casing}'.`
            );
        }

        seenWire.set( wireName, propName );
        map.set( propName, wireName );
    }

    return map;
}

function isBuiltInLibDeclaration( symbol: ts.Symbol | undefined ): boolean
{
    const decl = symbol?.valueDeclaration || symbol?.declarations?.[0];
    const sf = decl?.getSourceFile?.();

    if( !sf ){ return false }

    return Boolean( sf.hasNoDefaultLib || sf.fileName.includes( 'typescript/lib/' ));
}

function parseJsDocLiteral( text: string ): unknown
{
    try
    {
        return JSON.parse( text );
    }
    catch
    {
        return text;
    }
}

export function hasJsDocMetadata( meta: JsDocMetadata | undefined ): boolean
{
    if( !meta ){ return false }

    return meta.title !== undefined ||
        meta.description !== undefined ||
        meta.hasDefault === true ||
        ( meta.examples !== undefined && meta.examples.length > 0 ) ||
        meta.deprecated === true ||
        meta.readOnly === true ||
        meta.writeOnly === true ||
        meta.secret === true;
}

export function mergeConstraintsWithJsDoc(
    primary : ParsedConstraint[],
    jsdoc   : ParsedConstraint[] | undefined
): ParsedConstraint[]
{
    if( !jsdoc || jsdoc.length === 0 ){ return primary }

    if( primary.length === 0 ){ return jsdoc.slice() }

    const existingTypes = new Set( primary.map( c => c.type ));
    const merged = primary.slice();

    for( const jc of jsdoc )
    {
        if( !existingTypes.has( jc.type ))
        {
            merged.push( jc );
            existingTypes.add( jc.type );
        }
    }

    return merged;
}

function mergeJsDocExtractions( inner: JsDocExtraction, outer: JsDocExtraction ): JsDocExtraction
{
    const metadata: JsDocMetadata = {};
    const title = outer.metadata.title ?? inner.metadata.title;
    const description = outer.metadata.description ?? inner.metadata.description;

    if( title !== undefined ){ metadata.title = title }

    if( description !== undefined ){ metadata.description = description }

    if( outer.metadata.hasDefault )
    {
        metadata.default = outer.metadata.default;
        metadata.hasDefault = true;
    }
    else if( inner.metadata.hasDefault )
    {
        metadata.default = inner.metadata.default;
        metadata.hasDefault = true;
    }

    if( outer.metadata.deprecated || inner.metadata.deprecated )
    {
        metadata.deprecated = true;
    }

    if( outer.metadata.readOnly || inner.metadata.readOnly )
    {
        metadata.readOnly = true;
    }

    if( outer.metadata.writeOnly || inner.metadata.writeOnly )
    {
        metadata.writeOnly = true;
    }

    if( outer.metadata.secret || inner.metadata.secret )
    {
        metadata.secret = true;
    }

    const examples = [ ...( inner.metadata.examples || []), ...( outer.metadata.examples || []) ];

    if( examples.length > 0 ){ metadata.examples = examples }

    return {
        metadata,
        constraints : mergeConstraintsWithJsDoc( outer.constraints, inner.constraints )
    };
}

export function extractSymbolJsDocInfo( symbol: ts.Symbol | undefined, checker: ts.TypeChecker ): JsDocExtraction
{
    const metadata: JsDocMetadata = {};
    const constraints: ParsedConstraint[] = [];

    if( !symbol || isBuiltInLibDeclaration( symbol ))
    {
        return { metadata, constraints };
    }

    if( typeof symbol.getDocumentationComment === 'function' )
    {
        try
        {
            const doc = ts.displayPartsToString( symbol.getDocumentationComment( checker )).trim();

            if( doc.length > 0 ){ metadata.description = doc }
        }
        catch
        { /* ignore mock symbols */ }
    }

    if( typeof symbol.getJsDocTags === 'function' )
    {
        let tags: ts.JSDocTagInfo[];

        try
        {
            tags = symbol.getJsDocTags( checker ) || [];
        }
        catch
        {
            tags = [];
        }

        for( const tag of tags )
        {
            const rawText = typeof tag.text === 'string'
                ? tag.text
                : ( tag.text ? ts.displayPartsToString( tag.text ) : '' );
            const text = rawText.trim();
            const tagName = tag.name;

            if( tagName === 'title' && text.length > 0 )
            {
                metadata.title = text;
            }
            else if(( tagName === 'description' || tagName === 'desc' ) && text.length > 0 )
            {
                if( !metadata.description ){ metadata.description = text }
            }
            else if( tagName === 'deprecated' )
            {
                metadata.deprecated = true;
            }
            else if(( tagName === 'readonly' || tagName === 'readOnly' ) && text !== 'false' )
            {
                metadata.readOnly = true;
                constraints.push({ type : 'readOnly', value : true });
            }
            else if(( tagName === 'writeonly' || tagName === 'writeOnly' ) && text !== 'false' )
            {
                metadata.writeOnly = true;
                constraints.push({ type : 'writeOnly', value : true });
            }
            else if( tagName === 'secret' && text !== 'false' )
            {
                metadata.secret = true;
                constraints.push({ type : 'secret', value : true });
            }
            else if( tagName === 'example' && text.length > 0 )
            {
                if( !metadata.examples ){ metadata.examples = [] }

                metadata.examples.push( parseJsDocLiteral( text ));
            }
            else if( tagName === 'default' && text.length > 0 && text !== 'undefined' )
            {
                const parsed = parseJsDocLiteral( text );
                metadata.default = parsed;
                metadata.hasDefault = true;
                constraints.push({ type : 'default', value : parsed });
            }
            else if(
                tagName === 'minimum' ||
                tagName === 'maximum' ||
                tagName === 'exclusiveMinimum' ||
                tagName === 'exclusiveMaximum' ||
                tagName === 'multipleOf'
            )
            {
                const n = Number( text );

                if( text.length > 0 && Number.isFinite( n ) && ( tagName !== 'multipleOf' || n > 0 ))
                {
                    constraints.push({ type : tagName, value : n });
                }
            }
            else if(
                tagName === 'minLength' ||
                tagName === 'maxLength' ||
                tagName === 'minItems' ||
                tagName === 'maxItems' ||
                tagName === 'minProperties' ||
                tagName === 'maxProperties' ||
                tagName === 'minContains' ||
                tagName === 'maxContains'
            )
            {
                const n = Number( text );

                if( text.length > 0 && Number.isInteger( n ) && n >= 0 )
                {
                    constraints.push({ type : tagName, value : n });
                }
            }
            else if( tagName === 'pattern' && text.length > 0 )
            {
                constraints.push({ type : 'pattern', value : text });
            }
            else if( tagName === 'format' && text.length > 0 )
            {
                constraints.push({ type : 'format', value : text });
            }
            else if( tagName === 'uniqueItems' && text !== 'false' )
            {
                constraints.push({ type : 'uniqueItems', value : true });
            }
        }
    }

    return { metadata, constraints };
}

function resolveReferencedAliasJsDoc(
    typeNode : ts.TypeNode | undefined,
    checker  : ts.TypeChecker,
    seen     : Set<ts.Symbol> = new Set()
): JsDocExtraction | undefined
{
    if( !typeNode || !ts.isTypeReferenceNode( typeNode ) || typeof checker.getSymbolAtLocation !== 'function' )
    {
        return undefined;
    }

    let sym: ts.Symbol | undefined;

    try
    {
        sym = checker.getSymbolAtLocation( typeNode.typeName );

        if( sym && ( sym.flags & ts.SymbolFlags.Alias ) && typeof checker.getAliasedSymbol === 'function' )
        {
            sym = checker.getAliasedSymbol( sym );
        }
    }
    catch
    {
        return undefined;
    }

    if( !sym || seen.has( sym ) || isBuiltInLibDeclaration( sym )){ return undefined }

    seen.add( sym );
    const own = extractSymbolJsDocInfo( sym, checker );
    const decl = sym.declarations?.[0];

    if( decl && ts.isTypeAliasDeclaration( decl ))
    {
        const inner = resolveReferencedAliasJsDoc( decl.type, checker, seen );

        if( inner ){ return mergeJsDocExtractions( inner, own ) }
    }

    return own;
}

export function extractPropertyJsDocInfo( prop: ts.Symbol, checker: ts.TypeChecker ): JsDocExtraction
{
    const own = extractSymbolJsDocInfo( prop, checker );
    const decl = prop.valueDeclaration || prop.declarations?.[0];
    const typeNode = decl && ( ts.isPropertySignature( decl ) || ts.isPropertyDeclaration( decl ) || ts.isParameter( decl ))
        ? decl.type
        : undefined;
    const refInfo = resolveReferencedAliasJsDoc( typeNode, checker );

    if( refInfo ){ return mergeJsDocExtractions( refInfo, own ) }

    return own;
}

export function extractTypeJsDocInfo( type: ts.Type, checker: ts.TypeChecker ): JsDocExtraction
{
    const attachedNode = ( type as any ).__jsdocTypeNode as ts.TypeNode | undefined;

    if( attachedNode )
    {
        const fromNode = resolveReferencedAliasJsDoc( attachedNode, checker );

        if( fromNode ){ return fromNode }
    }

    const aliasSym = type.aliasSymbol;
    const typeSym = typeof type.getSymbol === 'function' ? type.getSymbol() : type.symbol;
    const symName = typeSym && typeof typeSym.getName === 'function' ? typeSym.getName() : typeSym?.name;
    const validTypeSym = typeSym && symName !== '__type' && symName !== '__object' ? typeSym : undefined;

    if( aliasSym && validTypeSym && aliasSym !== validTypeSym )
    {
        return mergeJsDocExtractions(
            extractSymbolJsDocInfo( validTypeSym, checker ),
            extractSymbolJsDocInfo( aliasSym, checker )
        );
    }

    return extractSymbolJsDocInfo( aliasSym || validTypeSym, checker );
}

export function wrapTypeNodeWithJsDoc( typeNode: ts.TypeNode, type: ts.Type, checker: ts.TypeChecker ): ts.Type
{
    const fromNode = resolveReferencedAliasJsDoc( typeNode, checker );

    if( !fromNode || ( fromNode.constraints.length === 0 && !hasJsDocMetadata( fromNode.metadata )))
    {
        return type;
    }

    // Only wrap when TypeScript erased `aliasSymbol` (e.g. `type Short = string`).
    if( type.aliasSymbol )
    {
        const existing = extractTypeJsDocInfo( type, checker );

        if( existing.constraints.length >= fromNode.constraints.length && hasJsDocMetadata( existing.metadata ) === hasJsDocMetadata( fromNode.metadata ))
        {
            return type;
        }
    }

    const proto = typeof type === 'object' && type !== null ? Object.getPrototypeOf( type ) : Object.prototype;

    return Object.assign( Object.create( proto ), type, {
        id              : undefined,
        __jsdocTypeNode : typeNode
    });
}

export function mapStructuralProps( type: ts.Type, checker: ts.TypeChecker ): MergedPropInfo[]
{
    const isClassInst = resolveClassIdentity( type ) !== undefined;

    return getTypeProps( type, checker )
        .filter( p => !isIgnoredPropertySymbol( p, isClassInst ))
        .map( prop =>
        {
            const propType = getPropertyType( type, prop, checker );
            const jsdoc = extractPropertyJsDocInfo( prop, checker );
            const isReadOnly = typeHasReadOnlyTag( propType, checker ) || Boolean( jsdoc.metadata.readOnly );
            const isSecret = typeHasSecretTag( propType, checker ) || Boolean( jsdoc.metadata.secret );
            const isWriteOnly = typeHasWriteOnlyTag( propType, checker ) || Boolean( jsdoc.metadata.writeOnly );

            return {
                name             : prop.getName(),
                symbol           : prop,
                type             : propType,
                isOptional       : Boolean( prop.flags & ts.SymbolFlags.Optional ),
                hasDefault       : typeHasDefaultTag( propType, checker ) || Boolean( jsdoc.metadata.hasDefault ),
                isReadOnly,
                isWriteOnly,
                isSecret,
                jsdocConstraints : jsdoc.constraints.length > 0 ? jsdoc.constraints : undefined,
                jsdocMeta        : hasJsDocMetadata( jsdoc.metadata ) ? jsdoc.metadata : undefined
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
    if( typeof type.isIntersection === 'function' && type.isIntersection())
    {
        return tryMergeObjectTypes( type.types, checker, type ) !== undefined;
    }

    if( !( type.getFlags() & ts.TypeFlags.Object )){ return false }

    if( checker.isArrayType( type ) || checker.isTupleType( type )){ return false }

    if( typeof type.getCallSignatures === 'function' && type.getCallSignatures().length > 0 ){ return false }

    if( isClassConstructorType( type ) || resolveClassIdentity( type ) !== undefined ){ return false }

    const name = typeSymbolName( type );

    return name !== 'Date' && name !== 'URL' && name !== 'Set' && name !== 'ReadonlySet' && name !== 'Map' && name !== 'ReadonlyMap' && name !== 'RegExp' && name !== 'Promise' && name !== 'File' && name !== 'Blob' && ( name === undefined || !BUFFER_LIKE.has( name ));
}

export function singleLiteralValue( type: ts.Type ): string | number | boolean | undefined
{
    if( typeof type.isStringLiteral === 'function' && type.isStringLiteral()){ return type.value }

    if( typeof type.isNumberLiteral === 'function' && type.isNumberLiteral()){ return type.value }

    const flags = typeof type.getFlags === 'function' ? type.getFlags() : 0;

    if(( flags & ts.TypeFlags.BooleanLiteral ) || ( type as any ).intrinsicName === 'true' || ( type as any ).intrinsicName === 'false' )
    {
        return ( type as any ).intrinsicName === 'true';
    }

    return undefined;
}

export function tryTaggedUnionTypes( members: readonly ts.Type[], checker: ts.TypeChecker ): TaggedUnionInfo | undefined
{
    if( members.length < 2 ){ return undefined }

    const literalsByMember: Map<string, string | number | boolean>[] = [];

    for( const member of members )
    {
        if( !isDiscriminableObject( member, checker )){ return undefined }

        const literals = new Map<string, string | number | boolean>();

        for( const prop of getTypeProps( member, checker ))
        {
            if( isIgnoredPropertySymbol( prop )){ continue }

            if(( prop.flags & ts.SymbolFlags.Optional ) !== 0 ){ continue }

            const value = singleLiteralValue( getPropertyType( member, prop, checker ));

            if( value !== undefined ){ literals.set( prop.getName(), value ) }
        }

        if( literals.size === 0 ){ return undefined }

        literalsByMember.push( literals );
    }

    for( const key of literalsByMember[0].keys())
    {
        const arms: { tag : string | number | boolean, type : ts.Type }[] = [];
        const seen = new Set<string | number | boolean>();

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

export function numberIndexType( type: ts.Type, checker: ts.TypeChecker ): ts.Type | undefined
{
    if( typeof checker.getIndexInfoOfType !== 'function' ){ return undefined }

    return checker.getIndexInfoOfType( type, ts.IndexKind.Number )?.type;
}

export function getTemplateIndexInfos( type: ts.Type, checker: ts.TypeChecker ): TemplateIndexInfo[]
{
    if( typeof ( checker as any ).getIndexInfosOfType !== 'function' ){ return [] }

    const infos: ts.IndexInfo[] = ( checker as any ).getIndexInfosOfType( type ) || [];
    const result: TemplateIndexInfo[] = [];
    const typeFlags = typeof type.getFlags === 'function' ? type.getFlags() : 0;
    const symName = typeSymbolName( type );
    const allowNumIndex = ( typeFlags & ts.TypeFlags.Object ) !== 0 &&
        !( typeof checker.isArrayType === 'function' && checker.isArrayType( type )) &&
        !( typeof checker.isTupleType === 'function' && checker.isTupleType( type )) &&
        symName !== 'String' &&
        ( symName === undefined || !BUFFER_LIKE.has( symName ));

    for( const info of infos )
    {
        if( !info.keyType ){ continue }

        const keyFlags = typeof info.keyType.getFlags === 'function' ? info.keyType.getFlags() : info.keyType.flags;

        if( keyFlags & ts.TypeFlags.TemplateLiteral )
        {
            result.push({
                pattern   : buildTemplateLiteralRegex( info.keyType as ts.TemplateLiteralType ),
                keyType   : info.keyType,
                valueType : info.type
            });
        }
        else if( allowNumIndex && ( keyFlags & ts.TypeFlags.Number ))
        {
            result.push({
                pattern   : '^(?:0|[1-9][0-9]*)$',
                keyType   : info.keyType,
                valueType : info.type
            });
        }
    }

    return result;
}

function isMergeableObjectType( t: ts.Type, checker: ts.TypeChecker ): boolean
{
    if( isConstraintOnlyType( t, checker ) || isBrandOnlyType( t, checker )){ return false }

    if( isClassConstructorType( t ) || resolveClassIdentity( t ) !== undefined ){ return false }

    const flags = typeof t.getFlags === 'function' ? t.getFlags() : 0;
    const isObj = (( flags & ts.TypeFlags.Object ) !== 0 ) || ( typeof ( t as any ).isClassOrInterface === 'function' && ( t as any ).isClassOrInterface());

    if( !isObj ){ return false }

    if( typeof checker.isArrayType === 'function' && checker.isArrayType( t )){ return false }

    if( typeof checker.isTupleType === 'function' && checker.isTupleType( t )){ return false }

    if( typeof t.getCallSignatures === 'function' && t.getCallSignatures().length > 0 )
    {
        return false;
    }

    const symName = typeSymbolName( t );

    if( symName === 'Date' || symName === 'URL' || symName === 'Set' || symName === 'ReadonlySet' || symName === 'Map' || symName === 'ReadonlyMap' || symName === 'RegExp' || symName === 'Promise' || ( symName !== undefined && BUFFER_LIKE.has( symName )))
    {
        return false;
    }

    return true;
}

export function tryMergeObjectTypes(
    types             : readonly ts.Type[],
    checker           : ts.TypeChecker,
    intersectionType? : ts.Type
): MergedObjectInfo | undefined
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
    const patternMap = new Map<string, TemplateIndexInfo>();

    for( const t of objectTypes )
    {
        const idx = stringIndexType( t, checker );

        if( idx )
        {
            indexType = indexType && indexType !== idx
                ? synthesizeIntersection( indexType, [ indexType, idx ])
                : idx;
        }

        for( const pInfo of getTemplateIndexInfos( t, checker ))
        {
            const prevPat = patternMap.get( pInfo.pattern );

            if( prevPat && prevPat.valueType !== pInfo.valueType )
            {
                patternMap.set( pInfo.pattern, {
                    ...pInfo,
                    valueType : synthesizeIntersection( prevPat.valueType, [ prevPat.valueType, pInfo.valueType ])
                });
            }
            else
            {
                patternMap.set( pInfo.pattern, pInfo );
            }
        }

        for( const prop of getTypeProps( t, checker ))
        {
            if( isIgnoredPropertySymbol( prop )){ continue }

            const name = prop.getName();
            const propType = getPropertyType( t, prop, checker );
            const jsdoc = extractPropertyJsDocInfo( prop, checker );
            const curOptional = ( prop.getFlags() & ts.SymbolFlags.Optional ) !== 0;
            const curHasDefault = typeHasDefaultTag( propType, checker ) || Boolean( jsdoc.metadata.hasDefault );
            const curReadOnly = typeHasReadOnlyTag( propType, checker ) || Boolean( jsdoc.metadata.readOnly );
            const curWriteOnly = typeHasWriteOnlyTag( propType, checker ) || Boolean( jsdoc.metadata.writeOnly );
            const curSecret = typeHasSecretTag( propType, checker ) || Boolean( jsdoc.metadata.secret );
            const prev = propMap.get( name );

            if( prev )
            {
                let mergedType: ts.Type;

                if( prev.type === propType )
                {
                    mergedType = propType;
                }
                else if( intersectionType && typeof checker.getPropertyOfType === 'function' )
                {
                    const interProp = checker.getPropertyOfType( intersectionType, name );
                    mergedType = interProp
                        ? getPropertyType( intersectionType, interProp, checker )
                        : synthesizeIntersection( prev.type, [ prev.type, propType ]);
                }
                else
                {
                    mergedType = synthesizeIntersection( prev.type, [ prev.type, propType ]);
                }

                const mergedJsdoc = mergeJsDocExtractions(
                    { metadata : prev.jsdocMeta || {}, constraints : prev.jsdocConstraints || [] },
                    jsdoc
                );

                propMap.set( name, {
                    name,
                    symbol           : prop,
                    type             : mergedType,
                    isOptional       : prev.isOptional && curOptional,
                    hasDefault       : prev.hasDefault || curHasDefault || Boolean( mergedJsdoc.metadata.hasDefault ),
                    isReadOnly       : Boolean( prev.isReadOnly ) || curReadOnly || Boolean( mergedJsdoc.metadata.readOnly ),
                    isWriteOnly      : Boolean( prev.isWriteOnly ) || curWriteOnly || Boolean( mergedJsdoc.metadata.writeOnly ),
                    isSecret         : Boolean( prev.isSecret ) || curSecret || Boolean( mergedJsdoc.metadata.secret ),
                    jsdocConstraints : mergedJsdoc.constraints.length > 0 ? mergedJsdoc.constraints : undefined,
                    jsdocMeta        : hasJsDocMetadata( mergedJsdoc.metadata ) ? mergedJsdoc.metadata : undefined
                });
            }
            else
            {
                propMap.set( name, {
                    name,
                    symbol           : prop,
                    type             : propType,
                    isOptional       : curOptional,
                    hasDefault       : curHasDefault,
                    isReadOnly       : curReadOnly,
                    isWriteOnly      : curWriteOnly,
                    isSecret         : curSecret,
                    jsdocConstraints : jsdoc.constraints.length > 0 ? jsdoc.constraints : undefined,
                    jsdocMeta        : hasJsDocMetadata( jsdoc.metadata ) ? jsdoc.metadata : undefined
                });
            }
        }
    }

    const patternIndexInfos = patternMap.size > 0 ? [ ...patternMap.values() ] : undefined;

    return { props : [ ...propMap.values() ], indexType, patternIndexInfos };
}

export function stripUndefinedFromType( type: ts.Type | undefined ): ts.Type
{
    if( !type ){ return { getFlags : () => ts.TypeFlags.Any } as any }

    return stripUndefinedFromUnion( type );
}

const strippedUnionCache = new WeakMap<object, ts.Type>();

export function stripUndefinedFromUnion( type: ts.Type ): ts.Type
{
    if( typeof type.isUnion !== 'function' || !type.isUnion()){ return type }

    const cached = strippedUnionCache.get( type as object );

    if( cached ){ return cached }

    const nonUndefined = type.types.filter( t => !( t.getFlags() & ts.TypeFlags.Undefined ));

    if( nonUndefined.length === 0 || nonUndefined.length === type.types.length ){ return type }

    if( nonUndefined.length === 1 ){ return nonUndefined[0] }

    const proto = typeof type === 'object' && type !== null ? Object.getPrototypeOf( type ) : Object.prototype;
    let stripped: ts.Type;

    if(
        nonUndefined.length === 2 &&
        nonUndefined.every( t => ( t.getFlags() & ts.TypeFlags.BooleanLiteral ) !== 0 )
    )
    {
        stripped = Object.assign( Object.create( proto ), type, {
            id            : undefined,
            flags         : ts.TypeFlags.Boolean | ts.TypeFlags.Union,
            getFlags      : () => ts.TypeFlags.Boolean | ts.TypeFlags.Union,
            intrinsicName : 'boolean',
            types         : nonUndefined
        });
    }
    else
    {
        stripped = Object.assign( Object.create( proto ), type, {
            id    : undefined,
            types : nonUndefined
        });
    }

    strippedUnionCache.set( type as object, stripped );

    return stripped;
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
        const pType = ( checker as any ).getTypeOfSymbol
            ? ( checker as any ).getTypeOfSymbol( prop )
            : ( declaration ? checker.getTypeOfSymbolAtLocation( prop, declaration ) : ( prop as any ).type );
        const actualType = stripUndefinedFromType( pType );
        const val = getTagPropertyValue( pType );

        const msgProp = props.find(( p ) => p.getName() === `${pName}_message` );
        let constraintMsg: string | undefined;

        if( msgProp )
        {
            const msgDecl = msgProp.valueDeclaration || msgProp.declarations?.[0];
            const msgType = ( checker as any ).getTypeOfSymbol
                ? ( checker as any ).getTypeOfSymbol( msgProp )
                : ( msgDecl ? checker.getTypeOfSymbolAtLocation( msgProp, msgDecl ) : undefined );
            constraintMsg = msgType ? getStringLiteralValue( msgType ) : undefined;
        }

        if( pName === '__default' ){ constraints.push({ type : 'default', value : val }); continue }

        if( pName === '__readonly' ){ constraints.push({ type : 'readOnly', value : true }); continue }

        if( pName === '__writeonly' ){ constraints.push({ type : 'writeOnly', value : true }); continue }

        if( pName === '__secret' ){ constraints.push({ type : 'secret', value : true }); continue }

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

    if( tryMergeObjectTypes( candidates, checker, original ))
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
                checker,
                type
            );

            if( merged && !peeled.hasTags )
            {
                // Caller should use merged props — return original for object merge path
                return { type, constraints : peeled.constraints };
            }

            return { type : peeled.base, constraints : peeled.constraints };
        }

        const merged = tryMergeObjectTypes( type.types, checker, type );

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
            ts.TypeFlags.TemplateLiteral |
            ts.TypeFlags.StringMapping
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

    if( subFlags & ts.TypeFlags.String ){ return '[\\s\\S]*' }

    if( subFlags & ts.TypeFlags.StringMapping )
    {
        const symName = typeSymbolName( subType );

        if( symName === 'Uppercase' ){ return '[^a-z]*' }

        if( symName === 'Lowercase' ){ return '[^A-Z]*' }

        if( symName === 'Capitalize' ){ return '(?:[^a-z][\\s\\S]*)?' }

        if( symName === 'Uncapitalize' ){ return '(?:[^A-Z][\\s\\S]*)?' }

        return '[\\s\\S]*';
    }

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

    return '[\\s\\S]*';
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

export interface NullableUnionClassification
{
    hasUndefined : boolean
    hasNull      : boolean
    nonNullish   : ts.Type[]
}

export function classifyNullableUnion( arms: readonly ts.Type[]): NullableUnionClassification
{
    let hasUndefined = false;
    let hasNull = false;
    const nonNullish: ts.Type[] = [];

    for( const arm of arms )
    {
        const armFlags = arm.getFlags();

        if( armFlags & ( ts.TypeFlags.Undefined | ts.TypeFlags.Void )){ hasUndefined = true }
        else if( armFlags & ts.TypeFlags.Null ){ hasNull = true }
        else { nonNullish.push( arm ) }
    }

    return { hasUndefined, hasNull, nonNullish };
}

export interface TupleInspection
{
    typeArgs     : readonly ts.Type[]
    elementFlags : readonly ts.ElementFlags[]
    hasRest      : boolean
    hasOptional  : boolean
    fixedCount   : number
    minItems     : number
    restIndex    : number
    restType?    : ts.Type
    suffixTypes  : readonly ts.Type[]
}

export function inspectTupleType( type: ts.Type, checker: ts.TypeChecker ): TupleInspection
{
    const tupleRef = type as ts.TupleTypeReference;
    const fromChecker = ( checker as any ).getTypeArguments?.( tupleRef );
    const typeArgs: readonly ts.Type[] = ( fromChecker && fromChecker.length > 0 )
        ? fromChecker
        : ( tupleRef.typeArguments || fromChecker || []);
    const target = tupleRef.target || ( type as unknown as ts.TupleType );
    const elementFlags: readonly ts.ElementFlags[] = target?.elementFlags || [];
    const restIndex = elementFlags.findIndex( f => ( f & ( ts.ElementFlags.Rest | ts.ElementFlags.Variadic )) !== 0 );
    const hasRest = restIndex !== -1 && restIndex < typeArgs.length;
    const hasOptional = elementFlags.some( f => ( f & ts.ElementFlags.Optional ) !== 0 );
    const fixedCount = hasRest ? restIndex : typeArgs.length;
    const restType = hasRest ? typeArgs[restIndex] : undefined;
    const suffixTypes = hasRest ? typeArgs.slice( restIndex + 1 ) : [];
    let minPrefix = 0;

    for( let i = 0; i < fixedCount; i++ )
    {
        if( !( elementFlags[i] & ts.ElementFlags.Optional ))
        {
            minPrefix = i + 1;
        }
    }

    const minItems = minPrefix + suffixTypes.length;

    return {
        typeArgs,
        elementFlags,
        hasRest,
        hasOptional,
        fixedCount,
        minItems,
        restIndex : hasRest ? restIndex : -1,
        restType,
        suffixTypes
    };
}
