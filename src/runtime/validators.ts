/** Controls unknown object keys only — not coercion. Use `from` for conversion. */
export type ValidationMode = 'strict' | 'relaxed' | 'strip';

export interface IValidationError {
    path     : string
    value    : any
    error    : string
    /** Nested failures (e.g. per-arm errors for a failed union). */
    issues?  : IValidationError[]
}

/** Expected runtime kind for custom `from` — a dispatch tag, not `typeof` / a TS type. */
export type CoercionKind =
    | 'string' | 'number' | 'boolean' | 'bigint' | 'function' | 'symbol' | 'never'
    | 'Date' | 'RegExp' | 'Set' | 'Map' | 'Array' | 'Object' | 'instance'
    | 'null' | 'undefined' | 'tuple' | 'literal';

/** Shared context for `constraint.Custom` and custom `from` callbacks. */
export interface PathContext {
    /** Nearest named property; for `[n]` leaves, the closest named segment above. */
    key     : string
    path    : string
    parent  : any
    root    : any
    /** Set when the leaf path segment is an array index. */
    index?  : number
}

export type FromCoercionContext = PathContext & { kind : CoercionKind }

type FromOption = 'json' | 'query' | (( val: any, ctx: FromCoercionContext ) => any );

export interface ValidationContext {
    success     : boolean
    errors      : IValidationError[]
    mode        : ValidationMode
    from?       : FromOption
    mutate?     : boolean
    root?       : any
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
    mode?         : ValidationMode
    from?         : FromOption
}

/** Options for `assertGuard` / `assertGuardSchema`. */
export interface AssertGuardOptions extends GuardOptions {
    errorFactory? : ( errors: IValidationError[]) => Error
}

/** Options for `validate` / `validateSchema`. */
export interface ValidationOptions extends GuardOptions {
    /** `true`: write in place while validating. `false` (default): allocate new containers. */
    mutate?       : boolean
}

/** Options for `assert` / `assertSchema`. */
export interface AssertOptions extends ValidationOptions {
    errorFactory? : ( errors: IValidationError[]) => Error
}


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

const regexSafetyCache = new WeakMap<RegExp, boolean>();

function isSafeRegexSource( source: string ): boolean
{
    if( source.length > 1024 || /\\[1-9]/.test( source )){ return false }

    const groups: { hasRepeat : boolean, hasAlternation : boolean }[] = [];
    let inClass = false;
    let escaped = false;

    for( let i = 0; i < source.length; i++ )
    {
        const ch = source[i];

        if( escaped )
        {
            escaped = false;
            continue;
        }

        if( ch === '\\' )
        {
            escaped = true;
            continue;
        }

        if( ch === '[' )
        {
            inClass = true;
            continue;
        }

        if( ch === ']' && inClass )
        {
            inClass = false;
            continue;
        }

        if( inClass ){ continue }

        if( ch === '(' )
        {
            groups.push({ hasRepeat : false, hasAlternation : false });
            continue;
        }

        if( ch === '|' && groups.length > 0 )
        {
            groups[groups.length - 1].hasAlternation = true;
            continue;
        }

        if( ch === '*' || ch === '+' || ch === '{' )
        {
            if( groups.length > 0 ){ groups[groups.length - 1].hasRepeat = true }
            continue;
        }

        if( ch === ')' && groups.length > 0 )
        {
            const group = groups.pop()!;
            const next = source[i + 1];
            const isRepeated = next === '*' || next === '+' || next === '{';

            if( isRepeated && ( group.hasRepeat || group.hasAlternation )){ return false }

            if( isRepeated && groups.length > 0 ){ groups[groups.length - 1].hasRepeat = true }
        }
    }

    return true;
}

function isRegexSafe( regex: RegExp ): boolean
{
    const cached = regexSafetyCache.get( regex );

    if( cached !== undefined ){ return cached }

    const safe = isSafeRegexSource( regex.source );
    regexSafetyCache.set( regex, safe );

    return safe;
}

function createSafeRegex( source: string, flags?: string ): RegExp
{
    if( !isSafeRegexSource( source )){ throw new Error( `Unsafe regular expression: ${source}` ) }

    const regex = flags === undefined ? new RegExp( source ) : new RegExp( source, flags );
    regexSafetyCache.set( regex, true );

    return regex;
}

function testRegex( regex: RegExp, value: string ): boolean 
{
    if( !regex.global && !regex.sticky ) { return regex.test( value ) }

    const copy = new RegExp( regex.source, regex.flags );

    return copy.test( value );
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

function wantsQuery( ctx: ValidationContext ): boolean
{
    return ctx.from === 'query';
}

function wantsJsonRevive( ctx: ValidationContext ): boolean
{
    return ctx.from === 'json' || ctx.from === 'query';
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

/** Query-style number coercion — shared by `from: 'query'` and `transform.ToNumber`. */
export function coerceQueryNumber( v: any ): any
{
    if( typeof v === 'number' ){ return v }

    if( typeof v === 'string' && v.trim() !== '' )
    {
        const normalized = v.trim();

        if( !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test( normalized )){ return v }

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

    if( value instanceof Date ){ return mixNumberHash( 0x60000000, value.getTime() ) >>> 0 }

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
    safeRegExp : createSafeRegex,
    assign : ( target: any, source: any ) =>
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
                v[i] = childValidator( v[i], path + '[' + i + ']', ctx );
            }

            return v;
        }

        const data: any[] = [];

        for( let i = 0; i < v.length; i++ )
        {
            data[i] = childValidator( v[i], path + '[' + i + ']', ctx );
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

            const result = validator( val, path + '.' + key, ctx );

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

    stripExtras : ( data: any, ctx: ValidationContext, allowedKeys?: string[] | Set<string>) => 
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

            setOwnProperty( data, key, childValidator( v[key], path + '.' + key, ctx ));
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

                    let bucket = collisionBuckets.get( hash );

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
                v[i] = checks[i]( v[i], path + '[' + i + ']', ctx );
            }

            return v;
        }

        const data: any[] = [];

        for( let i = 0; i < checks.length; i++ )
        {
            data[i] = checks[i]( v[i], path + '[' + i + ']', ctx );
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
            setOwnProperty( data, key, childValidator( v[key], path + '.' + key, ctx ));
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

const compiledSchemas = new WeakMap<object, Function>();

export function getOrCompileSchema( schema: any ): Function
{
    if( typeof schema === 'boolean' ){ return compileSchema( schema ) }

    if( typeof schema !== 'object' || schema === null )
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
    const ctx: ValidationContext = { success : true, errors : [], mode, from, mutate, root : value };
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
    const ctx: ValidationContext = { success : true, errors : [], mode, from, mutate, root : value };
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

const UNSUPPORTED_SCHEMA_KEYWORDS =
[
    'enum',
    'oneOf',
    'not',
    'if',
    'then',
    'else',
    'patternProperties',
    'propertyNames',
    'dependencies',
    'dependentRequired',
    'dependentSchemas',
    'contains',
    'minContains',
    'maxContains',
    'prefixItems',
    'unevaluatedProperties',
    'unevaluatedItems'
];

export function compileSchema( schema: any ): ( v: any, path: string, ctx: any ) => any 
{
    const rootDefs = schema.$defs || schema.definitions || {};
    const compiledDefs = new Map<string, any>();

    function build( subSchema: any ): ( v: any, path: string, ctx: any ) => any 
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

        if( !subSchema || typeof subSchema !== 'object' )
        {
            throw new Error( 'Invalid JSON Schema: subschemas must be objects or booleans' );
        }

        for( const keyword of UNSUPPORTED_SCHEMA_KEYWORDS )
        {
            if( keyword in subSchema )
            {
                throw new Error( `Unsupported JSON Schema keyword: ${keyword}` );
            }
        }

        if( Array.isArray( subSchema.type ))
        {
            throw new Error( 'Unsupported JSON Schema keyword: type arrays' );
        }

        if( typeof subSchema.type === 'string' &&
            !['string', 'number', 'integer', 'boolean', 'null', 'array', 'object'].includes( subSchema.type ))
        {
            throw new Error( `Unsupported JSON Schema type: ${subSchema.type}` );
        }

        if( subSchema.$ref ) 
        {
            const refPath = subSchema.$ref;

            if( compiledDefs.has( refPath )) 
            {
                return ( v, path, ctx ) => compiledDefs.get( refPath )( v, path, ctx );
            }

            const parts = refPath.split( '/' );
            const defName = parts[parts.length - 1];
            const targetSchema = rootDefs[defName];

            if( !targetSchema ) 
            {
                throw new Error( `Schema reference not found: ${refPath}` );
            }

            let resolved: any = null;
            const proxy = ( v: any, path: string, ctx: any ) => 
            {
                if( !resolved ) 
                {
                    resolved = build( targetSchema );
                }

                return resolved( v, path, ctx );
            };

            compiledDefs.set( refPath, proxy );

            return proxy;
        }

        if( subSchema['x-typescript-type'] === 'Date' ) 
        {
            return ( v, path, ctx ) => validators.date( v, path, ctx );
        }

        if( subSchema['x-typescript-type'] === 'RegExp' ) 
        {
            return ( v, path, ctx ) => validators.regexp( v, path, ctx );
        }

        if( subSchema['x-typescript-type'] === 'bigint' ) 
        {
            return ( v, path, ctx ) => validators.bigint( v, path, ctx );
        }

        if( subSchema['x-typescript-type'] === 'undefined' ) 
        {
            return ( v, path, ctx ) => validators.undefined( v, path, ctx );
        }

        if( subSchema['x-typescript-type'] === 'Set' ) 
        {
            const child = build( subSchema.items || {});

            return ( v, path, ctx ) => validators.set( v, path, ctx, child );
        }

        if( subSchema['x-typescript-type'] === 'Map' ) 
        {
            const keyCheck = build( subSchema.key || { type : 'string' });
            const valueCheck = build( subSchema.value || {});

            return ( v, path, ctx ) => validators.map( v, path, ctx, keyCheck, valueCheck );
        }

        if( subSchema['x-typescript-type'] === 'Promise' ) 
        {
            return ( v, path, ctx ) => 
            {
                if( !( v instanceof Promise )) 
                {
                    report( ctx, path, 'Type<Promise>', v );
                }

                return v;
            };
        }

        if( typeof subSchema['x-typescript-type'] === 'string' &&
            ['Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Buffer'].includes( subSchema['x-typescript-type'])) 
        {
            const typeName = subSchema['x-typescript-type'] as string;

            return ( v, path, ctx ) => 
            {
                const ctor = ( globalThis as any )[typeName];

                if( !ctor || !( v instanceof ctor )) 
                {
                    report( ctx, path, `Type<${typeName}>`, v );
                }

                return v;
            };
        }

        if( 'x-typescript-type' in subSchema )
        {
            throw new Error( `Unsupported x-typescript-type: ${subSchema['x-typescript-type']}` );
        }

        if( subSchema.allOf ) 
        {
            const checks = subSchema.allOf.map(( s: any ) => build( s ));
            const mergeKeys = subSchema.allOf.map(( s: any ) =>
            {
                if( s?.type !== 'object' ||
                    ( 'additionalProperties' in s && s.additionalProperties !== false ))
                {
                    return undefined;
                }

                return new Set<string>( Object.keys( s.properties || {}));
            });
            const allObjectSchemas = subSchema.allOf.length > 0 &&
                subSchema.allOf.every(( s: any ) => s?.type === 'object' );
            const allowsAdditional = !allObjectSchemas ||
                subSchema.allOf.some(( s: any ) =>
                    'additionalProperties' in s && s.additionalProperties !== false
                );
            const combinedKeys = allowsAdditional
                ? undefined
                : new Set<string>( subSchema.allOf.flatMap(( s: any ) => Object.keys( s.properties || {})));

            return ( v, path, ctx ) => 
            {
                const errors: IValidationError[] = [];
                let data: any = undefined;
                const subCtx: ValidationContext =
                {
                    success : true,
                    errors  : [],
                    mode    : 'relaxed',
                    from    : ctx.from,
                    mutate  : false,
                    root    : ctx.root
                };

                for( let i = 0; i < checks.length; i++ )
                {
                    const check = checks[i];
                    subCtx.success = true;
                    subCtx.errors.length = 0;
                    subCtx.from = ctx.from;
                    subCtx.root = ctx.root;
                    const val = check( v, path, subCtx );

                    errors.push( ...subCtx.errors );

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
                    }
                }

                if( !ctx.success ){ return v }

                if( shouldMutate( ctx ) && commitContainer( v, data )){ return v }

                return data === undefined ? v : data;
            };
        }

        if( subSchema.type === 'string' ) 
        {
            const minLength = subSchema.minLength;
            const maxLength = subSchema.maxLength;
            const pattern = subSchema.pattern ? createSafeRegex( subSchema.pattern ) : undefined;
            const patternStr = subSchema.pattern;
            const format = subSchema.format;

            return ( v, path, ctx ) => 
            {
                v = validators.string( v, path, ctx );

                if( v === undefined || v === null ) { return v }

                if( minLength !== undefined ) { validators.minLength( v, path, ctx, minLength ) }

                if( maxLength !== undefined ) { validators.maxLength( v, path, ctx, maxLength ) }

                if( pattern !== undefined ) { validators.pattern( v, path, ctx, pattern, patternStr ) }

                if( format !== undefined ) { v = validators.format( v, path, ctx, format ) }

                return v;
            };
        }

        if( subSchema.type === 'number' || subSchema.type === 'integer' ) 
        {
            const isInt = subSchema.type === 'integer';
            const minimum = subSchema.minimum;
            const maximum = subSchema.maximum;
            const exclusiveMinimum = subSchema.exclusiveMinimum;
            const exclusiveMaximum = subSchema.exclusiveMaximum;
            const multipleOf = subSchema.multipleOf;

            return ( v, path, ctx ) => 
            {
                v = validators.number( v, path, ctx );

                if( v === undefined || v === null ) { return v }

                if( isInt && typeof v === 'number' && !Number.isInteger( v )) 
                {
                    report( ctx, path, 'Type<integer>', v );
                }

                if( minimum !== undefined ) { validators.minimum( v, path, ctx, minimum ) }

                if( maximum !== undefined ) { validators.maximum( v, path, ctx, maximum ) }

                if( exclusiveMinimum !== undefined ) { validators.exclusiveMinimum( v, path, ctx, exclusiveMinimum ) }

                if( exclusiveMaximum !== undefined ) { validators.exclusiveMaximum( v, path, ctx, exclusiveMaximum ) }

                if( multipleOf !== undefined ) { validators.multipleOf( v, path, ctx, multipleOf ) }

                return v;
            };
        }

        if( subSchema.type === 'boolean' ) 
        {
            return ( v, path, ctx ) => validators.boolean( v, path, ctx );
        }

        if( subSchema.type === 'null' ) 
        {
            return ( v, path, ctx ) => validators.null( v, path, ctx );
        }

        if( subSchema.anyOf ) 
        {
            const checks = subSchema.anyOf.map(( s: any ) => build( s ));

            return ( v, path, ctx ) => validators.union( v, path, ctx, checks );
        }

        if( subSchema.type === 'array' ) 
        {
            if( Array.isArray( subSchema.items )) 
            {
                const checks = subSchema.items.map(( s: any ) => build( s ));

                return ( v, path, ctx ) => validators.tuple( v, path, ctx, checks );
            }
            else 
            {
                const check = build( subSchema.items );
                const minItems = subSchema.minItems;
                const maxItems = subSchema.maxItems;
                const uniqueItems = subSchema.uniqueItems;

                return ( v, path, ctx ) => 
                {
                    v = validators.array( v, path, ctx, check );

                    if( Array.isArray( v )) 
                    {
                        if( minItems !== undefined ) { validators.minItems( v, path, ctx, minItems ) }

                        if( maxItems !== undefined ) { validators.maxItems( v, path, ctx, maxItems ) }

                        if( uniqueItems ) { validators.uniqueItems( v, path, ctx ) }
                    }

                    return v;
                };
            }
        }

        if( subSchema.type === 'object' ) 
        {
            const props = Object.entries( subSchema.properties || {});
            const required = subSchema.required || [];
            const propVals = props.map(([key, s]: [string, any]) => 
            {
                const isOptional = !required.includes( key );
                const check = build( s );

                return [key, isOptional, check] as [string, boolean, any];
            });

            const knownKeys = new Set<string>( Object.keys( subSchema.properties || {}));
            const additional = 'additionalProperties' in subSchema
                ? subSchema.additionalProperties
                : false;
            const strictKeys = additional === false ? knownKeys : undefined;
            const additionalCheck = additional && typeof additional === 'object' ? build( additional ) : undefined;
            // `additionalProperties: true` keeps unknown keys without validating them, so only then does
            // the shell have to carry them over.
            const closedShape = additional === false || !!additionalCheck;

            return ( v, path, ctx ) => 
            {
                const obj = validators.object( v, path, ctx, strictKeys, 'Object' );

                if( obj === false ){ return v }
                const data = validators.objectShell( obj, ctx, closedShape );
                validators.props( obj, data, path, ctx, propVals );

                if( additionalCheck ) 
                {
                    validators.additionalProps( obj, data, path, ctx, knownKeys, additionalCheck );
                }
                else if( additional === false ) 
                {
                    validators.stripExtras( data, ctx, knownKeys );
                }

                return data;
            };
        }

        if( subSchema.const !== undefined ) 
        {
            const expected = subSchema.const;

            return ( v, path, ctx ) => 
            {
                if( v !== expected ) 
                {
                    report( ctx, path, `Const<${JSON.stringify( expected )}>`, v );
                }

                return v;
            };
        }

        return ( v ) => v;
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

