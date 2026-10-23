import
{
    childPath,
    indexPath
}
    from './path.js';
import { createSafeRegex, testRegex } from './regex.js';
import
{
    assignOwnProperties,
    commitContainer,
    deepEqual,
    isPlainObject,
    report,
    setOwnProperty,
    shouldMutate,
    toStandardSchemaIssues,
    validate,
    validators,
    type CompiledSchema,
    type IValidationError,
    type JsonSchema,
    type JsonSchemaObject,
    type SchemaAnnotationFrame,
    type SchemaValidator,
    type StandardSchemaV1,
    type ValidationContext
}
    from './validators.js';

function emptyAnnotations(): SchemaAnnotationFrame
{
    return { properties : new Set(), items : new Set(), itemsAll : false };
}

function ensureAnnotations( ctx: ValidationContext ): SchemaAnnotationFrame
{
    if( !ctx.annotations ){ ctx.annotations = emptyAnnotations() }

    return ctx.annotations;
}

function mergeAnnotations( target: SchemaAnnotationFrame, source: SchemaAnnotationFrame ): void
{
    for( const key of source.properties ){ target.properties.add( key ) }

    for( const index of source.items ){ target.items.add( index ) }

    if( source.itemsAll ){ target.itemsAll = true }
}

function pushDynamicAnchor( ctx: ValidationContext, name: string, schema: JsonSchema | boolean ): void
{
    if( !ctx.dynamicAnchors ){ ctx.dynamicAnchors = [] }

    const top = ctx.dynamicAnchors[ctx.dynamicAnchors.length - 1];

    if( top )
    {
        top.set( name, schema );
    }
    else
    {
        ctx.dynamicAnchors.push( new Map([[ name, schema ]]));
    }
}

function resolveDynamicAnchor( ctx: ValidationContext, name: string ): JsonSchema | boolean | undefined
{
    if( !ctx.dynamicAnchors ){ return undefined }

    for( let i = ctx.dynamicAnchors.length - 1; i >= 0; i-- )
    {
        const found = ctx.dynamicAnchors[i].get( name );

        if( found !== undefined ){ return found }
    }

    return undefined;
}

function decodeContentEncoding( value: string, encoding: string ): Buffer | string | undefined
{
    const normalized = encoding.toLowerCase();

    if( normalized === 'base64' || normalized === 'base64url' )
    {
        const standard = normalized === 'base64url'
            ? value.replace( /-/g, '+' ).replace( /_/g, '/' )
            : value;
        const buf = Buffer.from( standard, 'base64' );

        if( buf.length === 0 && value.length > 0 ){ return undefined }

        return buf;
    }

    if( normalized === '7bit' || normalized === '8bit' || normalized === 'binary' || normalized === 'quoted-printable' )
    {
        return value;
    }

    return undefined;
}

function decodeJsonPointerToken( token: string ): string
{
    return token.replace( /~1/g, '/' ).replace( /~0/g, '~' );
}

const SCHEMA_META_KEYS = new Set([
    '$schema', '$id', '$defs', 'definitions', 'components',
    '$anchor', '$dynamicAnchor', '$recursiveAnchor'
]);

const SCHEMA_COMBINATOR_KEYS = new Set([
    '$ref', '$dynamicRef', '$recursiveRef', 'allOf', 'anyOf', 'oneOf'
]);

/** Resolve a local JSON Pointer / anchor `$ref` against the compiled root schema. */
function resolveSchemaRef(
    root: JsonSchema | boolean,
    ref: string,
    anchors?: Map<string, JsonSchema | boolean>
): JsonSchema | boolean
{
    if( ref === '#' || ref === '#/' )
    {
        return root;
    }

    if( /^https?:\/\//i.test( ref ))
    {
        throw new Error( `Unsupported JSON Schema reference: ${ref}` );
    }

    // Plain fragment anchor: `#name` (not a JSON Pointer `#/…`).
    if( ref.startsWith( '#' ) && !ref.startsWith( '#/' ))
    {
        const name = decodeURIComponent( ref.slice( 1 ));
        const found = anchors?.get( name );

        if( found !== undefined ){ return found }

        throw new Error( `Schema reference not found: ${ref}` );
    }

    if( !ref.startsWith( '#/' ))
    {
        throw new Error( `Schema reference not found: ${ref}` );
    }

    const tokens = ref.slice( 2 ).split( '/' ).map( decodeJsonPointerToken );
    let current: any = root;

    for( const token of tokens )
    {
        if( Array.isArray( current ))
        {
            const index = Number( token );

            if( !Number.isInteger( index ) || index < 0 || index >= current.length )
            {
                throw new Error( `Schema reference not found: ${ref}` );
            }

            current = current[index];
            continue;
        }

        if( current === null || typeof current !== 'object' || !Object.hasOwn( current, token ))
        {
            throw new Error( `Schema reference not found: ${ref}` );
        }

        current = current[token];
    }

    if( current === true || current === false )
    {
        return current;
    }

    if( current === null || typeof current !== 'object' || Array.isArray( current ))
    {
        throw new Error( `Schema reference not found: ${ref}` );
    }

    return current as JsonSchema;
}

function collectSchemaAnchors(
    node: unknown,
    anchors: Map<string, JsonSchema | boolean>
): boolean
{
    if( node === true || node === false || node === null || typeof node !== 'object' ){ return false }

    if( Array.isArray( node ))
    {
        let found = false;

        for( const item of node )
        {
            found = collectSchemaAnchors( item, anchors ) || found;
        }

        return found;
    }

    const schema = node as JsonSchemaObject;
    let found = ( 'unevaluatedProperties' in schema ) || ( 'unevaluatedItems' in schema );

    if( typeof schema.$anchor === 'string' ){ anchors.set( schema.$anchor, schema ) }

    if( typeof schema.$dynamicAnchor === 'string' ){ anchors.set( schema.$dynamicAnchor, schema ) }

    if( typeof schema.$recursiveAnchor === 'string' ){ anchors.set( schema.$recursiveAnchor, schema ) }

    if( schema.$recursiveAnchor === true ){ anchors.set( '', schema ) }

    for( const value of Object.values( schema ))
    {
        found = collectSchemaAnchors( value, anchors ) || found;
    }

    return found;
}

function schemaHasCombinator( schema: JsonSchemaObject ): boolean
{
    return !!( schema.$ref || schema.$dynamicRef || schema.$recursiveRef ||
        schema.allOf || schema.anyOf || schema.oneOf );
}

function schemaHasSignificantSibling( schema: JsonSchemaObject ): boolean
{
    for( const key of Object.keys( schema ))
    {
        if( SCHEMA_META_KEYS.has( key ) || SCHEMA_COMBINATOR_KEYS.has( key )){ continue }

        return true;
    }

    return false;
}

function dynamicAnchorName( schema: JsonSchemaObject ): string | undefined
{
    if( typeof schema.$dynamicAnchor === 'string' ){ return schema.$dynamicAnchor }

    if( typeof schema.$recursiveAnchor === 'string' ){ return schema.$recursiveAnchor }

    if( schema.$recursiveAnchor === true ){ return '' }

    return undefined;
}

/**
 * Schemas produced by {@link openAllOfMemberRoot}: unknown keys must be allowed for sibling-member
 * merging, but must NOT be annotation-evaluated (so parent `unevaluatedProperties` can see them).
 */
const allofOpenedRoots = new WeakSet<object>();

/**
 * Typeless object schemas inferred during compile: JSON Schema allows undeclared keys by default
 * without applying the `additionalProperties` applicator (so they stay unevaluated).
 */
const typelessInferredObjects = new WeakSet<object>();

/**
 * allOf members that close unknown keys must not reject sibling keys contributed by other members.
 * Open only the member's own root object; nested `additionalProperties` stay intact and see the
 * caller's real `mode`.
 */
function openAllOfMemberRoot( schema: JsonSchema | boolean ): JsonSchema | boolean
{
    if( typeof schema !== 'object' || schema === null || schema.type !== 'object' )
    {
        return schema;
    }

    if( 'additionalProperties' in schema && schema.additionalProperties !== false )
    {
        return schema;
    }

    const opened = { ...schema, additionalProperties : true as const };
    allofOpenedRoots.add( opened );

    return opened;
}

const compiledSchemas = new WeakMap<object, CompiledSchema<any>>();

export function getOrCompileSchema<T = unknown>( schema: JsonSchema | boolean ): CompiledSchema<T>
{
    if( typeof schema === 'boolean' ){ return compileSchema<T>( schema ) }

    if( typeof schema !== 'object' || schema === null || Array.isArray( schema ))
    {
        throw new Error( 'Invalid JSON Schema: must be a non-null object or boolean' );
    }
    let compiled = compiledSchemas.get( schema );

    if( !compiled )
    {
        compiled = compileSchema<T>( schema );
        compiledSchemas.set( schema, compiled );
    }

    return compiled as CompiledSchema<T>;
}

export function compileSchema<T = unknown>( schema: JsonSchema | boolean ): CompiledSchema<T>
{
    const rootSchema = schema;
    const compiledDefs = new Map<string, SchemaValidator>();
    const dynamicTargetCache = new Map<JsonSchema | boolean, SchemaValidator>();
    const anchors = new Map<string, JsonSchema | boolean>();
    const hasUnevaluated = collectSchemaAnchors( rootSchema, anchors );

    function trackAnnotations( ctx: ValidationContext ): boolean
    {
        return hasUnevaluated || ctx.annotations !== undefined;
    }

    function newProbeAnnotations( ctx: ValidationContext ): SchemaAnnotationFrame | undefined
    {
        return trackAnnotations( ctx ) ? emptyAnnotations() : undefined;
    }

    function commitProbeAnnotations( ctx: ValidationContext, source?: SchemaAnnotationFrame ): void
    {
        if( !source ){ return }

        mergeAnnotations( ensureAnnotations( ctx ), source );
    }

    /** Run `check` on the same instance location; child annotations merge into the parent frame. */
    function runInPlace(
        check: SchemaValidator,
        v: any,
        path: string,
        ctx: ValidationContext
    ): any
    {
        if( !trackAnnotations( ctx )){ return check( v, path, ctx ) }

        const parent = ensureAnnotations( ctx );
        const child = emptyAnnotations();
        ctx.annotations = child;
        const result = check( v, path, ctx );
        mergeAnnotations( parent, child );
        ctx.annotations = parent;

        return result;
    }

    /** Run `check` on a nested instance; annotations stay local to that call. */
    function runNested(
        check: SchemaValidator,
        v: any,
        path: string,
        ctx: ValidationContext
    ): any
    {
        if( !trackAnnotations( ctx )){ return check( v, path, ctx ) }

        const prev = ctx.annotations;
        ctx.annotations = emptyAnnotations();
        const result = check( v, path, ctx );
        ctx.annotations = prev;

        return result;
    }

    function markProperty( ctx: ValidationContext, key: string ): void
    {
        if( trackAnnotations( ctx )){ ensureAnnotations( ctx ).properties.add( key ) }
    }

    function markItem( ctx: ValidationContext, index: number ): void
    {
        if( trackAnnotations( ctx )){ ensureAnnotations( ctx ).items.add( index ) }
    }

    function markAllItems( ctx: ValidationContext ): void
    {
        if( trackAnnotations( ctx )){ ensureAnnotations( ctx ).itemsAll = true }
    }

    function withEnum( check: SchemaValidator, subSchema: JsonSchemaObject ): SchemaValidator
    {
        if( !Array.isArray( subSchema.enum )){ return check }

        const values = subSchema.enum;

        return ( v, path, ctx ) =>
        {
            v = check( v, path, ctx );

            if( !values.some( expected => deepEqual( v, expected )))
            {
                report(
                    ctx,
                    path,
                    `Enum<${values.map( expected => JSON.stringify( expected )).join( '|' )}>`,
                    v
                );
            }

            return v;
        };
    }

    function withConst( check: SchemaValidator, subSchema: JsonSchemaObject ): SchemaValidator
    {
        if( !Object.hasOwn( subSchema, 'const' )){ return check }

        const expected = subSchema.const;

        return ( v, path, ctx ) =>
        {
            v = check( v, path, ctx );

            if( !deepEqual( v, expected ))
            {
                report( ctx, path, `Const<${JSON.stringify( expected )}>`, v );
            }

            return v;
        };
    }

    function maybeWrapDynamicAnchor( check: SchemaValidator, subSchema: JsonSchemaObject ): SchemaValidator
    {
        const name = dynamicAnchorName( subSchema );

        if( name === undefined ){ return check }

        return ( v, path, ctx ) =>
        {
            pushDynamicAnchor( ctx, name, subSchema );

            return check( v, path, ctx );
        };
    }

    function finalize( check: SchemaValidator, subSchema: JsonSchemaObject ): SchemaValidator
    {
        let wrapped = check;

        if( Object.hasOwn( subSchema, 'not' ))
        {
            const inner = build( subSchema.not );
            const prev = wrapped;

            wrapped = ( v, path, ctx ) =>
            {
                const out = prev( v, path, ctx );

                if( !ctx.success ){ return out }

                const probe: ValidationContext =
                {
                    success        : true,
                    errors         : [],
                    mode           : ctx.mode,
                    from           : ctx.from,
                    mutate         : false,
                    root           : ctx.root,
                    dynamicAnchors : ctx.dynamicAnchors
                };
                inner( v, path, probe );

                if( probe.success )
                {
                    report( ctx, path, 'Schema<not>', v );
                }

                return out;
            };
        }

        if( Object.hasOwn( subSchema, 'if' ))
        {
            const ifCheck = build( subSchema.if! );
            const thenCheck = subSchema.then !== undefined ? build( subSchema.then ) : null;
            const elseCheck = subSchema.else !== undefined ? build( subSchema.else ) : null;
            const prev = wrapped;

            wrapped = ( v, path, ctx ) =>
            {
                let out = prev( v, path, ctx );

                if( !ctx.success ){ return out }

                const probe: ValidationContext =
                {
                    success        : true,
                    errors         : [],
                    mode           : ctx.mode,
                    from           : ctx.from,
                    mutate         : false,
                    root           : ctx.root,
                    annotations    : newProbeAnnotations( ctx ),
                    dynamicAnchors : ctx.dynamicAnchors
                };
                ifCheck( v, path, probe );

                commitProbeAnnotations( ctx, probe.annotations );

                if( probe.success )
                {
                    if( thenCheck ){ out = runInPlace( thenCheck, v, path, ctx ) }
                }
                else if( elseCheck )
                {
                    out = runInPlace( elseCheck, v, path, ctx );
                }

                return out;
            };
        }

        if( 'unevaluatedProperties' in subSchema || 'unevaluatedItems' in subSchema )
        {
            const unevaluatedProps = subSchema.unevaluatedProperties;
            const unevaluatedPropsCheck = unevaluatedProps && typeof unevaluatedProps === 'object'
                ? build( unevaluatedProps )
                : undefined;
            const unevaluatedItems = subSchema.unevaluatedItems;
            const unevaluatedItemsCheck = unevaluatedItems && typeof unevaluatedItems === 'object'
                ? build( unevaluatedItems )
                : undefined;
            const prev = wrapped;

            wrapped = ( v, path, ctx ) =>
            {
                const out = prev( v, path, ctx );

                if( !ctx.success ){ return out }

                if( 'unevaluatedProperties' in subSchema && isPlainObject( out ))
                {
                    const evaluated = ensureAnnotations( ctx ).properties;

                    for( const key of Object.keys( out ))
                    {
                        if( evaluated.has( key )){ continue }

                        if( unevaluatedProps === false )
                        {
                            report( ctx, path, `UnevaluatedProperty<${key}>`, out[key]);
                        }
                        else if( unevaluatedPropsCheck )
                        {
                            setOwnProperty(
                                out,
                                key,
                                runNested( unevaluatedPropsCheck, out[key], childPath( path, key ), ctx )
                            );
                        }
                    }
                }

                if( 'unevaluatedItems' in subSchema && Array.isArray( out ))
                {
                    const ann = ensureAnnotations( ctx );

                    for( let i = 0; i < out.length; i++ )
                    {
                        if( ann.itemsAll || ann.items.has( i )){ continue }

                        if( unevaluatedItems === false )
                        {
                            report( ctx, path, `UnevaluatedItem<${i}>`, out[i]);
                        }
                        else if( unevaluatedItemsCheck )
                        {
                            setOwnProperty(
                                out,
                                i,
                                runNested( unevaluatedItemsCheck, out[i], indexPath( path, i ), ctx )
                            );
                        }
                    }
                }

                return out;
            };
        }

        const finalized = withConst( withEnum( wrapped, subSchema ), subSchema );

        if( subSchema.nullable === true )
        {
            return ( v, path, ctx ) => v === null ? null : finalized( v, path, ctx );
        }

        return finalized;
    }

    function buildRefValidator( refPath: string ): SchemaValidator
    {
        if( compiledDefs.has( refPath ))
        {
            return compiledDefs.get( refPath )!;
        }

        const targetSchema = resolveSchemaRef( rootSchema, refPath, anchors );

        let resolved: SchemaValidator | null = null;
        const proxy: SchemaValidator = ( v, path, ctx ) =>
        {
            if( !resolved )
            {
                resolved = build( targetSchema );
            }

            return runInPlace( resolved, v, path, ctx );
        };

        compiledDefs.set( refPath, proxy );

        return proxy;
    }

    function buildDynamicRefValidator( refPath: string ): SchemaValidator
    {
        const name = decodeURIComponent( refPath.replace( /^#\/?/, '' ));

        return ( v, path, ctx ) =>
        {
            const target = resolveDynamicAnchor( ctx, name ) ?? anchors.get( name );

            if( target === undefined )
            {
                throw new Error( `Schema reference not found: ${refPath}` );
            }

            let compiledTarget = dynamicTargetCache.get( target );

            if( !compiledTarget )
            {
                compiledTarget = build( target );
                dynamicTargetCache.set( target, compiledTarget );
            }

            return runInPlace( compiledTarget, v, path, ctx );
        };
    }

    function peelCombinators( subSchema: JsonSchemaObject ): SchemaValidator
    {
        const rest: JsonSchemaObject = { ...subSchema };
        const members: ( JsonSchema | boolean )[] = [];

        if( rest.$ref )
        {
            members.push({ $ref : rest.$ref });
            delete rest.$ref;
        }

        if( rest.$dynamicRef )
        {
            members.push({ $dynamicRef : rest.$dynamicRef });
            delete rest.$dynamicRef;
        }

        if( rest.$recursiveRef )
        {
            members.push({ $recursiveRef : rest.$recursiveRef });
            delete rest.$recursiveRef;
        }

        if( rest.allOf )
        {
            members.push( ...rest.allOf );
            delete rest.allOf;
        }

        if( rest.anyOf )
        {
            members.push({ anyOf : rest.anyOf });
            delete rest.anyOf;
        }

        if( rest.oneOf )
        {
            members.push({ oneOf : rest.oneOf });
            delete rest.oneOf;
        }

        const composed: JsonSchemaObject = { allOf : [] };

        // Lift unevaluated* onto the composed schema so finalize sees merged sibling annotations.
        if( 'unevaluatedProperties' in rest )
        {
            composed.unevaluatedProperties = rest.unevaluatedProperties;
            delete rest.unevaluatedProperties;
        }

        if( 'unevaluatedItems' in rest )
        {
            composed.unevaluatedItems = rest.unevaluatedItems;
            delete rest.unevaluatedItems;
        }

        const restSignificant = Object.keys( rest ).some( key => !SCHEMA_META_KEYS.has( key ));
        const allOfMembers: ( JsonSchema | boolean )[] = [];

        if( restSignificant ){ allOfMembers.push( rest ) }

        allOfMembers.push( ...members );
        composed.allOf = allOfMembers;

        return build( composed, { skipPeel : true });
    }

    function build( subSchema: JsonSchema | boolean | undefined, opts?: { skipPeel? : boolean }): SchemaValidator
    {
        if( subSchema === true || subSchema === undefined )
        {
            return ( v ) => v;
        }

        if( subSchema === false )
        {
            return ( v, path, ctx ) =>
            {
                report( ctx, path, 'Schema<false>', v );

                return v;
            };
        }

        if( !subSchema || typeof subSchema !== 'object' || Array.isArray( subSchema ))
        {
            throw new Error( 'Invalid JSON Schema: subschemas must be objects or booleans' );
        }

        if( Array.isArray( subSchema.type ))
        {
            const types = subSchema.type;

            for( const t of types )
            {
                if( ![ 'string', 'number', 'integer', 'boolean', 'null', 'array', 'object' ].includes( t ))
                {
                    throw new Error( `Unsupported JSON Schema type: ${t}` );
                }
            }

            const { type : _type, ...rest } = subSchema;

            return maybeWrapDynamicAnchor( build({
                ...rest,
                anyOf : types.map( t => ({ ...rest, type : t }))
            }), subSchema );
        }

        if( typeof subSchema.type === 'string' &&
            !['string', 'number', 'integer', 'boolean', 'null', 'array', 'object'].includes( subSchema.type ))
        {
            throw new Error( `Unsupported JSON Schema type: ${subSchema.type}` );
        }

        if( !opts?.skipPeel && schemaHasCombinator( subSchema ) && schemaHasSignificantSibling( subSchema ))
        {
            return maybeWrapDynamicAnchor( peelCombinators( subSchema ), subSchema );
        }

        if( subSchema.$ref )
        {
            return maybeWrapDynamicAnchor( buildRefValidator( subSchema.$ref ), subSchema );
        }

        if( subSchema.$dynamicRef )
        {
            return maybeWrapDynamicAnchor( buildDynamicRefValidator( subSchema.$dynamicRef ), subSchema );
        }

        if( subSchema.$recursiveRef )
        {
            return maybeWrapDynamicAnchor( buildDynamicRefValidator( subSchema.$recursiveRef ), subSchema );
        }

        if( subSchema['x-typescript-type'] === 'Date' )
        {
            return finalize(( v, path, ctx ) => validators.date( v, path, ctx ), subSchema );
        }

        if( subSchema['x-typescript-type'] === 'URL' )
        {
            return finalize(( v, path, ctx ) => validators.urlInstance( v, path, ctx ), subSchema );
        }

        if( subSchema['x-typescript-type'] === 'RegExp' )
        {
            return finalize(( v, path, ctx ) => validators.regexp( v, path, ctx ), subSchema );
        }

        if( subSchema['x-typescript-type'] === 'bigint' )
        {
            return finalize(( v, path, ctx ) => validators.bigint( v, path, ctx ), subSchema );
        }

        if( subSchema['x-typescript-type'] === 'undefined' )
        {
            return finalize(( v, path, ctx ) => validators.undefined( v, path, ctx ), subSchema );
        }

        if( subSchema['x-typescript-type'] === 'Set' )
        {
            const child = build( subSchema.items && !Array.isArray( subSchema.items ) ? subSchema.items : {});

            return finalize(( v, path, ctx ) => validators.set( v, path, ctx, child ), subSchema );
        }

        if( subSchema['x-typescript-type'] === 'Map' )
        {
            const keyCheck = build( subSchema.key || { type : 'string' });
            const valueCheck = build( subSchema.value || {});

            return finalize(( v, path, ctx ) => validators.map( v, path, ctx, keyCheck, valueCheck ), subSchema );
        }

        if( subSchema['x-typescript-type'] === 'Promise' )
        {
            return finalize(( v, path, ctx ) =>
            {
                if( !( v instanceof Promise ))
                {
                    report( ctx, path, 'Type<Promise>', v );
                }

                return v;
            }, subSchema );
        }

        if( typeof subSchema['x-typescript-type'] === 'string' &&
            ['Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Buffer'].includes( subSchema['x-typescript-type']))
        {
            const typeName = subSchema['x-typescript-type'];

            return finalize(( v, path, ctx ) =>
            {
                const ctor = ( globalThis as any )[typeName];

                if( !ctor || !( v instanceof ctor ))
                {
                    report( ctx, path, `Type<${typeName}>`, v );
                }

                return v;
            }, subSchema );
        }

        if( 'x-typescript-type' in subSchema )
        {
            throw new Error( `Unsupported x-typescript-type: ${subSchema['x-typescript-type']}` );
        }

        if( subSchema.allOf )
        {
            const openedMembers = subSchema.allOf.map(( s ) => openAllOfMemberRoot( s ));
            const checks = openedMembers.map(( s ) => build( s ));
            const mergeKeys = openedMembers.map(( s ) =>
            {
                if( typeof s !== 'object' || s === null || s.type !== 'object' )
                {
                    return undefined;
                }

                // Synthetic opens — only declared props merge;
                // extras stay on the instance for parent unevaluated* or combinedKeys.
                if( !allofOpenedRoots.has( s ))
                {
                    return undefined;
                }

                return new Set<string>( Object.keys( s.properties || {}));
            });
            const allOriginallyClosedObjects = subSchema.allOf.length > 0 &&
                subSchema.allOf.every(( s ) =>
                    typeof s === 'object' && s !== null && s.type === 'object' &&
                    !( 'additionalProperties' in s && s.additionalProperties !== false )
                );
            // Parent `unevaluatedProperties` owns unknown-key policy. Otherwise closed allOf
            // still rejects undeclared extras via combinedKeys after members succeed.
            const allowsAdditional = ( 'unevaluatedProperties' in subSchema ) ||
                !allOriginallyClosedObjects;
            const combinedKeys = allowsAdditional
                ? undefined
                : new Set<string>( subSchema.allOf.flatMap(( s ) =>
                    Object.keys(( s as JsonSchemaObject ).properties || {})
                ));

            return maybeWrapDynamicAnchor( finalize(( v, path, ctx ) =>
            {
                const errors: IValidationError[] = [];
                let data: any = undefined;
                const subCtx: ValidationContext =
                {
                    success        : true,
                    errors         : [],
                    mode           : ctx.mode,
                    from           : ctx.from,
                    mutate         : false,
                    root           : ctx.root,
                    annotations    : undefined,
                    dynamicAnchors : ctx.dynamicAnchors
                };

                for( let i = 0; i < checks.length; i++ )
                {
                    const check = checks[i];
                    subCtx.success = true;
                    subCtx.errors.length = 0;
                    subCtx.from = ctx.from;
                    subCtx.root = ctx.root;
                    subCtx.annotations = newProbeAnnotations( ctx );
                    subCtx.dynamicAnchors = ctx.dynamicAnchors;
                    const val = check( v, path, subCtx );

                    errors.push( ...subCtx.errors );

                    if( subCtx.success )
                    {
                        commitProbeAnnotations( ctx, subCtx.annotations );
                    }

                    if( data === undefined )
                    {
                        data = isPlainObject( val ) ? {} : val;
                    }

                    if( isPlainObject( val ) && isPlainObject( data ))
                    {
                        const keys = mergeKeys[i] || new Set( Object.keys( val ));

                        for( const key of keys )
                        {
                            if( Object.hasOwn( val, key )){ setOwnProperty( data, key, val[key]) }
                        }
                    }
                    else if( data !== val )
                    {
                        data = val;
                    }
                }

                if( errors.length > 0 )
                {
                    ctx.success = false;
                    ctx.errors.push( ...errors );

                    return v;
                }

                if( combinedKeys && isPlainObject( v ) && isPlainObject( data ))
                {
                    for( const key of Object.keys( v ))
                    {
                        if( combinedKeys.has( key )){ continue }

                        if( ctx.mode === 'strict' )
                        {
                            report( ctx, path, `PropertyNotAllowed<${key}>`, v[key]);
                        }
                        else if( ctx.mode === 'strip' )
                        {
                            delete data[key];
                        }
                        else
                        {
                            setOwnProperty( data, key, v[key]);
                        }
                    }
                }
                else if(( 'unevaluatedProperties' in subSchema ) && isPlainObject( v ) && isPlainObject( data ))
                {
                    // Member merges only copy evaluated keys; keep unevaluated extras on the
                    // result so finalize's unevaluatedProperties can see them.
                    for( const key of Object.keys( v ))
                    {
                        if( Object.hasOwn( data, key )){ continue }

                        setOwnProperty( data, key, v[key]);
                    }
                }

                if( !ctx.success ){ return v }

                if( shouldMutate( ctx ) && commitContainer( v, data )){ return v }

                return data === undefined ? v : data;
            }, subSchema ), subSchema );
        }

        if( subSchema.oneOf )
        {
            const checks = subSchema.oneOf.map(( s ) => build( s ));

            return maybeWrapDynamicAnchor( finalize(( v, path, ctx ) =>
            {
                const matches: any[] = [];
                const matchAnnotations: ( SchemaAnnotationFrame | undefined )[] = [];
                const armErrors: IValidationError[] = [];
                const subCtx: ValidationContext =
                {
                    success        : true,
                    errors         : [],
                    mode           : ctx.mode,
                    from           : undefined,
                    mutate         : false,
                    root           : ctx.root,
                    annotations    : undefined,
                    dynamicAnchors : ctx.dynamicAnchors
                };

                const runPass = ( from: ValidationContext['from']) =>
                {
                    matches.length = 0;
                    matchAnnotations.length = 0;
                    armErrors.length = 0;

                    for( const check of checks )
                    {
                        subCtx.success = true;
                        subCtx.errors.length = 0;
                        subCtx.from = from;
                        subCtx.root = ctx.root;
                        subCtx.annotations = newProbeAnnotations( ctx );
                        subCtx.dynamicAnchors = ctx.dynamicAnchors;
                        const val = check( v, path, subCtx );

                        if( subCtx.success )
                        {
                            matches.push( val );
                            matchAnnotations.push( subCtx.annotations );
                        }
                        else
                        {
                            armErrors.push( ...subCtx.errors );
                        }
                    }
                };

                runPass( undefined );

                if( matches.length === 0 && ctx.from )
                {
                    runPass( ctx.from );
                }

                if( matches.length === 1 )
                {
                    commitProbeAnnotations( ctx, matchAnnotations[0]);

                    const val = matches[0];

                    if( shouldMutate( ctx ) && commitContainer( v, val )){ return v }

                    return val;
                }

                ctx.success = false;
                ctx.errors.push({
                    path,
                    value  : v,
                    error  : matches.length === 0 ? 'Type<OneOf>' : 'Type<OneOf:multiple>',
                    issues : armErrors.length > 0 ? armErrors : undefined
                });

                return v;
            }, subSchema ), subSchema );
        }

        if( subSchema.type === 'string' )
        {
            const minLength = subSchema.minLength;
            const maxLength = subSchema.maxLength;
            const pattern = subSchema.pattern ? createSafeRegex( subSchema.pattern ) : undefined;
            const patternStr = subSchema.pattern;
            const format = subSchema.format;
            const contentEncoding = subSchema.contentEncoding;
            const contentMediaType = subSchema.contentMediaType;
            const contentSchemaCheck = subSchema.contentSchema !== undefined
                ? build( subSchema.contentSchema )
                : undefined;

            return maybeWrapDynamicAnchor( finalize(( v, path, ctx ) =>
            {
                v = validators.string( v, path, ctx );

                if( v === undefined || v === null ){ return v }

                if( minLength !== undefined ){ validators.minLength( v, path, ctx, minLength ) }

                if( maxLength !== undefined ){ validators.maxLength( v, path, ctx, maxLength ) }

                if( pattern !== undefined && patternStr !== undefined )
                {
                    validators.pattern( v, path, ctx, pattern, patternStr );
                }

                if( format !== undefined ){ v = validators.format( v, path, ctx, format ) }

                if( typeof v === 'string' &&
                    ( contentEncoding !== undefined || contentMediaType !== undefined || contentSchemaCheck ))
                {
                    let decoded: Buffer | string = v;

                    if( contentEncoding !== undefined )
                    {
                        const result = decodeContentEncoding( v, contentEncoding );

                        if( result === undefined )
                        {
                            report( ctx, path, 'ContentEncoding', v );

                            return v;
                        }

                        decoded = result;
                    }

                    if( contentMediaType === 'application/json' )
                    {
                        let parsed: any;

                        try
                        {
                            const text = typeof decoded === 'string' ? decoded : decoded.toString( 'utf8' );
                            parsed = JSON.parse( text );
                        }
                        catch
                        {
                            report( ctx, path, 'ContentMediaType', v );

                            return v;
                        }

                        if( contentSchemaCheck )
                        {
                            runNested( contentSchemaCheck, parsed, path, ctx );
                        }
                    }
                    else if( contentSchemaCheck )
                    {
                        const text = typeof decoded === 'string' ? decoded : decoded.toString( 'utf8' );
                        runNested( contentSchemaCheck, text, path, ctx );
                    }
                }

                return v;
            }, subSchema ), subSchema );
        }

        if( subSchema.type === 'number' || subSchema.type === 'integer' )
        {
            const isInt = subSchema.type === 'integer';
            const minimum = subSchema.minimum;
            const maximum = subSchema.maximum;
            const exclusiveMinimum = subSchema.exclusiveMinimum;
            const exclusiveMaximum = subSchema.exclusiveMaximum;
            const multipleOf = subSchema.multipleOf;

            return maybeWrapDynamicAnchor( finalize(( v, path, ctx ) =>
            {
                v = validators.number( v, path, ctx );

                if( v === undefined || v === null ){ return v }

                if( isInt && typeof v === 'number' && !Number.isInteger( v ))
                {
                    report( ctx, path, 'Type<integer>', v );
                }

                if( typeof exclusiveMinimum === 'boolean' )
                {
                    if( exclusiveMinimum === true && minimum !== undefined )
                    {
                        validators.exclusiveMinimum( v, path, ctx, minimum );
                    }
                    else if( minimum !== undefined )
                    {
                        validators.minimum( v, path, ctx, minimum );
                    }
                }
                else
                {
                    if( minimum !== undefined ){ validators.minimum( v, path, ctx, minimum ) }

                    if( exclusiveMinimum !== undefined )
                    {
                        validators.exclusiveMinimum( v, path, ctx, exclusiveMinimum );
                    }
                }

                if( typeof exclusiveMaximum === 'boolean' )
                {
                    if( exclusiveMaximum === true && maximum !== undefined )
                    {
                        validators.exclusiveMaximum( v, path, ctx, maximum );
                    }
                    else if( maximum !== undefined )
                    {
                        validators.maximum( v, path, ctx, maximum );
                    }
                }
                else
                {
                    if( maximum !== undefined ){ validators.maximum( v, path, ctx, maximum ) }

                    if( exclusiveMaximum !== undefined )
                    {
                        validators.exclusiveMaximum( v, path, ctx, exclusiveMaximum );
                    }
                }

                if( multipleOf !== undefined ){ validators.multipleOf( v, path, ctx, multipleOf ) }

                return v;
            }, subSchema ), subSchema );
        }

        if( subSchema.type === 'boolean' )
        {
            return maybeWrapDynamicAnchor(
                finalize(( v, path, ctx ) => validators.boolean( v, path, ctx ), subSchema ),
                subSchema
            );
        }

        if( subSchema.type === 'null' )
        {
            return maybeWrapDynamicAnchor(
                finalize(( v, path, ctx ) => validators.null( v, path, ctx ), subSchema ),
                subSchema
            );
        }

        if( subSchema.anyOf )
        {
            const checks = subSchema.anyOf.map(( s ) => build( s ));

            return maybeWrapDynamicAnchor( finalize(( v, path, ctx ) =>
            {
                const successes: any[] = [];
                const successAnnotations: ( SchemaAnnotationFrame | undefined )[] = [];
                const unionErrors: IValidationError[] = [];
                const subCtx: ValidationContext =
                {
                    success        : true,
                    errors         : [],
                    mode           : ctx.mode,
                    from           : undefined,
                    mutate         : false,
                    root           : ctx.root,
                    annotations    : undefined,
                    dynamicAnchors : ctx.dynamicAnchors
                };

                const runPass = ( from: ValidationContext['from']) =>
                {
                    successes.length = 0;
                    successAnnotations.length = 0;
                    unionErrors.length = 0;

                    for( const check of checks )
                    {
                        subCtx.success = true;
                        subCtx.errors.length = 0;
                        subCtx.from = from;
                        subCtx.root = ctx.root;
                        subCtx.annotations = newProbeAnnotations( ctx );
                        subCtx.dynamicAnchors = ctx.dynamicAnchors;
                        const val = check( v, path, subCtx );

                        if( subCtx.success )
                        {
                            successes.push( val );
                            successAnnotations.push( subCtx.annotations );
                        }
                        else
                        {
                            unionErrors.push( ...subCtx.errors );
                        }
                    }
                };

                runPass( undefined );

                if( successes.length === 0 && ctx.from )
                {
                    runPass( ctx.from );
                }

                if( successes.length > 0 )
                {
                    for( const ann of successAnnotations )
                    {
                        commitProbeAnnotations( ctx, ann );
                    }

                    const val = successes[0];

                    if( shouldMutate( ctx ) && commitContainer( v, val )){ return v }

                    return val;
                }

                ctx.success = false;
                ctx.errors.push({
                    path,
                    value  : v,
                    error  : 'Type<Union>',
                    issues : unionErrors.length > 0 ? unionErrors : undefined
                });

                return v;
            }, subSchema ), subSchema );
        }

        if( subSchema.type === 'array' )
        {
            const draft7Tuple = !!( !subSchema.prefixItems && Array.isArray( subSchema.items ));
            const prefixSchemas = subSchema.prefixItems
                ?? ( draft7Tuple ? subSchema.items as ( JsonSchema | boolean )[] : undefined );
            const prefixChecks = prefixSchemas ? prefixSchemas.map(( s ) => build( s )) : undefined;

            // Draft-07 tuple uses `additionalItems` (default true). Draft 2020-12 uses `items`
            // after `prefixItems`; omitting it leaves trailing items unevaluated.
            let restSchema: boolean | JsonSchema | undefined;
            let restAllowsWithoutEvaluating = false;

            if( draft7Tuple )
            {
                restSchema = 'additionalItems' in subSchema ? subSchema.additionalItems : true;
            }
            else if( 'prefixItems' in subSchema )
            {
                if( 'items' in subSchema && subSchema.items !== undefined )
                {
                    restSchema = subSchema.items as boolean | JsonSchema | undefined;
                }
                else
                {
                    restAllowsWithoutEvaluating = true;
                    restSchema = undefined;
                }
            }
            else
            {
                restSchema = subSchema.items as boolean | JsonSchema | undefined;
            }

            const restCheck = restSchema !== undefined && restSchema !== true && restSchema !== false
                ? build( restSchema )
                : undefined;
            const rejectAllItems = !prefixChecks && restSchema === false;
            // When there is no prefix, `restAllowsWithoutEvaluating` is unreachable (it only
            // applies after `prefixItems`), so plain `items`-less arrays allow every element.
            const allowAllItems = !prefixChecks && ( restSchema === true ||
                ( restSchema === undefined &&
                    !( 'unevaluatedItems' in subSchema ) &&
                    !( 'contains' in subSchema )));
            const minItems = subSchema.minItems;
            const maxItems = subSchema.maxItems;
            const uniqueItems = subSchema.uniqueItems;
            const containsCheck = 'contains' in subSchema ? build( subSchema.contains ) : undefined;
            const minContains = subSchema.minContains ?? ( containsCheck ? 1 : undefined );
            const maxContains = subSchema.maxContains;

            return maybeWrapDynamicAnchor( finalize(( v, path, ctx ) =>
            {
                if( !Array.isArray( v ))
                {
                    v = validators.array( v, path, ctx, ( x: any ) => x );

                    if( !Array.isArray( v )){ return v }
                }

                const data = shouldMutate( ctx ) ? v : v.slice();

                if( prefixChecks )
                {
                    for( let i = 0; i < prefixChecks.length; i++ )
                    {
                        if( i >= v.length ){ break }

                        setOwnProperty(
                            data,
                            i,
                            runNested( prefixChecks[i], v[i], indexPath( path, i ), ctx )
                        );
                        markItem( ctx, i );
                    }

                    for( let i = prefixChecks.length; i < v.length; i++ )
                    {
                        if( restSchema === false )
                        {
                            report( ctx, path, `AdditionalItem<${i}>`, v[i]);
                            markItem( ctx, i );
                        }
                        else if( restCheck )
                        {
                            setOwnProperty(
                                data,
                                i,
                                runNested( restCheck, v[i], indexPath( path, i ), ctx )
                            );
                            markItem( ctx, i );
                        }
                        else if( restAllowsWithoutEvaluating )
                        {
                            setOwnProperty( data, i, v[i]);
                        }
                        else
                        {
                            setOwnProperty( data, i, v[i]);
                            markItem( ctx, i );
                        }
                    }
                }
                else if( rejectAllItems )
                {
                    for( let i = 0; i < v.length; i++ )
                    {
                        report( ctx, path, `AdditionalItem<${i}>`, v[i]);
                        markItem( ctx, i );
                    }
                }
                else if( restCheck )
                {
                    for( let i = 0; i < v.length; i++ )
                    {
                        setOwnProperty(
                            data,
                            i,
                            runNested( restCheck, v[i], indexPath( path, i ), ctx )
                        );
                    }

                    markAllItems( ctx );
                }
                else if( allowAllItems )
                {
                    for( let i = 0; i < v.length; i++ )
                    {
                        setOwnProperty( data, i, v[i]);
                    }

                    if( restSchema === true ){ markAllItems( ctx ) }
                    else
                    {
                        for( let i = 0; i < v.length; i++ ){ markItem( ctx, i ) }
                    }
                }
                else
                {
                    for( let i = 0; i < v.length; i++ )
                    {
                        setOwnProperty( data, i, v[i]);
                    }
                }

                if( minItems !== undefined ){ validators.minItems( data, path, ctx, minItems ) }

                if( maxItems !== undefined ){ validators.maxItems( data, path, ctx, maxItems ) }

                if( uniqueItems ){ validators.uniqueItems( data, path, ctx ) }

                if( containsCheck )
                {
                    let count = 0;

                    for( let i = 0; i < v.length; i++ )
                    {
                        const probe: ValidationContext =
                        {
                            success        : true,
                            errors         : [],
                            mode           : ctx.mode,
                            from           : ctx.from,
                            mutate         : false,
                            root           : ctx.root,
                            dynamicAnchors : ctx.dynamicAnchors
                        };
                        containsCheck( v[i], indexPath( path, i ), probe );

                        if( probe.success )
                        {
                            count++;
                            markItem( ctx, i );
                        }
                    }

                    if( minContains !== undefined && count < minContains )
                    {
                        report( ctx, path, `Contains<min:${minContains}>`, v );
                    }

                    if( maxContains !== undefined && count > maxContains )
                    {
                        report( ctx, path, `Contains<max:${maxContains}>`, v );
                    }
                }

                return data;
            }, subSchema ), subSchema );
        }

        if( subSchema.type === 'object' )
        {
            const properties = subSchema.properties || {};
            const required = subSchema.required || [];
            const propVals: [string, boolean, SchemaValidator][] = Object.entries( properties ).map(([ key, s ]) =>
            {
                const isOptional = !required.includes( key );
                const inner = build( s );
                const check: SchemaValidator = hasUnevaluated
                    ? ( val, p, c ) => runNested( inner, val, p, c )
                    : inner;

                return [ key, isOptional, check ];
            });

            for( const key of required )
            {
                if( Object.hasOwn( properties, key )){ continue }

                propVals.push([
                    key,
                    false,
                    ( val, path, ctx ) =>
                    {
                        if( val === undefined )
                        {
                            report( ctx, path, `Required<${key}>`, val );
                        }

                        return val;
                    }
                ]);
            }

            const patternEntries = Object.entries( subSchema.patternProperties || {}).map(([ pattern, schema ]) =>
                ({
                    regex : createSafeRegex( pattern ),
                    check : build( schema )
                }));
            const propertyNamesCheck = 'propertyNames' in subSchema
                ? build( subSchema.propertyNames )
                : undefined;
            const hasUnevaluatedProps = 'unevaluatedProperties' in subSchema;
            // Omit `additionalProperties` when only `unevaluatedProperties` is present (or when the
            // object was inferred from a typeless schema) so unknown keys stay unevaluated.
            // Explicit `type: 'object'` still defaults to closed otherwise.
            const additional = 'additionalProperties' in subSchema
                ? subSchema.additionalProperties
                : ( hasUnevaluatedProps || typelessInferredObjects.has( subSchema ) ? undefined : false );
            const additionalCheck = additional && typeof additional === 'object' ? build( additional ) : undefined;
            // Synthetic allOf opens allow extras without evaluating them for unevaluated*.
            const allowWithoutEvaluating = additional === true && allofOpenedRoots.has( subSchema );
            const propertyKeys = Object.keys( properties );
            const knownPropKeys = new Set<string>([ ...propertyKeys, ...required ]);
            const canUseStrictKeys = additional === false &&
                patternEntries.length === 0 &&
                !hasUnevaluatedProps;
            const closedShape = additional === false ||
                !!additionalCheck ||
                patternEntries.length > 0 ||
                hasUnevaluatedProps;
            const minProperties = subSchema.minProperties;
            const maxProperties = subSchema.maxProperties;
            const dependentRequired = subSchema.dependentRequired || {};
            const dependentRequiredEntries = Object.entries( dependentRequired );
            const dependentSchemas = Object.entries( subSchema.dependentSchemas || {}).map(([ key, schema ]) =>
                ({ key, check : build( openAllOfMemberRoot( schema ))}));
            const dependencies = Object.entries( subSchema.dependencies || {}).map(([ key, dep ]) =>
            {
                if( Array.isArray( dep ))
                {
                    return { key, required : dep as string[], check : undefined as SchemaValidator | undefined };
                }

                return { key, required : undefined as string[] | undefined, check : build( openAllOfMemberRoot( dep )) };
            });

            return maybeWrapDynamicAnchor( finalize(( v, path, ctx ) =>
            {
                const obj = validators.object(
                    v,
                    path,
                    ctx,
                    canUseStrictKeys ? knownPropKeys : undefined,
                    'Object'
                );

                if( obj === false ){ return v }

                const data = validators.objectShell( obj, ctx, closedShape );

                if( propertyNamesCheck )
                {
                    for( const key of Object.keys( obj ))
                    {
                        runNested( propertyNamesCheck, key, childPath( path, key ), ctx );
                    }
                }

                validators.props( obj, data, path, ctx, propVals );

                if( canUseStrictKeys )
                {
                    if( ctx.annotations )
                    {
                        for( const key of propertyKeys )
                        {
                            if( Object.hasOwn( obj, key )){ markProperty( ctx, key ) }
                        }
                    }

                    validators.stripExtras( data, ctx, knownPropKeys );
                }
                else
                {
                    const evaluated = new Set<string>();
                    const objKeys = Object.keys( obj );

                    for( const key of propertyKeys )
                    {
                        if( !Object.hasOwn( obj, key )){ continue }

                        evaluated.add( key );
                        markProperty( ctx, key );
                    }

                    for( const key of objKeys )
                    {
                        for( const entry of patternEntries )
                        {
                            if( !testRegex( entry.regex, key )){ continue }

                            evaluated.add( key );
                            markProperty( ctx, key );
                            setOwnProperty(
                                data,
                                key,
                                runNested( entry.check, obj[key], childPath( path, key ), ctx )
                            );
                        }
                    }

                    const forAdditional = objKeys.filter( key => !evaluated.has( key ));

                    if( additionalCheck )
                    {
                        for( const key of forAdditional )
                        {
                            evaluated.add( key );
                            markProperty( ctx, key );
                            setOwnProperty(
                                data,
                                key,
                                runNested( additionalCheck, obj[key], childPath( path, key ), ctx )
                            );
                        }
                    }
                    else if( additional === true )
                    {
                        for( const key of forAdditional )
                        {
                            setOwnProperty( data, key, obj[key]);

                            if( allowWithoutEvaluating ){ continue }

                            evaluated.add( key );
                            markProperty( ctx, key );
                        }
                    }
                    else if( additional === false )
                    {
                        for( const key of forAdditional )
                        {
                            if( ctx.mode === 'strict' )
                            {
                                report( ctx, path, `PropertyNotAllowed<${key}>`, obj[key]);
                            }
                            else if( ctx.mode === 'strip' )
                            {
                                delete data[key];
                            }
                            else
                            {
                                setOwnProperty( data, key, obj[key]);
                            }
                        }
                    }
                    else
                    {
                        // `additionalProperties` absent (typically with `unevaluatedProperties`): keep
                        // values on the shell but leave them unevaluated.
                        for( const key of forAdditional )
                        {
                            setOwnProperty( data, key, obj[key]);
                        }
                    }
                }

                if( minProperties !== undefined ){ validators.minProperties( data, path, ctx, minProperties ) }

                if( maxProperties !== undefined ){ validators.maxProperties( data, path, ctx, maxProperties ) }

                for( const [ key, deps ] of dependentRequiredEntries )
                {
                    if( !Object.hasOwn( obj, key )){ continue }

                    for( const dep of deps )
                    {
                        if( !Object.hasOwn( obj, dep ))
                        {
                            report( ctx, childPath( path, dep ), `Required<${dep}>`, undefined );
                        }
                    }
                }

                for( const entry of dependentSchemas )
                {
                    if( !Object.hasOwn( obj, entry.key )){ continue }

                    const next = runInPlace( entry.check, obj, path, ctx );

                    if( isPlainObject( next ))
                    {
                        assignOwnProperties( data, next );
                    }
                }

                for( const entry of dependencies )
                {
                    if( !Object.hasOwn( obj, entry.key )){ continue }

                    if( entry.required )
                    {
                        for( const dep of entry.required )
                        {
                            if( !Object.hasOwn( obj, dep ))
                            {
                                report( ctx, childPath( path, dep ), `Required<${dep}>`, undefined );
                            }
                        }
                    }
                    else
                    {
                        const next = runInPlace( entry.check!, obj, path, ctx );

                        if( isPlainObject( next ))
                        {
                            assignOwnProperties( data, next );
                        }
                    }
                }

                return data;
            }, subSchema ), subSchema );
        }

        // Typeless schemas: JSON Schema applies type-specific keywords only when the instance
        // already has that type. Explicit `type: 'object'` still defaults additionalProperties to
        // false (TS closed shapes); inferred object schemas default to true.
        const hasStringKeywords = subSchema.minLength !== undefined ||
            subSchema.maxLength !== undefined ||
            subSchema.pattern !== undefined ||
            subSchema.format !== undefined ||
            subSchema.contentEncoding !== undefined ||
            subSchema.contentMediaType !== undefined ||
            subSchema.contentSchema !== undefined;
        const hasNumberKeywords = subSchema.minimum !== undefined ||
            subSchema.maximum !== undefined ||
            subSchema.exclusiveMinimum !== undefined ||
            subSchema.exclusiveMaximum !== undefined ||
            subSchema.multipleOf !== undefined;
        const arrayKeywords = [
            'items', 'prefixItems', 'additionalItems', 'minItems', 'maxItems',
            'uniqueItems', 'contains', 'minContains', 'maxContains', 'unevaluatedItems'
        ] as const;
        const objectKeywords = [
            'properties', 'patternProperties', 'propertyNames', 'required',
            'additionalProperties', 'unevaluatedProperties', 'dependencies',
            'dependentRequired', 'dependentSchemas', 'minProperties', 'maxProperties'
        ] as const;
        const hasArrayKeywords = arrayKeywords.some( k => k in subSchema && ( subSchema as any )[k] !== undefined );
        const hasObjectKeywords = objectKeywords.some( k => k in subSchema && ( subSchema as any )[k] !== undefined );

        if( hasStringKeywords || hasNumberKeywords || hasArrayKeywords || hasObjectKeywords )
        {
            const pickKeywords = ( type: 'array' | 'object', keys: readonly string[]): JsonSchemaObject =>
            {
                const out: JsonSchemaObject = { type };

                for( const k of keys )
                {
                    if( k in subSchema && ( subSchema as any )[k] !== undefined )
                    {
                        ( out as any )[k] = ( subSchema as any )[k];
                    }
                }

                return out;
            };
            const stringCheck = hasStringKeywords
                ? build({
                    type             : 'string',
                    minLength        : subSchema.minLength,
                    maxLength        : subSchema.maxLength,
                    pattern          : subSchema.pattern,
                    format           : subSchema.format,
                    contentEncoding  : subSchema.contentEncoding,
                    contentMediaType : subSchema.contentMediaType,
                    contentSchema    : subSchema.contentSchema
                })
                : undefined;
            const numberCheck = hasNumberKeywords
                ? build({
                    type             : 'number',
                    minimum          : subSchema.minimum,
                    maximum          : subSchema.maximum,
                    exclusiveMinimum : subSchema.exclusiveMinimum,
                    exclusiveMaximum : subSchema.exclusiveMaximum,
                    multipleOf       : subSchema.multipleOf
                })
                : undefined;
            const arrayCheck = hasArrayKeywords
                ? build( pickKeywords( 'array', arrayKeywords ))
                : undefined;
            const objectCheck = hasObjectKeywords
                ? build((() =>
                {
                    const inferred = pickKeywords( 'object', objectKeywords );

                    if( !( 'additionalProperties' in subSchema ))
                    {
                        typelessInferredObjects.add( inferred );
                    }

                    return inferred;
                })())
                : undefined;

            return maybeWrapDynamicAnchor( finalize(( v, path, ctx ) =>
            {
                if( typeof v === 'string' && stringCheck ){ return stringCheck( v, path, ctx ) }

                if( typeof v === 'number' && numberCheck ){ return numberCheck( v, path, ctx ) }

                if( Array.isArray( v ) && arrayCheck ){ return arrayCheck( v, path, ctx ) }

                if( isPlainObject( v ) && objectCheck ){ return objectCheck( v, path, ctx ) }

                return v;
            }, subSchema ), subSchema );
        }

        return maybeWrapDynamicAnchor( finalize(( v ) => v, subSchema ), subSchema );
    }

    const compiled = build( schema );

    Object.defineProperty( compiled, '~standard', {
        value : {
            version : 1,
            vendor  : 'webergency-typechecker',
            validate( value: unknown ): StandardSchemaV1.Result<unknown>
            {
                const res = validate( compiled, value );

                if( res.success )
                {
                    return { value : res.data };
                }

                return { issues : toStandardSchemaIssues( res.errors ) };
            }
        },
        writable     : true,
        configurable : true,
        enumerable   : false
    });

    return compiled as CompiledSchema<T>;
}
