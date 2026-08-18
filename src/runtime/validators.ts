import { childPath, indexPath } from './path.js';
import { createSafeRegex, isRegexSafe, testRegex } from './regex.js';
import { applyNodeTransform, type TransformFn } from './transform.js';

/** Controls unknown object keys only — not coercion. Use `from` for conversion. */
export type ValidationMode = 'strict' | 'relaxed' | 'strip';

export interface IValidationError {
    path    : string
    value   : any
    error   : string
    /** Nested failures (e.g. per-arm errors for a failed union). */
    issues? : IValidationError[]
}

/** Expected runtime kind for custom `from` — a dispatch tag, not `typeof` / a TS type. */
export type CoercionKind =
    | 'string' | 'number' | 'boolean' | 'bigint' | 'function' | 'symbol' | 'never'
    | 'Date' | 'RegExp' | 'Set' | 'Map' | 'Array' | 'Object' | 'instance'
    | 'null' | 'undefined' | 'tuple' | 'literal';

/** Shared context for `constraint.Custom` and custom `from` callbacks. */
export interface PathContext {
    /** Nearest named property; for `[n]` leaves, the closest named segment above. */
    key    : string
    path   : string
    parent : any
    root   : any
    /** Set when the leaf path segment is an array index. */
    index? : number
}

export type FromCoercionContext = PathContext & { kind : CoercionKind };

type FromOption = 'json' | 'query' | 'string' | (( val: any, ctx: FromCoercionContext ) => any );

export interface ValidationContext {
    success : boolean
    errors  : IValidationError[]
    mode    : ValidationMode
    from?   : FromOption
    mutate? : boolean
    root?   : any
    /**
     * Draft 2019-09 / 2020-12 annotation frame for the current instance location.
     * In-place applicators (`allOf`, `anyOf`, `oneOf`, `if`, `$ref`) merge into the
     * parent frame; nested property/item applications push a fresh frame.
     */
    annotations? : SchemaAnnotationFrame
    /** Dynamic scope bindings for `$dynamicAnchor` / `$dynamicRef` (and 2019-09 recursive). */
    dynamicAnchors? : Map<string, JsonSchema | boolean>[]
    /** Opt-in typed walk for `assert` / `validate`. Never set by `is` / `assertGuard`. */
    transform? : TransformFn | TransformFn[]
}

/** Evaluated properties / items collected for `unevaluatedProperties` / `unevaluatedItems`. */
export interface SchemaAnnotationFrame
{
    properties : Set<string>
    items      : Set<number>
    itemsAll   : boolean
}


/** Options for `is` / `isSchema`. Always mutate; no `mutate` / `errorFactory`. */
export interface GuardOptions {
    /**
     * Unknown-key policy for closed objects (default `'strict'`).
     * - `'strict'` — reject properties not in the type/schema
     * - `'relaxed'` — allow and keep unknown properties (does **not** coerce values)
     * - `'strip'` — drop unknown properties from the result (in place when mutating)
     *
     * Coercion / revival is controlled only by `from`, never by `mode`.
     */
    mode? : ValidationMode
    from? : FromOption
}

/** Options for `assertGuard` / `assertGuardSchema`. */
export interface AssertGuardOptions extends GuardOptions {
    errorFactory? : ( errors: IValidationError[]) => Error
}

/** Options for `validate` / `validateSchema`. */
export interface ValidationOptions extends GuardOptions {
    /** `true`: write in place while validating. `false` (default): allocate new containers. */
    mutate? : boolean
    /** Opt-in typed rewrite after revival / `transform.*` tags. Not used by `is` / `assertGuard`. */
    transform? : TransformFn | TransformFn[]
}

/** Options for `assert` / `assertSchema`. */
export interface AssertOptions extends ValidationOptions {
    errorFactory? : ( errors: IValidationError[]) => Error
}

/** JSON Schema `type` values supported by `compileSchema`. */
export type JsonSchemaType =
    | 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'array' | 'object';

/** `x-typescript-type` extensions emitted by `jsonSchema<T>()`. */
export type JsonSchemaTypescriptType =
    | 'Date' | 'RegExp' | 'bigint' | 'undefined' | 'Set' | 'Map' | 'Promise'
    | 'Uint8Array' | 'Uint16Array' | 'Uint32Array'
    | 'Int8Array' | 'Int16Array' | 'Int32Array'
    | 'Float32Array' | 'Float64Array'
    | 'ArrayBuffer' | 'SharedArrayBuffer' | 'DataView' | 'Buffer';

/**
 * Supported JSON Schema object subset (draft-07 / selected 2019-09+ / 2020-12 keywords)
 * plus `x-typescript-type` extensions.
 * Root boolean schemas (`true` / `false`) still work at runtime but are not part of this type.
 */
export type JsonSchema = JsonSchemaObject;

export interface JsonSchemaObject
{
    $schema?               : string
    $id?                   : string
    $defs?                 : Record<string, JsonSchema>
    definitions?           : Record<string, JsonSchema>
    $ref?                  : string
    type?                  : JsonSchemaType | JsonSchemaType[]
    const?                 : unknown
    enum?                  : unknown[]
    minLength?             : number
    maxLength?             : number
    pattern?               : string
    format?                : string
    minimum?               : number
    maximum?               : number
    exclusiveMinimum?      : number | boolean
    exclusiveMaximum?      : number | boolean
    multipleOf?            : number
    minProperties?         : number
    maxProperties?         : number
    items?                 : JsonSchema | boolean | ( JsonSchema | boolean )[]
    prefixItems?           : ( JsonSchema | boolean )[]
    additionalItems?       : boolean | JsonSchema
    minItems?              : number
    maxItems?              : number
    uniqueItems?           : boolean
    contains?              : JsonSchema | boolean
    minContains?           : number
    maxContains?           : number
    unevaluatedItems?      : boolean | JsonSchema
    properties?            : Record<string, JsonSchema | boolean>
    patternProperties?     : Record<string, JsonSchema | boolean>
    propertyNames?         : JsonSchema | boolean
    required?              : string[]
    additionalProperties?  : boolean | JsonSchema
    unevaluatedProperties? : boolean | JsonSchema
    dependencies?          : Record<string, string[] | JsonSchema | boolean>
    dependentRequired?     : Record<string, string[]>
    dependentSchemas?      : Record<string, JsonSchema | boolean>
    contentMediaType?      : string
    contentEncoding?       : string
    contentSchema?         : JsonSchema | boolean
    $anchor?               : string
    $dynamicAnchor?        : string
    $dynamicRef?           : string
    $recursiveAnchor?      : boolean | string
    $recursiveRef?         : string
    allOf?                 : ( JsonSchema | boolean )[]
    anyOf?                 : ( JsonSchema | boolean )[]
    oneOf?                 : ( JsonSchema | boolean )[]
    not?                   : JsonSchema | boolean
    if?                    : JsonSchema | boolean
    then?                  : JsonSchema | boolean
    else?                  : JsonSchema | boolean
    'x-typescript-type'?   : JsonSchemaTypescriptType
    key?                   : JsonSchema | boolean
    value?                 : JsonSchema | boolean
}

export type SchemaValidator = ( v: any, path: string, ctx: ValidationContext ) => any;

const report = ( ctx: ValidationContext, path: string, expected: string, value: any, message?: string ) => 
{
    ctx.success = false;
    ctx.errors.push({ path, value, error : message || expected });
};

/**
 * A value that object/record validators can treat as a property bag: anything we can read string
 * keys from. Prototype identity is irrelevant — `process.env`, class instances, and null-proto
 * objects are all fine. Known exotics (Date, Map, arrays, …) have dedicated validators instead.
 */
function isPlainObject( v: any ): boolean 
{
    if( v === null || typeof v !== 'object' || Array.isArray( v )) { return false }

    if( v instanceof Date || v instanceof RegExp || v instanceof Map || v instanceof Set ) { return false }

    if( typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer( v )) { return false }

    if( ArrayBuffer.isView( v ) || v instanceof ArrayBuffer ) { return false }

    return true;
}

function setOwnProperty( target: any, key: PropertyKey, value: any ): void
{
    if( key !== '__proto__' && key !== 'constructor' && key !== 'prototype' )
    {
        target[key] = value;

        return;
    }

    Object.defineProperty( target, key, {
        value,
        enumerable   : true,
        configurable : true,
        writable     : true
    });
}

function assignOwnProperties( target: any, source: any ): void
{
    for( const key of Object.keys( source ))
    {
        setOwnProperty( target, key, source[key]);
    }
}

function emptyAnnotations(): SchemaAnnotationFrame
{
    return { properties : new Set(), items : new Set(), itemsAll : false };
}

function ensureAnnotations( ctx: ValidationContext ): SchemaAnnotationFrame
{
    if( !ctx.annotations ){ ctx.annotations = emptyAnnotations() }

    return ctx.annotations;
}

function mergeAnnotations( target: SchemaAnnotationFrame, source?: SchemaAnnotationFrame ): void
{
    if( !source ){ return }

    for( const key of source.properties ){ target.properties.add( key ) }

    for( const index of source.items ){ target.items.add( index ) }

    if( source.itemsAll ){ target.itemsAll = true }
}

/** Run `check` on the same instance location; child annotations merge into the parent frame. */
function runInPlace(
    check: SchemaValidator,
    v: any,
    path: string,
    ctx: ValidationContext
): any
{
    const parent = ensureAnnotations( ctx );
    const child = emptyAnnotations();
    const prev = ctx.annotations;
    ctx.annotations = child;
    const result = check( v, path, ctx );
    mergeAnnotations( parent, ctx.annotations );
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
    const prev = ctx.annotations;
    ctx.annotations = emptyAnnotations();
    const result = check( v, path, ctx );
    ctx.annotations = prev;

    return result;
}

function markProperty( ctx: ValidationContext, key: string ): void
{
    ensureAnnotations( ctx ).properties.add( key );
}

function markItem( ctx: ValidationContext, index: number ): void
{
    ensureAnnotations( ctx ).items.add( index );
}

function markAllItems( ctx: ValidationContext ): void
{
    ensureAnnotations( ctx ).itemsAll = true;
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
        try
        {
            const standard = normalized === 'base64url'
                ? value.replace( /-/g, '+' ).replace( /_/g, '/' )
                : value;
            const buf = Buffer.from( standard, 'base64' );

            if( buf.length === 0 && value.length > 0 ){ return undefined }

            return buf;
        }
        catch
        {
            return undefined;
        }
    }

    if( normalized === '7bit' || normalized === '8bit' || normalized === 'binary' || normalized === 'quoted-printable' )
    {
        return value;
    }

    return undefined;
}

function keySetHas( keys: string[] | Set<string>, key: string ): boolean
{
    return keys instanceof Set ? keys.has( key ) : keys.includes( key );
}

function commitContainer( target: any, source: any ): boolean
{
    if( target === source ){ return true }

    if( Array.isArray( target ) && Array.isArray( source ))
    {
        target.length = source.length;

        for( let i = 0; i < source.length; i++ ){ target[i] = source[i] }

        return true;
    }

    if( target instanceof Set && source instanceof Set )
    {
        target.clear();

        for( const value of source ){ target.add( value ) }

        return true;
    }

    if( target instanceof Map && source instanceof Map )
    {
        target.clear();

        for( const [ key, value ] of source ){ target.set( key, value ) }

        return true;
    }

    if( isPlainObject( target ) && isPlainObject( source ))
    {
        for( const key of Object.keys( target ))
        {
            if( !Object.hasOwn( source, key )){ delete target[key] }
        }

        for( const key of Object.keys( source ))
        {
            if( !Object.hasOwn( target, key ) || target[key] !== source[key])
            {
                setOwnProperty( target, key, source[key]);
            }
        }

        return true;
    }

    return false;
}

function isMultipleOfNumber( v: number, n: number ): boolean 
{
    if( n === 0 || !Number.isFinite( n )) { return false }

    if( !Number.isFinite( v )) { return true }

    const q = v / n;

    return Math.abs( q - Math.round( q )) <= 1e-8 * Math.max( 1, Math.abs( q ));
}

function shouldMutate( ctx: ValidationContext ): boolean 
{
    return ctx.mutate === true;
}

/** Query-style coercions — shared by `from: 'query'` and `from: 'string'`. */
function wantsQuery( ctx: ValidationContext ): boolean
{
    return ctx.from === 'query' || ctx.from === 'string';
}

function wantsJsonRevive( ctx: ValidationContext ): boolean
{
    return ctx.from === 'json' || ctx.from === 'query' || ctx.from === 'string';
}

function isIndexSegment( seg: string ): boolean
{
    return seg.startsWith( '[' ) && seg.endsWith( ']' );
}

function pathContext( path: string, ctx: ValidationContext ): PathContext
{
    const pathParts = tokenizePath( path );
    const parentPath = joinPathSegments( pathParts.slice( 0, -1 ));
    const parent = getValueAtPath( ctx.root, parentPath );
    const last = pathParts[pathParts.length - 1];
    let index: number | undefined;

    if( last && isIndexSegment( last ))
    {
        const parsed = parseInt( last.slice( 1, -1 ), 10 );

        if( !Number.isNaN( parsed )){ index = parsed }
    }

    let key = '';

    for( let i = pathParts.length - 1; i >= 0; i-- )
    {
        if( !isIndexSegment( pathParts[i]))
        {
            key = pathParts[i];
            break;
        }
    }

    if( index === undefined ){ return { key, path, parent, root : ctx.root } }

    return { key, path, parent, root : ctx.root, index };
}

function fromCustom( ctx: ValidationContext, path: string, value: any, kind: CoercionKind ): any
{
    return ( ctx.from as ( val: any, c: FromCoercionContext ) => any )( value, { ...pathContext( path, ctx ), kind });
}

/** True when `s` is a finite decimal / scientific literal (linear scan, no ReDoS). */
function isCoercibleQueryNumberString( s: string ): boolean
{
    let i = 0;

    if( s[i] === '+' || s[i] === '-' ){ i++ }

    const start = i;
    let sawDigit = false;
    let sawDot = false;

    while( i < s.length )
    {
        const ch = s.charCodeAt( i );

        if( ch >= 48 && ch <= 57 )
        {
            sawDigit = true;
            i++;
            continue;
        }

        if( ch === 46 && !sawDot )
        {
            sawDot = true;
            i++;
            continue;
        }

        break;
    }

    if( !sawDigit || i === start ){ return false }

    if( i < s.length && ( s[i] === 'e' || s[i] === 'E' ))
    {
        i++;

        if( s[i] === '+' || s[i] === '-' ){ i++ }

        const expStart = i;

        while( i < s.length )
        {
            const ch = s.charCodeAt( i );

            if( ch < 48 || ch > 57 ){ break }

            i++;
        }

        if( i === expStart ){ return false }
    }

    return i === s.length;
}

/** Query-style number coercion — shared by `from: 'query'` and `transform.ToNumber`. */
export function coerceQueryNumber( v: any ): any
{
    if( typeof v === 'number' ){ return v }

    if( typeof v === 'string' && v.trim() !== '' )
    {
        const normalized = v.trim();

        if( !isCoercibleQueryNumberString( normalized )){ return v }

        const parsed = Number( normalized );

        if( Number.isFinite( parsed )){ return parsed }
    }

    return v;
}

/** Query-style boolean coercion — shared by `from: 'query'` and `transform.ToBoolean`. */
export function coerceQueryBoolean( v: any ): any
{
    if( typeof v === 'boolean' ){ return v }

    if( typeof v === 'string' || typeof v === 'number' )
    {
        const s = String( v ).toLowerCase();

        if( s === 'true' || s === '1' || s === 'yes' || s === 'on' ){ return true }

        if( s === 'false' || s === '0' || s === 'no' || s === 'off' ){ return false }
    }

    return v;
}

/** JSON-wire Date revival (ISO / date-parseable strings only). */
export function coerceJsonDate( v: any ): any
{
    if( v instanceof Date && !Number.isNaN( v.getTime())){ return v }

    if( typeof v === 'string' )
    {
        const parsed = new Date( v );

        if( !Number.isNaN( parsed.getTime())){ return parsed }
    }

    return v;
}

/** Query-style Date coercion — shared by `from: 'query'` and `transform.ToDate`. */
export function coerceQueryDate( v: any ): any
{
    const fromJson = coerceJsonDate( v );

    if( fromJson !== v ){ return fromJson }

    if( v instanceof Date && !Number.isNaN( v.getTime())){ return v }

    if( typeof v === 'number' && Number.isFinite( v ))
    {
        const parsed = new Date( v );

        if( !Number.isNaN( parsed.getTime())){ return parsed }
    }

    return v;
}

const EMAIL_LOCAL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_DOMAIN_RE = /^(?=.{1,253}$)(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$/i;
const IDN_EMAIL_LOCAL_RE = /^[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+$/u;
const IDN_EMAIL_DOMAIN_RE = /^(?=.{1,253}$)(?:(?!-)[\p{L}\p{N}-]{1,63}(?<!-)\.)+[\p{L}]{2,63}$/u;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:localhost|(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63})$/i;
const IDN_HOSTNAME_RE = /^(?=.{1,253}$)(?:localhost|(?:(?!-)[\p{L}\p{N}-]{1,63}(?<!-)\.)+[\p{L}]{2,63})$/iu;
const URI_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>"{}|\\^`]*$/;
const IRI_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/u;
const URI_TEMPLATE_RE = /^(?:[^{}\s]|\{[+#./;?&=,!@|]?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*(?::[1-9]\d{0,3}|\*)?(?:,(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*(?::[1-9]\d{0,3}|\*)?)*\})+$/;

function isEmail( value: string ): boolean 
{
    if( value.length > 254 ){ return false }

    const at = value.lastIndexOf( '@' );

    if( at < 1 || at !== value.indexOf( '@' ) || at === value.length - 1 ){ return false }

    const local = value.slice( 0, at );
    const domain = value.slice( at + 1 );

    if( local.length > 64 ){ return false }

    if( local.startsWith( '.' ) || local.endsWith( '.' ) || local.includes( '..' )){ return false }

    if( !EMAIL_LOCAL_RE.test( local )){ return false }

    if( !EMAIL_DOMAIN_RE.test( domain )){ return false }

    return true;
}

function isIdnEmail( value: string ): boolean 
{
    if( value.length > 254 ){ return false }

    const at = value.lastIndexOf( '@' );

    if( at < 1 || at !== value.indexOf( '@' ) || at === value.length - 1 ){ return false }

    const local = value.slice( 0, at );
    const domain = value.slice( at + 1 );

    if( local.length > 64 ){ return false }

    if( local.startsWith( '.' ) || local.endsWith( '.' ) || local.includes( '..' )){ return false }

    if( !IDN_EMAIL_LOCAL_RE.test( local )){ return false }

    if( !IDN_EMAIL_DOMAIN_RE.test( domain )){ return false }

    return true;
}

function isHostname( value: string ): boolean 
{
    return HOSTNAME_RE.test( value );
}

function isIdnHostname( value: string ): boolean 
{
    return IDN_HOSTNAME_RE.test( value );
}

function isUri( value: string ): boolean 
{
    if( !URI_RE.test( value )){ return false }

    try 
    {
        new URL( value );

        return true;
    }
    catch 
    {
        // mailto:, urn:, and some other schemes are valid URIs but may throw in URL()
        return /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>"{}|\\^`]+$/.test( value );
    }
}

function isUriReference( value: string ): boolean 
{
    if( value === '' ){ return true }

    if( isUri( value )){ return true }

    if( /[\s<>"{}|\\^`]/.test( value )){ return false }

    try 
    {
        new URL( value, 'http://example.com' );

        return true;
    }
    catch 
    {
        return false;
    }
}

function isIri( value: string ): boolean 
{
    if( !IRI_RE.test( value )){ return false }

    if( /[\u0000-\u001F\u007F]/.test( value )){ return false }

    try 
    {
        new URL( value );

        return true;
    }
    catch 
    {
        return /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/u.test( value );
    }
}

function isIriReference( value: string ): boolean 
{
    if( value === '' ){ return true }

    if( isIri( value )){ return true }

    if( /\s|[\u0000-\u001F\u007F]/.test( value )){ return false }

    try 
    {
        new URL( value, 'http://example.com' );

        return true;
    }
    catch 
    {
        return /^[^<>"{}|\\^`]+$/u.test( value );
    }
}

function isUriTemplate( value: string ): boolean 
{
    if( !value || /\s/.test( value )){ return false }

    let depth = 0;

    for( const ch of value ) 
    {
        if( ch === '{' ){ depth++ }
        else if( ch === '}' ) 
        {
            if( depth === 0 ){ return false }
            depth--;
        }
    }

    if( depth !== 0 ){ return false }

    return URI_TEMPLATE_RE.test( value );
}

function parseFormatDate( value: string ): Date | undefined 
{
    const match = value.match( /^(\d{4})-(\d{2})-(\d{2})$/ );

    if( !match ){ return undefined }

    const year = Number( match[1]);
    const month = Number( match[2]);
    const day = Number( match[3]);
    const parsed = new Date( 0 );

    parsed.setUTCHours( 0, 0, 0, 0 );
    parsed.setUTCFullYear( year, month - 1, day );

    if( parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day )
    {
        return undefined;
    }

    return parsed;
}

function parseFormatDateTime( value: string ): Date | undefined 
{
    if( !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test( value ))
    {
        return undefined;
    }

    if( !parseFormatDate( value.slice( 0, 10 ))){ return undefined }

    const parsed = new Date( value );

    if( Number.isNaN( parsed.getTime())){ return undefined }

    return parsed;
}

function deepEqual( left: any, right: any, seen: WeakMap<object, WeakSet<object>> = new WeakMap()): boolean
{
    if( left === right ){ return true }

    if( left === null || right === null || typeof left !== 'object' || typeof right !== 'object' )
    {
        return false;
    }

    const seenRight = seen.get( left );

    if( seenRight?.has( right )){ return true }

    if( seenRight ){ seenRight.add( right ) }
    else { seen.set( left, new WeakSet([right])) }

    if( Array.isArray( left ) || Array.isArray( right ))
    {
        if( !Array.isArray( left ) || !Array.isArray( right ) || left.length !== right.length ){ return false }

        for( let i = 0; i < left.length; i++ )
        {
            if( !deepEqual( left[i], right[i], seen )){ return false }
        }

        return true;
    }

    if( left instanceof Date || right instanceof Date )
    {
        return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
    }

    if( left instanceof RegExp || right instanceof RegExp )
    {
        return left instanceof RegExp &&
            right instanceof RegExp &&
            left.source === right.source &&
            left.flags === right.flags;
    }

    if( left instanceof Set || right instanceof Set )
    {
        if( !( left instanceof Set ) || !( right instanceof Set ) || left.size !== right.size ){ return false }

        const unmatched = [ ...right ];

        for( const value of left )
        {
            const index = unmatched.findIndex( candidate => deepEqual( value, candidate ));

            if( index === -1 ){ return false }

            unmatched.splice( index, 1 );
        }

        return true;
    }

    if( left instanceof Map || right instanceof Map )
    {
        if( !( left instanceof Map ) || !( right instanceof Map ) || left.size !== right.size ){ return false }

        const unmatched = [ ...right.entries() ];

        for( const [ key, value ] of left )
        {
            const index = unmatched.findIndex(([ candidateKey, candidateValue ]) =>
                deepEqual( key, candidateKey ) && deepEqual( value, candidateValue )
            );

            if( index === -1 ){ return false }

            unmatched.splice( index, 1 );
        }

        return true;
    }

    const leftKeys = Object.keys( left ).sort();
    const rightKeys = Object.keys( right ).sort();

    if( leftKeys.length !== rightKeys.length ){ return false }

    for( let i = 0; i < leftKeys.length; i++ )
    {
        const key = leftKeys[i];

        if( key !== rightKeys[i] || !deepEqual( left[key], right[key], seen )){ return false }
    }

    return true;
}

function mixHash( h: number, part: number ): number
{
    return Math.imul( h ^ ( part >>> 0 ), 16777619 );
}

function mixStringHash( h: number, value: string ): number
{
    const len = value.length;
    h = mixHash( h, len );

    // Fast paths for short property names / small strings.
    if( len === 1 ){ return mixHash( h, value.charCodeAt( 0 )) }

    if( len === 2 )
    {
        return mixHash( mixHash( h, value.charCodeAt( 0 )), value.charCodeAt( 1 ));
    }

    if( len === 3 )
    {
        h = mixHash( h, value.charCodeAt( 0 ));
        h = mixHash( h, value.charCodeAt( 1 ));

        return mixHash( h, value.charCodeAt( 2 ));
    }

    for( let i = 0; i < len; i++ )
    {
        h = mixHash( h, value.charCodeAt( i ));
    }

    return h;
}

const uniqueFloat64Buf = new ArrayBuffer( 8 );
const uniqueFloat64View = new Float64Array( uniqueFloat64Buf );
const uniqueFloat64Words = new Int32Array( uniqueFloat64Buf );

function mixNumberHash( h: number, value: number ): number
{
    if( Object.is( value, -0 )){ return mixHash( h, 0x30000001 ) }

    if( Number.isNaN( value )){ return mixHash( h, 0x30000002 ) }

    if( value === Infinity ){ return mixHash( h, 0x30000003 ) }

    if( value === -Infinity ){ return mixHash( h, 0x30000004 ) }

    uniqueFloat64View[0] = value;

    return mixHash( mixHash( h, uniqueFloat64Words[0]), uniqueFloat64Words[1]);
}

/**
 * Order-independent content hash for plain objects / arrays.
 * Returns `undefined` for cycles and non-plain values (caller uses deepEqual list).
 * Collisions are resolved with `deepEqual`.
 */
function uniqueContentHash( value: any, seen?: WeakSet<object> ): number | undefined
{
    if( value === null ){ return 0x10000001 }

    if( value === undefined ){ return 0x10000002 }

    const type = typeof value;

    if( type === 'string' ){ return mixStringHash( 0x20000000, value ) >>> 0 }

    if( type === 'number' ){ return mixNumberHash( 0x30000000, value ) >>> 0 }

    if( type === 'boolean' ){ return value ? 0x40000001 : 0x40000002 }

    if( type === 'bigint' )
    {
        // Split into 32-bit limbs — avoids string alloc for common small bigints.
        let h = 0x50000000;
        let n = value < 0n ? -value : value;

        if( value < 0n ){ h = mixHash( h, 1 ) }

        while( n > 0n )
        {
            h = mixHash( h, Number( n & 0xffffffffn ));
            n >>= 32n;
        }

        return h >>> 0;
    }

    if( type !== 'object' ){ return undefined }

    if( value instanceof Date ){ return mixNumberHash( 0x60000000, value.getTime()) >>> 0 }

    if( value instanceof RegExp ){ return mixStringHash( 0x70000000, `${value.source}/${value.flags}` ) >>> 0 }

    if( value instanceof Map || value instanceof Set || ArrayBuffer.isView( value ) || value instanceof ArrayBuffer )
    {
        return undefined;
    }

    if( seen?.has( value )){ return undefined }

    if( Array.isArray( value ))
    {
        const cycleSet = seen ?? new WeakSet<object>();
        cycleSet.add( value );
        let h = mixHash( 0x80000000, value.length );

        for( let i = 0; i < value.length; i++ )
        {
            const child = uniqueContentHash( value[i], cycleSet );

            if( child === undefined ){ return undefined }

            h = mixHash( h, child );
        }

        return h >>> 0;
    }

    const proto = Object.getPrototypeOf( value );

    if( proto !== Object.prototype && proto !== null ){ return undefined }

    const keys = Object.keys( value );
    const keyCount = keys.length;

    if( keyCount > 1 )
    {
        // Avoid Array#sort when already ordered (common for same-shape rows).
        let ordered = true;

        for( let i = 1; i < keyCount; i++ )
        {
            if( keys[i] < keys[i - 1])
            {
                ordered = false;
                break;
            }
        }

        if( !ordered ){ keys.sort() }
    }

    let cycleSet = seen;
    let h = mixHash( 0x90000000, keyCount );

    for( let i = 0; i < keyCount; i++ )
    {
        const key = keys[i];
        const childValue = value[key];
        h = mixStringHash( h, key );

        if( childValue !== null && typeof childValue === 'object' )
        {
            cycleSet ??= new WeakSet<object>();
            cycleSet.add( value );
        }

        const child = uniqueContentHash( childValue, cycleSet );

        if( child === undefined ){ return undefined }

        h = mixHash( h, child );
    }

    return h >>> 0;
}

export const validators = {
    coerceQueryNumber,
    coerceQueryBoolean,
    coerceQueryDate,
    coerceJsonDate,
    applyOptionTransform : ( v: any, path: string, ctx: ValidationContext, tags: string[], kind: CoercionKind ) =>
    {
        if( !ctx.transform || v === undefined || v === null ){ return v }

        try
        {
            return applyNodeTransform( v, path, ctx.transform, kind, tags, ctx.root );
        }
        catch( e )
        {
            report( ctx, path, e instanceof Error ? e.message : String( e ), v );

            return v;
        }
    },
    safeRegExp : createSafeRegex,
    assign     : ( target: any, source: any ) =>
    {
        assignOwnProperties( target, source );

        return target;
    },

    string : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v === 'string' ){ return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'string' );

            if( typeof converted === 'string' ){ return converted }
        }

        report( ctx, path, 'Type<string>', v );

        return v;
    },

    number : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( wantsQuery( ctx )){ v = coerceQueryNumber( v ) }

        if( typeof v === 'number' ) 
        {
            if( Number.isNaN( v )) 
            {
                report( ctx, path, 'Type<number>', v );
            }

            return v;
        }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'number' );

            if( typeof converted === 'number' && !Number.isNaN( converted )){ return converted }
        }

        report( ctx, path, 'Type<number>', v );

        return v;
    },

    bigint : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v === 'bigint' ){ return v }

        if( wantsJsonRevive( ctx ) && typeof v === 'string' && v.trim() !== '' ) 
        {
            try 
            {
                return BigInt( v );
            }
            catch ( e ) { /* ignore */ }
        }

        if( wantsQuery( ctx ) && typeof v === 'number' && Number.isFinite( v ) && Number.isInteger( v )) 
        {
            try 
            {
                return BigInt( v );
            }
            catch ( e ) { /* ignore */ }
        }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'bigint' );

            if( typeof converted === 'bigint' ){ return converted }
        }

        report( ctx, path, 'Type<bigint>', v );

        return v;
    },

    boolean : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( wantsQuery( ctx )){ v = coerceQueryBoolean( v ) }

        if( typeof v === 'boolean' ){ return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'boolean' );

            if( typeof converted === 'boolean' ){ return converted }
        }

        report( ctx, path, 'Type<boolean>', v );

        return v;
    },

    function : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v === 'function' ){ return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'function' );

            if( typeof converted === 'function' ){ return converted }
        }

        report( ctx, path, 'Type<function>', v );

        return v;
    },

    date : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( wantsQuery( ctx )){ v = coerceQueryDate( v ) }
        else if( ctx.from === 'json' ){ v = coerceJsonDate( v ) }

        if( v instanceof Date && !Number.isNaN( v.getTime())) { return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'Date' );

            if( converted instanceof Date && !Number.isNaN( converted.getTime())){ return converted }
        }

        report( ctx, path, 'Type<Date>', v );

        return v;
    },

    regexp : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( v instanceof RegExp ) { return v }

        if( wantsJsonRevive( ctx ))
        {
            if( typeof v === 'string' ) 
            {
                const match = v.match( /^\/(.*)\/([gimuy]*)$/ );

                if( match ) 
                {
                    try 
                    {
                        return new RegExp( match[1], match[2]);
                    }
                    catch ( e ) { /* fall through */ }
                }
                else if( wantsQuery( ctx )) 
                {
                    try 
                    {
                        return new RegExp( v );
                    }
                    catch ( e ) { /* fall through */ }
                }
            }

            if( v && typeof v === 'object' && typeof v.source === 'string' ) 
            {
                try 
                {
                    return new RegExp( v.source, typeof v.flags === 'string' ? v.flags : '' );
                }
                catch ( e ) { /* fall through */ }
            }
        }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'RegExp' );

            if( converted instanceof RegExp ){ return converted }
        }

        report( ctx, path, 'Type<RegExp>', v );

        return v;
    },

    null : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( v === null ){ return null }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'null' );

            if( converted === null ){ return null }
        }

        report( ctx, path, 'Type<null>', v );

        return null;
    },

    undefined : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( v === undefined ){ return undefined }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'undefined' );

            if( converted === undefined ){ return undefined }
        }

        report( ctx, path, 'Type<undefined>', v );

        return undefined;
    },

    literal : ( v: any, path: string, ctx: ValidationContext, expected: any ) => 
    {
        if( v === expected ){ return v }

        if( wantsQuery( ctx )) 
        {
            if( typeof expected === 'number' ) 
            {
                const p = coerceQueryNumber( v );

                if( p === expected ) { return p }
            }

            if( typeof expected === 'boolean' ) 
            {
                const val = coerceQueryBoolean( v );

                if( val === expected ) { return val }
            }
        }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'literal' );

            if( converted === expected ){ return converted }
        }

        const expStr = typeof expected === 'string' ? `'${expected}'` : expected;
        report( ctx, path, `Literal<${expStr}>`, v );

        return v;
    },

    array : ( v: any, path: string, ctx: ValidationContext, childValidator: Function ) => 
    {
        if( !Array.isArray( v )) 
        {
            if( wantsQuery( ctx ) && v !== undefined && v !== null ) 
            {
                v = [v];
            }
            else if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'Array' );

                if( Array.isArray( converted )){ v = converted }
                else 
                {
                    report( ctx, path, 'Type<Array>', v );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, 'Type<Array>', v );

                return v;
            }
        }

        if( shouldMutate( ctx ))
        {
            for( let i = 0; i < v.length; i++ )
            {
                v[i] = childValidator( v[i], indexPath( path, i ), ctx );
            }

            return v;
        }

        const data: any[] = [];

        for( let i = 0; i < v.length; i++ )
        {
            data[i] = childValidator( v[i], indexPath( path, i ), ctx );
        }

        return data;
    },

    props : ( v: any, data: any, path: string, ctx: ValidationContext, props: [string, boolean, Function, boolean?][]) => 
    {
        for( const [key, isOptional, validator, hasDefault] of props ) 
        {
            const val = v[key];

            // An absent optional property stays absent. Running its `T | undefined` validator would cost
            // a union attempt and then write the key back as an explicit `undefined`. A Defaulted
            // optional must still run — and if the filled default fails a constraint, that error
            // must stick (there is no silent rollback here).
            if( isOptional && val === undefined && !hasDefault ){ continue }

            const result = validator( val, childPath( path, key ), ctx );

            if( ctx.success )
            {
                setOwnProperty( data, key, result );
            }
        }
    },

    objectShell : ( v: any, ctx: ValidationContext, closed?: boolean ) => 
    {
        if( shouldMutate( ctx )) { return v }

        if( !isPlainObject( v )) { return v }

        if( ctx.mode === 'strip' ) { return {} }

        // A closed shape writes back every key it keeps, so copying the input first is wasted work.
        // Only `relaxed` needs the copy, being the one mode where an unknown key is kept as-is.
        if( closed && ctx.mode !== 'relaxed' ) { return {} }

        return { ...v };
    },

    stripExtras : ( data: any, ctx: ValidationContext, allowedKeys?: string[] | Set<string> ) => 
    {
        if( !shouldMutate( ctx ) || ctx.mode !== 'strip' || !allowedKeys || !data || typeof data !== 'object' ) { return data }

        for( const k of Object.keys( data )) 
        {
            if( !keySetHas( allowedKeys, k )) { delete data[k] }
        }

        return data;
    },

    additionalProps : ( v: any, data: any, path: string, ctx: ValidationContext, knownKeys: string[] | Set<string>, childValidator: Function ) => 
    {
        if( !isPlainObject( v )){ return }

        for( const key of Object.keys( v )) 
        {
            if( keySetHas( knownKeys, key )){ continue }

            setOwnProperty( data, key, childValidator( v[key], childPath( path, key ), ctx ));
        }
    },

    object : ( v: any, path: string, ctx: ValidationContext, allowedKeys?: string[] | Set<string>, expected: string = 'Type<Object>' ) => 
    {
        if( !isPlainObject( v )) 
        {
            if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'Object' );

                if( isPlainObject( converted )){ v = converted }
                else 
                {
                    report( ctx, path, expected, v );

                    return false;
                }
            }
            else 
            {
                report( ctx, path, expected, v );

                return false;
            }
        }

        if( ctx.mode === 'strict' && allowedKeys ) 
        {
            for( const k of Object.keys( v )) 
            {
                if( !keySetHas( allowedKeys, k )) 
                {
                    report( ctx, path, `PropertyNotAllowed<${k}>`, v[k]);
                }
            }
        }

        return v;
    },

    templateLiteral : ( v: any, path: string, ctx: ValidationContext, regex: RegExp, expected: string ) => 
    {
        if( typeof v !== 'string' || !testRegex( regex, v )) 
        {
            report( ctx, path, expected, v );
        }

        return v;
    },

    minLength : ( v: string, path: string, ctx: ValidationContext, min: number, message?: string ) => 
    {
        if( v.length < min ) { report( ctx, path, `MinLength<${min}>`, v, message ) }

        return v;
    },

    maxLength : ( v: string, path: string, ctx: ValidationContext, max: number, message?: string ) => 
    {
        if( v.length > max ) { report( ctx, path, `MaxLength<${max}>`, v, message ) }

        return v;
    },

    minimum : ( v: number | bigint, path: string, ctx: ValidationContext, min: number | bigint, message?: string ) => 
    {
        if( v < min ) { report( ctx, path, `Minimum<${min}>`, v, message ) }

        return v;
    },

    maximum : ( v: number | bigint, path: string, ctx: ValidationContext, max: number | bigint, message?: string ) => 
    {
        if( v > max ) { report( ctx, path, `Maximum<${max}>`, v, message ) }

        return v;
    },

    exclusiveMinimum : ( v: number | bigint, path: string, ctx: ValidationContext, min: number | bigint, message?: string ) => 
    {
        if( v <= min ) { report( ctx, path, `ExclusiveMinimum<${min}>`, v, message ) }

        return v;
    },

    exclusiveMaximum : ( v: number | bigint, path: string, ctx: ValidationContext, max: number | bigint, message?: string ) => 
    {
        if( v >= max ) { report( ctx, path, `ExclusiveMaximum<${max}>`, v, message ) }

        return v;
    },

    multipleOf : ( v: number | bigint, path: string, ctx: ValidationContext, n: number | bigint, message?: string ) => 
    {
        if( typeof v === 'bigint' || typeof n === 'bigint' ) 
        {
            try
            {
                const divisor = BigInt( n );

                if( divisor === 0n || BigInt( v ) % divisor !== 0n )
                {
                    report( ctx, path, `MultipleOf<${n}>`, v, message );
                }
            }
            catch
            {
                report( ctx, path, `MultipleOf<${n}>`, v, message );
            }
        }
        else if( !isMultipleOfNumber( v, n )) 
        {
            report( ctx, path, `MultipleOf<${n}>`, v, message );
        }

        return v;
    },

    pattern : ( v: string, path: string, ctx: ValidationContext, regex: RegExp, expected: string, message?: string ) => 
    {
        if( !isRegexSafe( regex ))
        {
            report( ctx, path, 'UnsafePattern', v, message );

            return v;
        }

        if( !testRegex( regex, v )) { report( ctx, path, expected, v, message ) }

        return v;
    },

    format : ( v: string, path: string, ctx: ValidationContext, format: string, message?: string ) => 
    {
        let regex: RegExp | undefined;
        let isValid = true;
        let result: any = v;

        switch ( format ) 
        {
            case 'email': isValid = isEmail( v ); break;
            case 'idn-email': isValid = isIdnEmail( v ); break;
            // Versions 1-8 plus the nil UUID; a version nibble of 1-5 rejects v6 and v7.
            case 'uuid': regex = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i; break;
            case 'url': regex = /^(?:https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i; break;
            case 'ipv4': regex = /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/; break;
            case 'ipv6': regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/; break;
            case 'date': 
            {
                const parsed = parseFormatDate( v );

                if( !parsed ){ isValid = false }
                else if( wantsQuery( ctx )){ result = parsed }
                break;
            }
            case 'date-time': 
            {
                const parsed = parseFormatDateTime( v );

                if( !parsed ){ isValid = false }
                else if( wantsQuery( ctx )){ result = parsed }
                break;
            }

            case 'byte': regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/; break;
            case 'password': break; // Anything is a password
            case 'regex': try { createSafeRegex( v ) }
            catch{ isValid = false }; break;
            case 'hostname': isValid = isHostname( v ); break;
            case 'idn-hostname': isValid = isIdnHostname( v ); break;
            case 'uri': isValid = isUri( v ); break;
            case 'uri-reference': isValid = isUriReference( v ); break;
            case 'iri': isValid = isIri( v ); break;
            case 'iri-reference': isValid = isIriReference( v ); break;
            case 'uri-template': isValid = isUriTemplate( v ); break;
            case 'time': regex = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[zZ]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/; break;
            case 'duration': regex = /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/; break;
            case 'objectId': regex = /^[0-9a-fA-F]{24}$/; break;
            default: isValid = false; break;
        }

        if( regex && !testRegex( regex, v )) { isValid = false }

        if( !isValid ) { report( ctx, path, `Format<${format}>`, v, message ) }

        return result;
    },

    minItems : ( v: any[], path: string, ctx: ValidationContext, min: number, message?: string ) => 
    {
        if( v.length < min ) { report( ctx, path, `MinItems<${min}>`, v, message ) }

        return v;
    },

    maxItems : ( v: any[], path: string, ctx: ValidationContext, max: number, message?: string ) => 
    {
        if( v.length > max ) { report( ctx, path, `MaxItems<${max}>`, v, message ) }

        return v;
    },

    minProperties : ( v: any, path: string, ctx: ValidationContext, min: number, message?: string ) =>
    {
        if( isPlainObject( v ) && Object.keys( v ).length < min )
        {
            report( ctx, path, `MinProperties<${min}>`, v, message );
        }

        return v;
    },

    maxProperties : ( v: any, path: string, ctx: ValidationContext, max: number, message?: string ) =>
    {
        if( isPlainObject( v ) && Object.keys( v ).length > max )
        {
            report( ctx, path, `MaxProperties<${max}>`, v, message );
        }

        return v;
    },

    contains : (
        v           : any,
        path        : string,
        ctx         : ValidationContext,
        itemCheck   : SchemaValidator,
        minContains : number = 1,
        maxContains?: number,
        message?    : string
    ) =>
    {
        if( !Array.isArray( v )){ return v }

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
            itemCheck( v[i], indexPath( path, i ), probe );

            if( probe.success ){ count++ }
        }

        if( count < minContains )
        {
            report( ctx, path, `Contains<min:${minContains}>`, v, message );
        }

        if( maxContains !== undefined && count > maxContains )
        {
            report( ctx, path, `Contains<max:${maxContains}>`, v, message );
        }

        return v;
    },

    propertyNames : (
        v        : any,
        path     : string,
        ctx      : ValidationContext,
        keyCheck : SchemaValidator,
        message? : string
    ) =>
    {
        if( !isPlainObject( v )){ return v }

        for( const key of Object.keys( v ))
        {
            const keyPath = childPath( path, key );
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
            keyCheck( key, keyPath, probe );

            if( !probe.success )
            {
                const nested = probe.errors[0]?.error || 'PropertyNames';
                report( ctx, keyPath, nested, key, message );
            }
        }

        return v;
    },

    uniqueItems : ( v: any[], path: string, ctx: ValidationContext, message?: string ) => 
    {
        // Typed scalar sets avoid per-item string encoding (SameValueZero for numbers,
        // with an explicit -0 flag because Set collapses -0 with 0).
        let seenStrings: Set<string> | undefined;
        let seenNumbers: Set<number> | undefined;
        let seenBigints: Set<bigint> | undefined;
        let seenDates: Set<number> | undefined;
        let seenRegex: Set<string> | undefined;
        let seenNull = false;
        let seenUndefined = false;
        let seenTrue = false;
        let seenFalse = false;
        let seenNegZero = false;
        // First item per hash; collision buckets allocated only when a hash repeats.
        const firstByHash = new Map<number, any>();
        const collisionBuckets = new Map<number, any[]>();
        const complex: any[] = [];

        for( let i = 0; i < v.length; i++ )
        {
            const item = v[i];

            if( item === null )
            {
                if( seenNull )
                {
                    report( ctx, path, 'UniqueItems', v, message );

                    return v;
                }

                seenNull = true;
                continue;
            }

            if( item === undefined )
            {
                if( seenUndefined )
                {
                    report( ctx, path, 'UniqueItems', v, message );

                    return v;
                }

                seenUndefined = true;
                continue;
            }

            const type = typeof item;

            if( type === 'string' )
            {
                seenStrings ??= new Set();

                if( seenStrings.has( item ))
                {
                    report( ctx, path, 'UniqueItems', v, message );

                    return v;
                }

                seenStrings.add( item );
                continue;
            }

            if( type === 'number' )
            {
                if( Object.is( item, -0 ))
                {
                    if( seenNegZero )
                    {
                        report( ctx, path, 'UniqueItems', v, message );

                        return v;
                    }

                    seenNegZero = true;
                    continue;
                }

                seenNumbers ??= new Set();

                if( seenNumbers.has( item ))
                {
                    report( ctx, path, 'UniqueItems', v, message );

                    return v;
                }

                seenNumbers.add( item );
                continue;
            }

            if( type === 'boolean' )
            {
                if( item )
                {
                    if( seenTrue )
                    {
                        report( ctx, path, 'UniqueItems', v, message );

                        return v;
                    }

                    seenTrue = true;
                }
                else
                {
                    if( seenFalse )
                    {
                        report( ctx, path, 'UniqueItems', v, message );

                        return v;
                    }

                    seenFalse = true;
                }

                continue;
            }

            if( type === 'bigint' )
            {
                seenBigints ??= new Set();

                if( seenBigints.has( item ))
                {
                    report( ctx, path, 'UniqueItems', v, message );

                    return v;
                }

                seenBigints.add( item );
                continue;
            }

            if( type === 'object' )
            {
                if( item instanceof Date )
                {
                    const time = item.getTime();
                    seenDates ??= new Set();

                    if( seenDates.has( time ))
                    {
                        report( ctx, path, 'UniqueItems', v, message );

                        return v;
                    }

                    seenDates.add( time );
                    continue;
                }

                if( item instanceof RegExp )
                {
                    const key = `${item.source}/${item.flags}`;
                    seenRegex ??= new Set();

                    if( seenRegex.has( key ))
                    {
                        report( ctx, path, 'UniqueItems', v, message );

                        return v;
                    }

                    seenRegex.add( key );
                    continue;
                }

                const hash = uniqueContentHash( item );

                if( hash !== undefined )
                {
                    const first = firstByHash.get( hash );

                    if( first === undefined )
                    {
                        firstByHash.set( hash, item );
                        continue;
                    }

                    const bucket = collisionBuckets.get( hash );

                    if( !bucket )
                    {
                        if( deepEqual( item, first ))
                        {
                            report( ctx, path, 'UniqueItems', v, message );

                            return v;
                        }

                        collisionBuckets.set( hash, [first, item]);
                        continue;
                    }

                    for( let j = 0; j < bucket.length; j++ )
                    {
                        if( deepEqual( item, bucket[j]))
                        {
                            report( ctx, path, 'UniqueItems', v, message );

                            return v;
                        }
                    }

                    bucket.push( item );
                    continue;
                }
            }

            for( let j = 0; j < complex.length; j++ )
            {
                if( deepEqual( item, complex[j]))
                {
                    report( ctx, path, 'UniqueItems', v, message );

                    return v;
                }
            }

            complex.push( item );
        }

        return v;
    },

    custom : ( v: any, path: string, ctx: ValidationContext, fn: Function, message?: string ) => 
    {
        if( !fn( v, pathContext( path, ctx ))) 
        {
            report( ctx, path, fn.name ? `Custom<${fn.name}>` : 'Custom', v, message );
        }

        return v;
    },


    /**
     * `T | undefined`. With one real arm there is nothing to search, so the value goes straight to it
     * with the caller's own context — no speculative sub-context, no rolled-back error list, and the
     * failure is reported as the inner type rather than as a union summary.
     */
    optional : ( v: any, path: string, ctx: ValidationContext, inner: Function ) =>
    {
        if( v === undefined ){ return v }

        return inner( v, path, ctx );
    },

    /** `T | null`. See `optional`. */
    nullable : ( v: any, path: string, ctx: ValidationContext, inner: Function ) =>
    {
        if( v === null ){ return v }

        return inner( v, path, ctx );
    },

    /** `T | null | undefined`. See `optional`. */
    nullish : ( v: any, path: string, ctx: ValidationContext, inner: Function ) =>
    {
        if( v === undefined || v === null ){ return v }

        return inner( v, path, ctx );
    },

    /**
     * A union whose arms are objects carrying distinct literal values at `key`. The tag picks the arm in
     * one lookup, and since the tags are distinct that arm is the only one that could match — its errors
     * are reported directly. Anything the tag cannot resolve (a non-object, an unknown or not-yet-coerced
     * tag) goes back through `union`, which is what would have run anyway.
     */
    taggedUnion : ( v: any, path: string, ctx: ValidationContext, key: string, byTag: Map<any, Function>, expected: string = 'Type<Union>' ) =>
    {
        if( isPlainObject( v ))
        {
            const check = byTag.get( v[key]);

            if( check ){ return check( v, path, ctx ) }
        }

        return validators.union( v, path, ctx, [ ...byTag.values() ], expected );
    },

    union : ( v: any, path: string, ctx: ValidationContext, checks: Function[], expected: string = 'Type<Union>' ) => 
    {
        const unionErrors: IValidationError[] = [];
        // Speculative arms always use a side tree so a failed arm cannot poison the next.
        const subCtx: ValidationContext =
        {
            success : true,
            errors  : [],
            mode    : ctx.mode,
            from    : undefined,
            mutate  : false,
            root    : ctx.root
        };

        const accept = ( val: any ) =>
        {
            if( shouldMutate( ctx ) && commitContainer( v, val )){ return v }

            return val;
        };

        // Pass 1: No conversion
        for( const check of checks )
        {
            subCtx.success = true;
            subCtx.errors.length = 0;
            subCtx.from = undefined;
            const val = check( v, path, subCtx );

            if( subCtx.success ){ return accept( val ) }

            unionErrors.push( ...subCtx.errors );
        }

        // Pass 2: With conversion (only when caller opted in)
        if( ctx.from )
        {
            unionErrors.length = 0;

            for( const check of checks )
            {
                subCtx.success = true;
                subCtx.errors.length = 0;
                subCtx.from = ctx.from;
                const val = check( v, path, subCtx );

                if( subCtx.success ){ return accept( val ) }

                unionErrors.push( ...subCtx.errors );
            }
        }

        ctx.success = false;
        ctx.errors.push({
            path,
            value  : v,
            error  : expected,
            issues : unionErrors.length > 0 ? unionErrors : undefined
        });

        return v;
    },

    tuple : ( v: any, path: string, ctx: ValidationContext, checks: Function[]) => 
    {
        if( !Array.isArray( v ) || v.length !== checks.length ) 
        {
            if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'tuple' );

                if( Array.isArray( converted ) && converted.length === checks.length )
                {
                    v = converted;
                }
                else 
                {
                    report( ctx, path, `Tuple<${checks.length}>`, v );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, `Tuple<${checks.length}>`, v );

                return v;
            }
        }

        if( shouldMutate( ctx ))
        {
            for( let i = 0; i < checks.length; i++ )
            {
                v[i] = checks[i]( v[i], indexPath( path, i ), ctx );
            }

            return v;
        }

        const data: any[] = [];

        for( let i = 0; i < checks.length; i++ )
        {
            data[i] = checks[i]( v[i], indexPath( path, i ), ctx );
        }

        return data;
    },

    any : ( v: any ) => v,

    never : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof ctx.from === 'function' )
        {
            fromCustom( ctx, path, v, 'never' );
        }

        report( ctx, path, 'Type<never>', v );

        return v;
    },

    symbol : ( v: any, path: string, ctx: ValidationContext ) => 
    {
        if( typeof v === 'symbol' ){ return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'symbol' );

            if( typeof converted === 'symbol' ){ return converted }
        }

        report( ctx, path, 'Type<symbol>', v );

        return v;
    },

    instanceOf : ( v: any, path: string, ctx: ValidationContext, ctorOrName: Function | string ) => 
    {
        const ctor = typeof ctorOrName === 'string' ? ( globalThis as any )[ctorOrName] : ctorOrName;
        const label = typeof ctorOrName === 'string' ? ctorOrName : ( ctorOrName.name || 'Object' );

        if( typeof ctor === 'function' && v instanceof ctor ){ return v }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'instance' );

            if( typeof ctor === 'function' && converted instanceof ctor ){ return converted }
        }

        report( ctx, path, `Type<${label}>`, v );

        return v;
    },

    requires : ( v: any, path: string, ctx: ValidationContext, reqs: string[], message?: string ) => 
    {
        if( v === undefined || v === null ) { return v }

        for( const r of reqs ) 
        {
            const resolved = resolvePath( path, r );

            if( !hasPath( ctx.root, resolved )) 
            {
                report( ctx, path, `Requires<${r}>`, v, message );
            }
        }

        return v;
    },

    record : ( v: any, path: string, ctx: ValidationContext, childValidator: Function ) => 
    {
        if( !isPlainObject( v )) 
        {
            if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'Object' );

                if( isPlainObject( converted )){ v = converted }
                else 
                {
                    report( ctx, path, 'Type<Object>', v );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, 'Type<Object>', v );

                return v;
            }
        }
        const mutate = shouldMutate( ctx );
        const data = mutate ? v : {};

        for( const key of Object.keys( v )) 
        {
            setOwnProperty( data, key, childValidator( v[key], childPath( path, key ), ctx ));
        }

        return data;
    },

    set : ( v: any, path: string, ctx: ValidationContext, childValidator: Function, message?: string ) => 
    {
        if( !( v instanceof Set )) 
        {
            if( wantsJsonRevive( ctx ) && Array.isArray( v )) 
            {
                v = new Set( v );
            }
            else if( wantsQuery( ctx ) && v !== undefined && v !== null ) 
            {
                v = new Set([v]);
            }
            else if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'Set' );

                if( converted instanceof Set ){ v = converted }
                else 
                {
                    report( ctx, path, 'Type<Set>', v, message );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, 'Type<Set>', v, message );

                return v;
            }
        }
        const source = [...v];
        let index = 0;

        if( shouldMutate( ctx ))
        {
            v.clear();

            for( const item of source )
            {
                v.add( childValidator( item, `${path}[${index}]`, ctx ));
                index++;
            }

            return v;
        }

        const data = new Set();

        for( const item of source )
        {
            data.add( childValidator( item, `${path}[${index}]`, ctx ));
            index++;
        }

        return data;
    },

    map : ( v: any, path: string, ctx: ValidationContext, keyValidator: Function, valueValidator: Function, message?: string ) => 
    {
        if( !( v instanceof Map )) 
        {
            if( wantsJsonRevive( ctx ) && isPlainObject( v )) 
            {
                v = new Map( Object.entries( v ));
            }
            else if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'Map' );

                if( converted instanceof Map ){ v = converted }
                else 
                {
                    report( ctx, path, 'Type<Map>', v, message );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, 'Type<Map>', v, message );

                return v;
            }
        }

        const source = [...v.entries()];

        if( shouldMutate( ctx ))
        {
            v.clear();

            for( const [key, val] of source )
            {
                const validatedKey = keyValidator( key, `${path}.key(${key})`, ctx );
                const validatedVal = valueValidator( val, `${path}[${key}]`, ctx );
                v.set( validatedKey, validatedVal );
            }

            return v;
        }

        const data = new Map();

        for( const [key, val] of source )
        {
            const validatedKey = keyValidator( key, `${path}.key(${key})`, ctx );
            const validatedVal = valueValidator( val, `${path}[${key}]`, ctx );
            data.set( validatedKey, validatedVal );
        }

        return data;
    }
};

function tokenizePath( path: string ): string[] 
{
    const cleanPath = path.startsWith( '.' ) ? path.substring( 1 ) : path;

    if( !cleanPath ) { return [] }

    const segments: string[] = [];
    let buf = '';

    for( let i = 0; i < cleanPath.length; i++ ) 
    {
        const ch = cleanPath[i];

        if( ch === '.' ) 
        {
            if( buf ) 
            {
                segments.push( buf );
                buf = '';
            }
        }
        else if( ch === '[' ) 
        {
            if( buf ) 
            {
                segments.push( buf );
                buf = '';
            }

            const end = cleanPath.indexOf( ']', i );

            if( end === -1 ) 
            {
                buf += cleanPath.substring( i );
                break;
            }
            segments.push( cleanPath.substring( i, end + 1 ));
            i = end;
        }
        else 
        {
            buf += ch;
        }
    }

    if( buf ) { segments.push( buf ) }

    return segments;
}

function joinPathSegments( segments: string[]): string 
{
    let result = '';

    for( const seg of segments ) 
    {
        if( seg.startsWith( '[' )) 
        {
            result += seg;
        }
        else if( result ) 
        {
            result += '.' + seg;
        }
        else 
        {
            result = seg;
        }
    }

    return result;
}

function resolvePath( currentPath: string, targetPath: string ): string 
{
    if( !targetPath.startsWith( '.' )) 
    {
        return targetPath;
    }
    const dotsMatch = targetPath.match( /^\.+/ )!;
    const dots = dotsMatch[0].length;
    const targetClean = targetPath.substring( dots );

    const currentParts = tokenizePath( currentPath );
    const baseParts = currentParts.slice( 0, Math.max( 0, currentParts.length - dots ));

    if( targetClean ) 
    {
        baseParts.push( ...tokenizePath( targetClean ));
    }

    return joinPathSegments( baseParts );
}

function getValueAtPath( obj: any, path: string ): any 
{
    if( !obj || typeof obj !== 'object' ) { return undefined }

    const parts = tokenizePath( path );

    if( parts.length === 0 ) { return obj }
    let current = obj;

    for( const part of parts ) 
    {
        if( current === null || current === undefined || typeof current !== 'object' ) 
        {
            return undefined;
        }

        if( part.startsWith( '[' ) && part.endsWith( ']' )) 
        {
            const idx = parseInt( part.slice( 1, -1 ), 10 );
            current = current[idx];
        }
        else 
        {
            current = current[part];
        }
    }

    return current;
}

function hasPath( obj: any, path: string ): boolean 
{
    const val = getValueAtPath( obj, path );

    return val !== undefined && val !== null;
}

const compiledSchemas = new WeakMap<object, SchemaValidator>();

export function getOrCompileSchema( schema: JsonSchema | boolean ): SchemaValidator
{
    if( typeof schema === 'boolean' ){ return compileSchema( schema ) }

    if( typeof schema !== 'object' || schema === null || Array.isArray( schema ))
    {
        throw new Error( 'Invalid JSON Schema: must be a non-null object or boolean' );
    }
    let compiled = compiledSchemas.get( schema );

    if( !compiled )
    {
        compiled = compileSchema( schema );
        compiledSchemas.set( schema, compiled );
    }

    return compiled;
}

export function is( validator: Function, value: any, options?: ValidationMode | GuardOptions ): boolean
{
    const opt = options;
    const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
    const from = typeof opt === 'object' ? opt?.from : undefined;
    const ctx: ValidationContext = { success : true, errors : [], mode, from, mutate : true, root : value };
    const res = validator( value, '', ctx );

    if( !ctx.success ){ return false }

    if( res === value ){ return true }

    // Fallback when a branch returned a side tree (e.g. union) that still needs copying.
    return commitContainer( value, res );
}

export function assert( validator: Function, value: any, options?: ValidationMode | AssertOptions ): any
{
    const opt = options;
    const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
    const from = typeof opt === 'object' ? opt?.from : undefined;
    const mutate = typeof opt === 'object' ? opt?.mutate === true : false;
    const transform = typeof opt === 'object' ? opt?.transform : undefined;
    const ctx: ValidationContext = { success : true, errors : [], mode, from, mutate, root : value, transform };
    const res = validator( value, '', ctx );

    if( !ctx.success )
    {
        if( typeof opt === 'object' && opt?.errorFactory )
        {
            throw opt.errorFactory( ctx.errors );
        }
        throw new Error( 'Validation Error: ' + ctx.errors.map( e => e.path ? `${e.path}: ${e.error}` : e.error ).join( ', ' ));
    }

    if( mutate )
    {
        if( res === value || commitContainer( value, res )){ return value }

        return res;
    }

    return res;
}

export function assertGuard( validator: Function, value: any, options?: ValidationMode | AssertGuardOptions ): void
{
    const opt = options;
    const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
    const from = typeof opt === 'object' ? opt?.from : undefined;
    const ctx: ValidationContext = { success : true, errors : [], mode, from, mutate : true, root : value };
    const res = validator( value, '', ctx );

    if( ctx.success && ( res === value || commitContainer( value, res ))){ return }

    // Root was replaced (e.g. primitive coerce) — binding unchanged; report a normal type failure.
    if( ctx.success && res !== value )
    {
        ctx.success = true;
        ctx.errors.length = 0;
        ctx.from = undefined;
        validator( value, '', ctx );

        if( ctx.success )
        {
            report( ctx, '', 'RootNotRewritable', value );
        }
    }

    if( typeof opt === 'object' && opt?.errorFactory )
    {
        throw opt.errorFactory( ctx.errors );
    }
    throw new Error( 'Validation Error: ' + ctx.errors.map( e => e.path ? `${e.path}: ${e.error}` : e.error ).join( ', ' ));
}

export function validate( validator: Function, value: any, options?: ValidationMode | ValidationOptions ): { success : boolean, errors : IValidationError[], data? : any }
{
    const opt = options;
    const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
    const from = typeof opt === 'object' ? opt?.from : undefined;
    const mutate = typeof opt === 'object' ? opt?.mutate === true : false;
    const transform = typeof opt === 'object' ? opt?.transform : undefined;
    const ctx: ValidationContext = { success : true, errors : [], mode, from, mutate, root : value, transform };
    const res = validator( value, '', ctx );

    if( !ctx.success ){ return { success : false, errors : ctx.errors } }

    if( mutate )
    {
        if( res === value || commitContainer( value, res ))
        {
            return { success : true, errors : [], data : value };
        }

        return { success : true, errors : [], data : res };
    }

    return { success : true, errors : [], data : res };
}

export function groupErrorsByPath( errors: IValidationError[]): Record<string, { value : any, errors : string[] }> 
{
    const grouped: Record<string, { value : any, errors : string[] }> = Object.create( null );

    const visit = ( list: IValidationError[]) => 
    {
        for( const err of list ) 
        {
            if( !Object.hasOwn( grouped, err.path ))
            {
                setOwnProperty( grouped, err.path, { value : err.value, errors : [] });
            }

            if( !grouped[err.path].errors.includes( err.error )) 
            {
                grouped[err.path].errors.push( err.error );
            }

            if( err.issues?.length ){ visit( err.issues ) }
        }
    };

    visit( errors );

    return grouped;
}

function decodeJsonPointerToken( token: string ): string
{
    return token.replace( /~1/g, '/' ).replace( /~0/g, '~' );
}

const SCHEMA_META_KEYS = new Set([
    '$schema', '$id', '$defs', 'definitions',
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

    if( typeof root !== 'object' || root === null )
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

function collectSchemaAnchors( node: unknown, anchors: Map<string, JsonSchema | boolean> ): void
{
    if( node === true || node === false || node === null || typeof node !== 'object' ){ return }

    if( Array.isArray( node ))
    {
        for( const item of node ){ collectSchemaAnchors( item, anchors ) }

        return;
    }

    const schema = node as JsonSchemaObject;

    if( typeof schema.$anchor === 'string' ){ anchors.set( schema.$anchor, schema ) }

    if( typeof schema.$dynamicAnchor === 'string' ){ anchors.set( schema.$dynamicAnchor, schema ) }

    if( typeof schema.$recursiveAnchor === 'string' ){ anchors.set( schema.$recursiveAnchor, schema ) }

    if( schema.$recursiveAnchor === true ){ anchors.set( '', schema ) }

    for( const value of Object.values( schema ))
    {
        collectSchemaAnchors( value, anchors );
    }
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

export function compileSchema( schema: JsonSchema | boolean ): SchemaValidator
{
    const rootSchema = schema;
    const compiledDefs = new Map<string, SchemaValidator>();
    const anchors = new Map<string, JsonSchema | boolean>();

    collectSchemaAnchors( rootSchema, anchors );

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
                    success         : true,
                    errors          : [],
                    mode            : ctx.mode,
                    from            : ctx.from,
                    mutate          : false,
                    root            : ctx.root,
                    dynamicAnchors  : ctx.dynamicAnchors
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
            const ifCheck = build( subSchema.if ?? true );
            const thenCheck = subSchema.then !== undefined ? build( subSchema.then ) : null;
            const elseCheck = subSchema.else !== undefined ? build( subSchema.else ) : null;
            const prev = wrapped;

            wrapped = ( v, path, ctx ) =>
            {
                let out = prev( v, path, ctx );

                if( !ctx.success ){ return out }

                const probe: ValidationContext =
                {
                    success         : true,
                    errors          : [],
                    mode            : ctx.mode,
                    from            : ctx.from,
                    mutate          : false,
                    root            : ctx.root,
                    annotations     : emptyAnnotations(),
                    dynamicAnchors  : ctx.dynamicAnchors
                };
                ifCheck( v, path, probe );
                mergeAnnotations( ensureAnnotations( ctx ), probe.annotations );

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
                let out = prev( v, path, ctx );

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

        return withConst( withEnum( wrapped, subSchema ), subSchema );
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
        const name = refPath.startsWith( '#' ) && !refPath.startsWith( '#/' )
            ? decodeURIComponent( refPath.slice( 1 ))
            : refPath === '#' || refPath === '#/'
                ? ''
                : decodeURIComponent( refPath.replace( /^#/, '' ));

        return ( v, path, ctx ) =>
        {
            const target = resolveDynamicAnchor( ctx, name ) ?? anchors.get( name );

            if( target === undefined )
            {
                throw new Error( `Schema reference not found: ${refPath}` );
            }

            return runInPlace( build( target ), v, path, ctx );
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
            ['Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Buffer'].includes( subSchema['x-typescript-type']))
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

                // Synthetic opens / explicit additionalProperties:true — only declared props merge;
                // extras stay on the instance for parent unevaluated* or combinedKeys.
                if( allofOpenedRoots.has( s ))
                {
                    return new Set<string>( Object.keys( s.properties || {}));
                }

                if( 'additionalProperties' in s && s.additionalProperties !== false )
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
                    typeof s === 'object' && s !== null ? Object.keys( s.properties || {}) : []
                ));

            return maybeWrapDynamicAnchor( finalize(( v, path, ctx ) =>
            {
                const errors: IValidationError[] = [];
                let data: any = undefined;
                const subCtx: ValidationContext =
                {
                    success         : true,
                    errors          : [],
                    mode            : ctx.mode,
                    from            : ctx.from,
                    mutate          : false,
                    root            : ctx.root,
                    annotations     : emptyAnnotations(),
                    dynamicAnchors  : ctx.dynamicAnchors
                };

                for( let i = 0; i < checks.length; i++ )
                {
                    const check = checks[i];
                    subCtx.success = true;
                    subCtx.errors.length = 0;
                    subCtx.from = ctx.from;
                    subCtx.root = ctx.root;
                    subCtx.annotations = emptyAnnotations();
                    subCtx.dynamicAnchors = ctx.dynamicAnchors;
                    const val = check( v, path, subCtx );

                    errors.push( ...subCtx.errors );

                    if( subCtx.success )
                    {
                        mergeAnnotations( ensureAnnotations( ctx ), subCtx.annotations );
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
                        else if( ctx.mode === 'relaxed' )
                        {
                            setOwnProperty( data, key, v[key]);
                        }
                    }
                }
                else if( ( 'unevaluatedProperties' in subSchema ) && isPlainObject( v ) && isPlainObject( data ))
                {
                    // Member merges only copy evaluated keys; keep unevaluated extras on the
                    // result so finalize's unevaluatedProperties can see them.
                    for( const key of Object.keys( v ))
                    {
                        if( Object.hasOwn( data, key )){ continue }

                        setOwnProperty( data, key, v[key]);
                    }
                }

                if( ( 'unevaluatedItems' in subSchema ) && Array.isArray( v ) && Array.isArray( data ))
                {
                    for( let i = 0; i < v.length; i++ )
                    {
                        if( Object.hasOwn( data, i )){ continue }

                        setOwnProperty( data, i, v[i]);
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
                const matchAnnotations: SchemaAnnotationFrame[] = [];
                const armErrors: IValidationError[] = [];
                const subCtx: ValidationContext =
                {
                    success         : true,
                    errors          : [],
                    mode            : ctx.mode,
                    from            : undefined,
                    mutate          : false,
                    root            : ctx.root,
                    annotations     : emptyAnnotations(),
                    dynamicAnchors  : ctx.dynamicAnchors
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
                        subCtx.annotations = emptyAnnotations();
                        subCtx.dynamicAnchors = ctx.dynamicAnchors;
                        const val = check( v, path, subCtx );

                        if( subCtx.success )
                        {
                            matches.push( val );
                            matchAnnotations.push( subCtx.annotations ?? emptyAnnotations());
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
                    mergeAnnotations( ensureAnnotations( ctx ), matchAnnotations[0]);
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
                const successAnnotations: SchemaAnnotationFrame[] = [];
                const unionErrors: IValidationError[] = [];
                const subCtx: ValidationContext =
                {
                    success         : true,
                    errors          : [],
                    mode            : ctx.mode,
                    from            : undefined,
                    mutate          : false,
                    root            : ctx.root,
                    annotations     : emptyAnnotations(),
                    dynamicAnchors  : ctx.dynamicAnchors
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
                        subCtx.annotations = emptyAnnotations();
                        subCtx.dynamicAnchors = ctx.dynamicAnchors;
                        const val = check( v, path, subCtx );

                        if( subCtx.success )
                        {
                            successes.push( val );
                            successAnnotations.push( subCtx.annotations ?? emptyAnnotations());
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
                        mergeAnnotations( ensureAnnotations( ctx ), ann );
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
                            success         : true,
                            errors          : [],
                            mode            : ctx.mode,
                            from            : ctx.from,
                            mutate          : false,
                            root            : ctx.root,
                            dynamicAnchors  : ctx.dynamicAnchors
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
                const check: SchemaValidator = ( val, p, c ) => runNested( inner, val, p, c );

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
            const knownPropKeys = new Set<string>([ ...Object.keys( properties ), ...required ]);
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
                const evaluated = new Set<string>();

                if( propertyNamesCheck )
                {
                    for( const key of Object.keys( obj ))
                    {
                        runNested( propertyNamesCheck, key, childPath( path, key ), ctx );
                    }
                }

                validators.props( obj, data, path, ctx, propVals );

                for( const key of Object.keys( properties ))
                {
                    if( !Object.hasOwn( obj, key )){ continue }

                    evaluated.add( key );
                    markProperty( ctx, key );
                }

                for( const key of Object.keys( obj ))
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

                const forAdditional = Object.keys( obj ).filter( key =>
                {
                    if( Object.hasOwn( properties, key )){ return false }

                    if( patternEntries.some( entry => testRegex( entry.regex, key ))){ return false }

                    return true;
                });

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

                if( additional === false && !hasUnevaluatedProps )
                {
                    validators.stripExtras( data, ctx, new Set([ ...evaluated, ...knownPropKeys ]));
                }

                if( minProperties !== undefined ){ validators.minProperties( data, path, ctx, minProperties ) }

                if( maxProperties !== undefined ){ validators.maxProperties( data, path, ctx, maxProperties ) }

                for( const [ key, deps ] of Object.entries( dependentRequired ))
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

                    if( isPlainObject( next ) && isPlainObject( data ))
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
                    else if( entry.check )
                    {
                        const next = runInPlace( entry.check, obj, path, ctx );

                        if( isPlainObject( next ) && isPlainObject( data ))
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
        if( subSchema.type === undefined )
        {
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
            const hasArrayKeywords = subSchema.items !== undefined ||
                subSchema.prefixItems !== undefined ||
                'additionalItems' in subSchema ||
                subSchema.minItems !== undefined ||
                subSchema.maxItems !== undefined ||
                subSchema.uniqueItems === true ||
                'contains' in subSchema ||
                subSchema.minContains !== undefined ||
                subSchema.maxContains !== undefined ||
                'unevaluatedItems' in subSchema;
            const hasObjectKeywords = subSchema.properties !== undefined ||
                subSchema.patternProperties !== undefined ||
                'propertyNames' in subSchema ||
                subSchema.required !== undefined ||
                'additionalProperties' in subSchema ||
                'unevaluatedProperties' in subSchema ||
                subSchema.dependencies !== undefined ||
                subSchema.dependentRequired !== undefined ||
                subSchema.dependentSchemas !== undefined ||
                subSchema.minProperties !== undefined ||
                subSchema.maxProperties !== undefined;

            if( hasStringKeywords || hasNumberKeywords || hasArrayKeywords || hasObjectKeywords )
            {
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
                    ? build({
                        type : 'array',
                        ...( subSchema.items !== undefined ? { items : subSchema.items } : {}),
                        ...( subSchema.prefixItems !== undefined
                            ? { prefixItems : subSchema.prefixItems }
                            : {}),
                        ...( 'additionalItems' in subSchema
                            ? { additionalItems : subSchema.additionalItems }
                            : {}),
                        ...( subSchema.minItems !== undefined ? { minItems : subSchema.minItems } : {}),
                        ...( subSchema.maxItems !== undefined ? { maxItems : subSchema.maxItems } : {}),
                        ...( subSchema.uniqueItems === true ? { uniqueItems : true } : {}),
                        ...( 'contains' in subSchema ? { contains : subSchema.contains } : {}),
                        ...( subSchema.minContains !== undefined
                            ? { minContains : subSchema.minContains }
                            : {}),
                        ...( subSchema.maxContains !== undefined
                            ? { maxContains : subSchema.maxContains }
                            : {}),
                        ...( 'unevaluatedItems' in subSchema
                            ? { unevaluatedItems : subSchema.unevaluatedItems }
                            : {})
                    })
                    : undefined;
                const objectCheck = hasObjectKeywords
                    ? build((() =>
                    {
                        const inferred: JsonSchemaObject =
                        {
                            type : 'object',
                            ...( subSchema.properties !== undefined
                                ? { properties : subSchema.properties }
                                : {}),
                            ...( subSchema.patternProperties !== undefined
                                ? { patternProperties : subSchema.patternProperties }
                                : {}),
                            ...( 'propertyNames' in subSchema
                                ? { propertyNames : subSchema.propertyNames }
                                : {}),
                            ...( subSchema.required !== undefined ? { required : subSchema.required } : {}),
                            ...( 'additionalProperties' in subSchema
                                ? { additionalProperties : subSchema.additionalProperties }
                                : {}),
                            ...( 'unevaluatedProperties' in subSchema
                                ? { unevaluatedProperties : subSchema.unevaluatedProperties }
                                : {}),
                            ...( subSchema.dependencies !== undefined
                                ? { dependencies : subSchema.dependencies }
                                : {}),
                            ...( subSchema.dependentRequired !== undefined
                                ? { dependentRequired : subSchema.dependentRequired }
                                : {}),
                            ...( subSchema.dependentSchemas !== undefined
                                ? { dependentSchemas : subSchema.dependentSchemas }
                                : {}),
                            ...( subSchema.minProperties !== undefined
                                ? { minProperties : subSchema.minProperties }
                                : {}),
                            ...( subSchema.maxProperties !== undefined
                                ? { maxProperties : subSchema.maxProperties }
                                : {})
                        };

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
        }

        return maybeWrapDynamicAnchor( finalize(( v ) => v, subSchema ), subSchema );
    }

    return build( schema );
}

/**
 * Array indices become numbers, the way Zod reports them. Every other segment stays a string, so an
 * object key that merely looks numeric is not turned into an index, and a key containing a bracket
 * survives as one segment instead of being split apart.
 */
function zodPathSegments( path: string ): ( string | number )[]
{
    return tokenizePath( path ).map( segment =>
    {
        if( !isIndexSegment( segment )){ return segment }

        const inner = segment.slice( 1, -1 );

        return /^\d+$/.test( inner ) ? Number( inner ) : inner;
    });
}

export function toZodIssues( errors: IValidationError[])
{
    const issues: any[] = [];

    const visit = ( list: IValidationError[]) => 
    {
        for( const err of list ) 
        {
            issues.push({
                code     : 'custom',
                path     : zodPathSegments( err.path ),
                message  : err.error,
                received : err.value
            });

            if( err.issues?.length ){ visit( err.issues ) }
        }
    };

    visit( errors );

    return issues;
}

export class ZodLikeError extends Error
{
    public issues : any[];

    constructor( errors: IValidationError[])
    {
        super( 'Validation failed' );
        this.name = 'ZodError';
        this.issues = toZodIssues( errors );
    }
}

