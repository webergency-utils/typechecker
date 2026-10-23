import
{
    childPath,
    indexPath,
    isIndexSegment,
    tokenizePath,
    joinPathSegments,
    resolvePath,
    getValueAtPath,
    hasPath
}
    from './path.js';
export { resolvePath, getValueAtPath, hasPath };
import { createSafeRegex, isRegexSafe, testRegex } from './regex.js';
import { applyNodeTransform, type TransformFn } from './transform.js';

/** Controls unknown object keys only — not coercion. Use `from` for conversion. */
export type ValidationMode = 'strict' | 'relaxed' | 'strip';

/** Strategy for resolving untagged unions (default `'specificity'`). */
export type UnionResolution = 'specificity' | 'declaration-order';

export interface IValidationError {
    path    : string
    value   : any
    error   : string
    /** Nested failures (e.g. per-arm errors for a failed union). */
    issues? : IValidationError[]
}

export interface IValidationSuccess<T>
{
    success : true
    data    : T
    errors  : IValidationError[]
}

export interface IValidationFailure<T = never>
{
    success : false
    data?   : T
    errors  : IValidationError[]
}

export type IValidation<T> = IValidationSuccess<T> | IValidationFailure<T>;

/** Expected runtime kind for custom `from` — a dispatch tag, not `typeof` / a TS type. */
export type CoercionKind =
    | 'string' | 'number' | 'boolean' | 'bigint' | 'function' | 'symbol' | 'never'
    | 'Date' | 'URL' | 'RegExp' | 'Set' | 'Map' | 'Array' | 'Object' | 'instance'
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
    success          : boolean
    errors           : IValidationError[]
    mode             : ValidationMode
    from?            : FromOption
    mutate?          : boolean
    root?            : any
    /**
     * Draft 2019-09 / 2020-12 annotation frame for the current instance location.
     * In-place applicators (`allOf`, `anyOf`, `oneOf`, `if`, `$ref`) merge into the
     * parent frame; nested property/item applications push a fresh frame.
     */
    annotations?     : SchemaAnnotationFrame
    /** Dynamic scope bindings for `$dynamicAnchor` / `$dynamicRef` (and 2019-09 recursive). */
    dynamicAnchors?  : Map<string, JsonSchema | boolean>[]
    /** Opt-in typed walk for `assert` / `validate`. Never set by `is` / `assertGuard`. */
    transform?       : TransformFn | TransformFn[]
    /** Active strip-mode union probe counters for best-fit arm selection. */
    unionProbe?      : { stripped : number, matched : number }
    /** Union resolution strategy (`'specificity'` | `'declaration-order'`). */
    unionResolution? : UnionResolution
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
    mode?            : ValidationMode
    from?            : FromOption
    unionResolution? : UnionResolution
}

/** Options for `assertGuard` / `assertGuardSchema`. */
export interface AssertGuardOptions extends GuardOptions {
    errorFactory? : ( errors: IValidationError[]) => Error
}

/** Options for `validate` / `validateSchema`. */
export interface ValidationOptions extends GuardOptions {
    /** `true`: write in place while validating. `false` (default): allocate new containers. */
    mutate?    : boolean
    /** Opt-in typed rewrite after revival / `transform.*` tags. Not used by `is` / `assertGuard`. */
    transform? : TransformFn | TransformFn[]
}

/** Options for `assert` / `assertSchema`. */
export interface AssertOptions extends ValidationOptions {
    errorFactory? : ( errors: IValidationError[]) => Error
}

/** JSON Schema `type` values supported by `compileSchema`. */
export type JsonSchemaType =
    | 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'array' | 'object'
    | ( string & {});

/** `x-typescript-type` extensions emitted by `jsonSchema<T>()`. */
export type JsonSchemaTypescriptType =
    | 'Date' | 'URL' | 'RegExp' | 'bigint' | 'undefined' | 'Set' | 'Map' | 'Promise'
    | 'Uint8Array' | 'Uint8ClampedArray' | 'Uint16Array' | 'Uint32Array'
    | 'Int8Array' | 'Int16Array' | 'Int32Array'
    | 'Float32Array' | 'Float64Array'
    | 'BigInt64Array' | 'BigUint64Array'
    | 'ArrayBuffer' | 'SharedArrayBuffer' | 'DataView' | 'Buffer'
    | ( string & {});

/**
 * Supported JSON Schema object subset (draft-07 / selected 2019-09+ / 2020-12 keywords)
 * plus `x-typescript-type` extensions.
 * Root boolean schemas (`true` / `false`) still work at runtime but are not part of this type.
 */
export type JsonSchemaTarget = 'draft-07' | 'draft-2020-12' | 'openapi-3.0' | 'openapi-3.1';

export interface JsonSchemaOptions
{
    target? : JsonSchemaTarget
}

export type JsonSchema = JsonSchemaObject;

export interface JsonSchemaObject
{
    $schema?               : string
    $id?                   : string
    $defs?                 : Record<string, JsonSchema | boolean | undefined>
    definitions?           : Record<string, JsonSchema | boolean>
    components?            : { schemas? : Record<string, JsonSchema | boolean | undefined> }
    $ref?                  : string
    type?                  : JsonSchemaType | JsonSchemaType[]
    nullable?              : boolean
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
    properties?            : Record<string, JsonSchema | boolean | undefined>
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

export type CompiledSchema<T = unknown> = SchemaValidator & StandardSchemaV1<unknown, T>;

export const report = ( ctx: ValidationContext, path: string, expected: string, value: any, message?: string ) => 
{
    ctx.success = false;
    ctx.errors.push({ path, value, error : message || expected });
};

/**
 * A value that object/record validators can treat as a property bag: anything we can read string
 * keys from. Prototype identity is irrelevant — `process.env`, class instances, and null-proto
 * objects are all fine. Known exotics (Date, Map, arrays, …) have dedicated validators instead.
 */
export function isPlainObject( v: any ): boolean 
{
    if( v === null || typeof v !== 'object' || Array.isArray( v )) { return false }

    if( v instanceof Date || v instanceof URL || v instanceof RegExp || v instanceof Map || v instanceof Set ) { return false }

    if( typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer( v )) { return false }

    if( ArrayBuffer.isView( v ) || v instanceof ArrayBuffer ) { return false }

    return true;
}

export function findExclusiveKeyArm( v: any, exclusiveKeys: string[] | undefined ): number
{
    if( !exclusiveKeys || !isPlainObject( v )){ return -1 }

    let matchedIdx = -1;

    for( let i = 0; i < exclusiveKeys.length; i++ )
    {
        if( v[exclusiveKeys[i]] !== undefined )
        {
            if( matchedIdx !== -1 ){ return -1 }

            matchedIdx = i;
        }
    }

    return matchedIdx;
}

export function setOwnProperty( target: any, key: PropertyKey, value: any ): void
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

export function assignOwnProperties( target: any, source: any ): void
{
    for( const key of Object.keys( source ))
    {
        setOwnProperty( target, key, source[key]);
    }
}

function keySetHas( keys: string[] | Set<string>, key: string ): boolean
{
    return keys instanceof Set ? keys.has( key ) : keys.includes( key );
}

export function commitContainer( target: any, source: any ): boolean
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

export function isMultipleOfNumber( v: number, n: number ): boolean 
{
    if( n === 0 || !Number.isFinite( n )) { return false }

    if( !Number.isFinite( v )) { return true }

    const q = v / n;

    return Math.abs( q - Math.round( q )) <= 1e-8 * Math.max( 1, Math.abs( q ));
}

export function shouldMutate( ctx: ValidationContext ): boolean 
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

    return new Date( value );
}

export function deepEqual( left: any, right: any, seen: WeakMap<object, WeakSet<object>> = new WeakMap()): boolean
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

    if( left instanceof URL || right instanceof URL )
    {
        return left instanceof URL && right instanceof URL && left.href === right.href;
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

export function hasUniqueItems( v: any[]): boolean
{
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
    const firstByHash = new Map<number, any>();
    const collisionBuckets = new Map<number, any[]>();
    const complex: any[] = [];

    for( let i = 0; i < v.length; i++ )
    {
        const item = v[i];

        if( item === null )
        {
            if( seenNull ){ return false }

            seenNull = true;
            continue;
        }

        if( item === undefined )
        {
            if( seenUndefined ){ return false }

            seenUndefined = true;
            continue;
        }

        const type = typeof item;

        if( type === 'string' )
        {
            seenStrings ??= new Set();

            if( seenStrings.has( item )){ return false }

            seenStrings.add( item );
            continue;
        }

        if( type === 'number' )
        {
            if( Object.is( item, -0 ))
            {
                if( seenNegZero ){ return false }

                seenNegZero = true;
                continue;
            }

            seenNumbers ??= new Set();

            if( seenNumbers.has( item )){ return false }

            seenNumbers.add( item );
            continue;
        }

        if( type === 'boolean' )
        {
            if( item )
            {
                if( seenTrue ){ return false }

                seenTrue = true;
            }
            else
            {
                if( seenFalse ){ return false }

                seenFalse = true;
            }

            continue;
        }

        if( type === 'bigint' )
        {
            seenBigints ??= new Set();

            if( seenBigints.has( item )){ return false }

            seenBigints.add( item );
            continue;
        }

        if( type === 'object' )
        {
            if( item instanceof Date )
            {
                const time = item.getTime();
                seenDates ??= new Set();

                if( seenDates.has( time )){ return false }

                seenDates.add( time );
                continue;
            }

            if( item instanceof RegExp )
            {
                const key = `${item.source}/${item.flags}`;
                seenRegex ??= new Set();

                if( seenRegex.has( key )){ return false }

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
                    if( deepEqual( item, first )){ return false }

                    collisionBuckets.set( hash, [first, item]);
                    continue;
                }

                for( let j = 0; j < bucket.length; j++ )
                {
                    if( deepEqual( item, bucket[j])){ return false }
                }

                bucket.push( item );
                continue;
            }
        }

        for( let j = 0; j < complex.length; j++ )
        {
            if( deepEqual( item, complex[j])){ return false }
        }

        complex.push( item );
    }

    return true;
}

const probeSource = new WeakMap<object, Record<string, any>>();

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

        if( wantsQuery( ctx ) && typeof v === 'number' && Number.isSafeInteger( v )) 
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

    urlInstance : ( v: any, path: string, ctx: ValidationContext ) =>
    {
        if( v instanceof URL ){ return v }

        if( wantsJsonRevive( ctx ) && typeof v === 'string' && v.trim() !== '' )
        {
            try
            {
                return new URL( v );
            }
            catch
            { /* fall through */ }
        }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'URL' );

            if( converted instanceof URL ){ return converted }
        }

        report( ctx, path, 'Type<URL>', v );

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

        if( wantsJsonRevive( ctx ) && typeof expected === 'bigint' )
        {
            if( typeof v === 'string' && v.trim() !== '' )
            {
                try
                {
                    const b = BigInt( v );

                    if( b === expected ){ return b }
                }
                catch
                { /* ignore */ }
            }
            else if( typeof v === 'number' && Number.isSafeInteger( v ))
            {
                const b = BigInt( v );

                if( b === expected ){ return b }
            }
        }

        if( typeof ctx.from === 'function' )
        {
            const converted = fromCustom( ctx, path, v, 'literal' );

            if( converted === expected ){ return converted }
        }

        const expStr = typeof expected === 'string'
            ? `'${expected}'`
            : typeof expected === 'bigint'
                ? `${expected}n`
                : expected;
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
                const next = childValidator( v[i], indexPath( path, i ), ctx );

                if( !Object.is( v[i], next )){ v[i] = next }
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
        const inPlace = data === v;

        for( const [key, isOptional, validator, hasDefault] of props ) 
        {
            const val = v[key];

            // An absent optional property stays absent. Running its `T | undefined` validator would cost
            // a union attempt and then write the key back as an explicit `undefined`. A Defaulted
            // optional must still run — and if the filled default fails a constraint, that error
            // must stick (there is no silent rollback here).
            if( isOptional && val === undefined && !hasDefault ){ continue }

            const result = validator( val, childPath( path, key ), ctx );

            if( ctx.success && ( !inPlace || !Object.is( val, result ) || ( val === undefined && !Object.hasOwn( v, key ))))
            {
                setOwnProperty( data, key, result );
            }
        }
    },

    objectShell : ( v: any, ctx: ValidationContext, closed?: boolean ) => 
    {
        if( shouldMutate( ctx )) { return v }

        if( !isPlainObject( v )) { return v }

        if( ctx.mode === 'strip' )
        {
            const shell = {};

            if( ctx.unionProbe ){ probeSource.set( shell, v ) }

            return shell;
        }

        // A closed shape writes back every key it keeps, so copying the input first is wasted work.
        // Only `relaxed` needs the copy, being the one mode where an unknown key is kept as-is.
        if( closed && ctx.mode !== 'relaxed' ) { return {} }

        return { ...v };
    },

    stripExtras : ( data: any, ctx: ValidationContext, allowedKeys?: string[] | Set<string> ) => 
    {
        if( ctx.mode !== 'strip' || !ctx.success || !allowedKeys || !data || typeof data !== 'object' ) { return data }

        const mutate = shouldMutate( ctx );
        const probe = ctx.unionProbe;

        if( !mutate && !probe ) { return data }

        const src = ( probe && probeSource.get( data )) || data;

        for( const k of Object.keys( src )) 
        {
            if( keySetHas( allowedKeys, k ))
            {
                if( probe && src[k] !== undefined ){ probe.matched++ }
            }
            else
            {
                if( probe && src[k] !== undefined ){ probe.stripped++ }

                if( mutate ){ delete data[k] }
            }
        }

        return data;
    },

    additionalProps : ( v: any, data: any, path: string, ctx: ValidationContext, knownKeys: string[] | Set<string>, childValidator: Function ) => 
    {
        if( !isPlainObject( v )){ return }

        const inPlace = data === v;
        const probe = ctx.mode === 'strip' ? ctx.unionProbe : undefined;
        let matched = 0;

        for( const key of Object.keys( v )) 
        {
            const val = v[key];

            if( probe && val !== undefined ){ matched++ }

            if( keySetHas( knownKeys, key )){ continue }

            const next = childValidator( val, childPath( path, key ), ctx );

            if( !inPlace || !Object.is( val, next ))
            {
                setOwnProperty( data, key, next );
            }
        }

        if( probe && ctx.success ){ probe.matched += matched }
    },

    patternProps : (
        v              : any,
        data           : any,
        path           : string,
        ctx            : ValidationContext,
        knownKeys      : string[] | Set<string>,
        patterns       : [ RegExp, Function ][],
        indexValidator?: Function
    ) =>
    {
        if( !isPlainObject( v )){ return }

        const inPlace = data === v;
        const probe = ctx.mode === 'strip' ? ctx.unionProbe : undefined;
        let matched = 0;

        for( const key of Object.keys( v ))
        {
            const val = v[key];

            if( keySetHas( knownKeys, key ))
            {
                if( probe && val !== undefined ){ matched++ }

                continue;
            }

            let matchedPattern = false;
            let next = val;

            for( let i = 0; i < patterns.length; i++ )
            {
                const [ regex, validator ] = patterns[i];

                if( testRegex( regex, key ))
                {
                    matchedPattern = true;
                    next = validator( next, childPath( path, key ), ctx );
                }
            }

            if( matchedPattern )
            {
                if( probe && val !== undefined ){ matched++ }

                if( !inPlace || !Object.is( val, next ))
                {
                    setOwnProperty( data, key, next );
                }

                continue;
            }

            if( indexValidator )
            {
                if( probe && val !== undefined ){ matched++ }

                const idxNext = indexValidator( val, childPath( path, key ), ctx );

                if( !inPlace || !Object.is( val, idxNext ))
                {
                    setOwnProperty( data, key, idxNext );
                }

                continue;
            }

            if( ctx.mode === 'strict' )
            {
                report( ctx, path, `PropertyNotAllowed<${key}>`, val );
            }
            else if( ctx.mode === 'strip' )
            {
                if( probe && val !== undefined ){ probe.stripped++ }

                if( inPlace ){ delete data[key] }
            }
            else if( !inPlace )
            {
                setOwnProperty( data, key, val );
            }
        }

        if( probe && ctx.success ){ probe.matched += matched }
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

    minItems : ( v: any, path: string, ctx: ValidationContext, min: number, message?: string ) => 
    {
        const size = v instanceof Set ? v.size : ( Array.isArray( v ) ? v.length : undefined );

        if( size !== undefined && size < min ) { report( ctx, path, `MinItems<${min}>`, v, message ) }

        return v;
    },

    maxItems : ( v: any, path: string, ctx: ValidationContext, max: number, message?: string ) => 
    {
        const size = v instanceof Set ? v.size : ( Array.isArray( v ) ? v.length : undefined );

        if( size !== undefined && size > max ) { report( ctx, path, `MaxItems<${max}>`, v, message ) }

        return v;
    },

    minProperties : ( v: any, path: string, ctx: ValidationContext, min: number, message?: string ) =>
    {
        const size = v instanceof Map ? v.size : ( isPlainObject( v ) ? Object.keys( v ).length : undefined );

        if( size !== undefined && size < min )
        {
            report( ctx, path, `MinProperties<${min}>`, v, message );
        }

        return v;
    },

    maxProperties : ( v: any, path: string, ctx: ValidationContext, max: number, message?: string ) =>
    {
        const size = v instanceof Map ? v.size : ( isPlainObject( v ) ? Object.keys( v ).length : undefined );

        if( size !== undefined && size > max )
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
        if( !hasUniqueItems( v ))
        {
            report( ctx, path, 'UniqueItems', v, message );
        }

        return v;
    },

    custom : ( v: any, path: string, ctx: ValidationContext, fn: Function, message?: string ) => 
    {
        const res = fn( v, pathContext( path, ctx ));

        if( res && typeof ( res as PromiseLike<unknown> ).then === 'function' )
        {
            report( ctx, path, fn.name ? `AsyncCustomNotSupported<${fn.name}>` : 'AsyncCustomNotSupported', v, message );

            return v;
        }

        if( !res ) 
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

    union : (
        v             : any,
        path          : string,
        ctx           : ValidationContext,
        checks        : Function[],
        expected      : string = 'Type<Union>',
        probeBestFit  : boolean = false,
        fallbackFlags?: boolean[],
        exclusiveKeys?: string[]
    ) => 
    {
        const unionErrors: IValidationError[] = [];
        // Speculative arms always use a side tree so a failed arm cannot poison the next.
        const subCtx: ValidationContext =
        {
            success         : true,
            errors          : [],
            mode            : ctx.mode,
            from            : undefined,
            mutate          : false,
            root            : ctx.root,
            unionResolution : ctx.unionResolution
        };

        const accept = ( val: any ) =>
        {
            if( shouldMutate( ctx ) && commitContainer( v, val )){ return v }

            return val;
        };

        const matchedIdx = findExclusiveKeyArm( v, exclusiveKeys );

        if( matchedIdx >= 0 )
        {
            const armProbe = ctx.mode === 'strip' && ctx.unionProbe ? { stripped : 0, matched : 0 } : undefined;
            subCtx.success = true;
            subCtx.errors.length = 0;
            subCtx.from = undefined;
            subCtx.unionProbe = armProbe;
            const val = checks[matchedIdx]( v, path, subCtx );

            if( subCtx.success )
            {
                if( armProbe && ctx.unionProbe )
                {
                    ctx.unionProbe.stripped += armProbe.stripped;
                    ctx.unionProbe.matched += armProbe.matched;
                }

                return accept( val );
            }
        }

        if( ctx.mode === 'strip' && probeBestFit && ctx.unionResolution !== 'declaration-order' )
        {
            let bestVal: any;
            let hasBest = false;
            let bestStripped = Infinity;
            let bestMatched = -1;
            let fallbackVal: any;
            let hasFallback = false;

            const runPass = ( fromOpt: FromOption | undefined ): { shortCircuit : boolean, value? : any } =>
            {
                for( let i = 0; i < checks.length; i++ )
                {
                    const isFallback = Boolean( fallbackFlags && fallbackFlags[i]);

                    if( isFallback && ( hasBest || hasFallback )){ continue }

                    const probe = { stripped : 0, matched : 0 };
                    subCtx.success = true;
                    subCtx.errors.length = 0;
                    subCtx.from = fromOpt;
                    subCtx.unionProbe = probe;
                    const val = checks[i]( v, path, subCtx );

                    if( !subCtx.success )
                    {
                        unionErrors.push( ...subCtx.errors );
                        continue;
                    }

                    if( isFallback )
                    {
                        fallbackVal = val;
                        hasFallback = true;
                        continue;
                    }

                    if( probe.stripped === 0 )
                    {
                        if( ctx.unionProbe )
                        {
                            ctx.unionProbe.matched += probe.matched;
                        }

                        return { shortCircuit : true, value : accept( val ) };
                    }

                    if(
                        !hasBest ||
                        probe.stripped < bestStripped ||
                        ( probe.stripped === bestStripped && probe.matched > bestMatched )
                    )
                    {
                        bestVal = val;
                        hasBest = true;
                        bestStripped = probe.stripped;
                        bestMatched = probe.matched;
                    }
                }

                return { shortCircuit : false };
            };

            const pass1 = runPass( undefined );

            if( pass1.shortCircuit ){ return pass1.value }

            if( ctx.from )
            {
                unionErrors.length = 0;
                const pass2 = runPass( ctx.from );

                if( pass2.shortCircuit ){ return pass2.value }
            }

            if( hasBest )
            {
                if( ctx.unionProbe )
                {
                    ctx.unionProbe.stripped += bestStripped;
                    ctx.unionProbe.matched += bestMatched;
                }

                return accept( bestVal );
            }

            if( hasFallback )
            {
                return accept( fallbackVal );
            }
        }
        else
        {
            let fallbackVal: any;
            let hasFallback = false;

            const runOrderedPass = ( fromOpt: FromOption | undefined ): { matched : boolean, value? : any } =>
            {
                for( let i = 0; i < checks.length; i++ )
                {
                    const isFallback = Boolean( fallbackFlags && fallbackFlags[i]);

                    if( isFallback && hasFallback ){ continue }

                    const armProbe = ctx.mode === 'strip' && ctx.unionProbe ? { stripped : 0, matched : 0 } : undefined;
                    subCtx.success = true;
                    subCtx.errors.length = 0;
                    subCtx.from = fromOpt;
                    subCtx.unionProbe = armProbe;
                    const val = checks[i]( v, path, subCtx );

                    if( subCtx.success )
                    {
                        if( isFallback && !fromOpt && ctx.from )
                        {
                            fallbackVal = val;
                            hasFallback = true;
                            continue;
                        }

                        if( armProbe && ctx.unionProbe )
                        {
                            ctx.unionProbe.stripped += armProbe.stripped;
                            ctx.unionProbe.matched += armProbe.matched;
                        }

                        return { matched : true, value : accept( val ) };
                    }

                    unionErrors.push( ...subCtx.errors );
                }

                return { matched : false };
            };

            const pass1 = runOrderedPass( undefined );

            if( pass1.matched ){ return pass1.value }

            if( ctx.from )
            {
                unionErrors.length = 0;
                const pass2 = runOrderedPass( ctx.from );

                if( pass2.matched ){ return pass2.value }

                if( hasFallback ){ return accept( fallbackVal ) }
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

    tuple : ( v: any, path: string, ctx: ValidationContext, checks: Function[], minItems?: number, restValidator?: Function ) => 
    {
        const minLen = minItems !== undefined ? minItems : checks.length;
        const maxLen = restValidator ? Infinity : checks.length;
        const lengthValid = ( arr: any[]): boolean => arr.length >= minLen && arr.length <= maxLen;

        if( !Array.isArray( v ) || !lengthValid( v )) 
        {
            if( typeof ctx.from === 'function' )
            {
                const converted = fromCustom( ctx, path, v, 'tuple' );

                if( Array.isArray( converted ) && lengthValid( converted ))
                {
                    v = converted;
                }
                else 
                {
                    report( ctx, path, `Tuple<${minLen}>`, v );

                    return v;
                }
            }
            else 
            {
                report( ctx, path, `Tuple<${minLen}>`, v );

                return v;
            }
        }

        const fixedCount = Math.min( v.length, checks.length );

        if( shouldMutate( ctx ))
        {
            for( let i = 0; i < fixedCount; i++ )
            {
                if( i >= minLen && v[i] === undefined ){ continue }

                const next = checks[i]( v[i], indexPath( path, i ), ctx );

                if( !Object.is( v[i], next )){ v[i] = next }
            }

            if( restValidator )
            {
                for( let i = fixedCount; i < v.length; i++ )
                {
                    const next = restValidator( v[i], indexPath( path, i ), ctx );

                    if( !Object.is( v[i], next )){ v[i] = next }
                }
            }

            return v;
        }

        const data: any[] = [];

        for( let i = 0; i < fixedCount; i++ )
        {
            if( i >= minLen && v[i] === undefined )
            {
                data[i] = undefined;
                continue;
            }

            data[i] = checks[i]( v[i], indexPath( path, i ), ctx );
        }

        if( restValidator )
        {
            for( let i = fixedCount; i < v.length; i++ )
            {
                data[i] = restValidator( v[i], indexPath( path, i ), ctx );
            }
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
        const probe = ctx.mode === 'strip' ? ctx.unionProbe : undefined;
        let matched = 0;

        for( const key of Object.keys( v )) 
        {
            const val = v[key];

            if( probe && val !== undefined ){ matched++ }

            const next = childValidator( val, childPath( path, key ), ctx );

            if( !mutate || !Object.is( val, next ))
            {
                setOwnProperty( data, key, next );
            }
        }

        if( probe && ctx.success ){ probe.matched += matched }

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
            else if( wantsQuery( ctx ))
            {
                if( v === undefined || v === null || ( isPlainObject( v ) && Object.keys( v ).length === 0 ))
                {
                    v = new Set();
                }
                else
                {
                    v = new Set([v]);
                }
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
        let index = 0;

        if( shouldMutate( ctx ))
        {
            const nextItems: any[] = [];
            let changed = false;

            for( const item of v )
            {
                const next = childValidator( item, `${path}[${index}]`, ctx );
                nextItems.push( next );

                if( !Object.is( item, next )){ changed = true }

                index++;
            }

            if( changed )
            {
                v.clear();

                for( const item of nextItems ){ v.add( item ) }
            }

            return v;
        }

        const data = new Set();

        for( const item of v )
        {
            data.add( childValidator( item, `${path}[${index}]`, ctx ));
            index++;
        }

        return data;
    },

    map : ( v: any, path: string, ctx: ValidationContext, keyValidator: Function, valueValidator: Function, message?: string ) => 
    {
        const revivedFromObject = !( v instanceof Map );

        if( !( v instanceof Map )) 
        {
            if( wantsQuery( ctx ) && ( v === undefined || v === null ))
            {
                v = new Map();
            }
            else if( wantsJsonRevive( ctx ) && ( isPlainObject( v ) || ( wantsQuery( ctx ) && Array.isArray( v )))) 
            {
                const entries: [ string, any ][] = [];

                for( const k of Object.keys( v ))
                {
                    if( v[k] !== undefined ){ entries.push([ k, v[k] ]) }
                }

                v = new Map( entries );
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

        const prevFrom = ctx.from;
        const runKey = ( key: any ) =>
        {
            if( revivedFromObject && prevFrom === 'json' )
            {
                ctx.from = 'string';

                try
                {
                    return keyValidator( key, `${path}.key(${key})`, ctx );
                }
                finally
                {
                    ctx.from = prevFrom;
                }
            }

            return keyValidator( key, `${path}.key(${key})`, ctx );
        };

        if( shouldMutate( ctx ))
        {
            const nextEntries: [ any, any ][] = [];
            let changed = false;

            for( const [ key, val ] of v.entries())
            {
                const validatedKey = runKey( key );
                const validatedVal = valueValidator( val, `${path}[${key}]`, ctx );
                nextEntries.push([ validatedKey, validatedVal ]);

                if( !Object.is( key, validatedKey ) || !Object.is( val, validatedVal )){ changed = true }
            }

            if( changed )
            {
                v.clear();

                for( const [ validatedKey, validatedVal ] of nextEntries ){ v.set( validatedKey, validatedVal ) }
            }

            return v;
        }

        const data = new Map();

        for( const [ key, val ] of v.entries())
        {
            const validatedKey = runKey( key );
            const validatedVal = valueValidator( val, `${path}[${key}]`, ctx );
            data.set( validatedKey, validatedVal );
        }

        return data;
    }
};

export function is( validator: Function, value: any, options?: ValidationMode | GuardOptions ): boolean
{
    const opt = options;
    const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
    const from = typeof opt === 'object' ? opt?.from : undefined;
    const unionResolution = typeof opt === 'object' ? opt?.unionResolution : undefined;
    const ctx: ValidationContext = { success : true, errors : [], mode, from, mutate : true, root : value, unionResolution };
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
    const unionResolution = typeof opt === 'object' ? opt?.unionResolution : undefined;
    const ctx: ValidationContext = { success : true, errors : [], mode, from, mutate, root : value, transform, unionResolution };
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
    const unionResolution = typeof opt === 'object' ? opt?.unionResolution : undefined;
    const ctx: ValidationContext = { success : true, errors : [], mode, from, mutate : true, root : value, unionResolution };
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

export function validate<T = any>( validator: Function, value: any, options?: ValidationMode | ValidationOptions ): IValidation<T>
{
    const opt = options;
    const mode = typeof opt === 'string' ? opt : ( opt?.mode || 'strict' );
    const from = typeof opt === 'object' ? opt?.from : undefined;
    const mutate = typeof opt === 'object' ? opt?.mutate === true : false;
    const transform = typeof opt === 'object' ? opt?.transform : undefined;
    const unionResolution = typeof opt === 'object' ? opt?.unionResolution : undefined;
    const ctx: ValidationContext = { success : true, errors : [], mode, from, mutate, root : value, transform, unionResolution };
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

export { compileSchema, getOrCompileSchema } from './schema-compiler.js';

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

export interface StandardSchemaV1<Input = unknown, Output = Input>
{
    readonly '~standard' : StandardSchemaV1.Props<Input, Output>
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StandardSchemaV1
{
    export interface Props<Input = unknown, Output = Input>
    {
        readonly version  : 1
        readonly vendor   : 'webergency-typechecker'
        readonly validate : (
            value: unknown
        ) => Result<Output> | Promise<Result<Output>>
        readonly types? : Types<Input, Output>
    }

    export type Result<Output> = SuccessResult<Output> | FailureResult;

    export interface SuccessResult<Output>
    {
        readonly value   : Output
        readonly issues? : undefined
    }

    export interface FailureResult
    {
        readonly issues : ReadonlyArray<Issue>
    }

    export interface Issue
    {
        readonly message : string
        readonly path?   : ReadonlyArray<PropertyKey | PathSegment>
    }

    export interface PathSegment
    {
        readonly key : PropertyKey
    }

    export interface Types<Input = unknown, Output = Input>
    {
        readonly input  : Input
        readonly output : Output
    }
}

export function toStandardSchemaIssues( errors: IValidationError[]): StandardSchemaV1.Issue[]
{
    const issues: StandardSchemaV1.Issue[] = [];

    const visit = ( list: IValidationError[]) =>
    {
        for( const err of list )
        {
            const pathSegments = zodPathSegments( err.path );
            issues.push({
                message : err.error,
                ...( pathSegments.length > 0 ? { path : pathSegments } : {})
            });

            if( err.issues?.length ){ visit( err.issues ) }
        }
    };

    visit( errors );

    return issues;
}

export function createStandardSchema<T = unknown, Input = T>(
    validator : Function,
    options?  : ValidationMode | ValidationOptions
): StandardSchemaV1<Input, T>
{
    return {
        '~standard' : {
            version : 1,
            vendor  : 'webergency-typechecker',
            validate( value: unknown ): StandardSchemaV1.Result<T>
            {
                const res = validate<T>( validator, value, options );

                if( res.success )
                {
                    return { value : res.data };
                }

                return { issues : toStandardSchemaIssues( res.errors ) };
            }
        }
    };
}

export interface CompiledValidator<T = unknown, Input = T> extends StandardSchemaV1<Input, T>
{
    ( input: unknown, options?: ValidationMode | ValidationOptions ) : IValidation<T>
    validate    : ( input: unknown, options?: ValidationMode | ValidationOptions ) => IValidation<T>
    is          : ( input: unknown, options?: ValidationMode | GuardOptions ) => input is T
    assert      : ( input: unknown, options?: ValidationMode | AssertOptions ) => T
    assertGuard : ( input: unknown, options?: ValidationMode | AssertGuardOptions ) => void
}

function mergeValidationOptions<O extends GuardOptions>(
    defaults? : ValidationMode | O,
    override? : ValidationMode | O
): ValidationMode | O | undefined
{
    if( override === undefined ){ return defaults }

    if( defaults === undefined ){ return override }

    const baseObj = typeof defaults === 'string' ? { mode : defaults } : defaults;
    const overObj = typeof override === 'string' ? { mode : override } : override;

    return { ...baseObj, ...overObj } as O;
}

export function createValidator<T = unknown, Input = T>(
    validator : Function,
    options?  : ValidationMode | ValidationOptions
): CompiledValidator<T, Input>
{
    const fn = (( input: unknown, overrideOptions?: ValidationMode | ValidationOptions ): IValidation<T> =>
        validate<T>( validator, input, mergeValidationOptions( options, overrideOptions ))
    ) as CompiledValidator<T, Input>;

    fn.validate = fn;
    fn.is = ( input: unknown, overrideOptions?: ValidationMode | GuardOptions ): input is T =>
        is( validator, input, mergeValidationOptions( options, overrideOptions ));
    fn.assert = ( input: unknown, overrideOptions?: ValidationMode | AssertOptions ): T =>
        assert( validator, input, mergeValidationOptions( options as AssertOptions | ValidationMode | undefined, overrideOptions ));
    fn.assertGuard = ( input: unknown, overrideOptions?: ValidationMode | AssertGuardOptions ): void =>
        assertGuard( validator, input, mergeValidationOptions( options as AssertGuardOptions | ValidationMode | undefined, overrideOptions ));

    Object.defineProperty( fn, '~standard', {
        value        : createStandardSchema<T, Input>( validator, options )['~standard'],
        writable     : true,
        configurable : true,
        enumerable   : false
    });

    return fn;
}



