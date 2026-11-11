import {
    validators,
    isMultipleOfNumber,
    hasUniqueItems,
    isPlainObject,
    findExclusiveKeyArm,
    assignBracketPair,
    extractFormDataObject,
    extractHeadersObject,
    MAX_BRACKET_KEYS,
    splitHeaderList,
    formatConstraintMessage,
    isMinDateValid,
    isMaxDateValid,
    splitStringValue,
    type CoercionKind,
    type StandardSchemaV1,
    type ValidationMode,
    type UnionResolution
} from './validators.js';
export { formatConstraintMessage, validators };
import { getCachedPattern, testRegex } from './regex.js';
export { getCachedPattern, testRegex };
import { resolvePath, hasPath, tokenizePath, isIndexSegment } from './path.js';
import type { CasingFormat } from './casing.js';
import
{
    applyNodeTransform,
    reviveTree as walkRevive,
    TransformWalkError,
    type JsonReviver,
    type TransformFn
}
    from './transform.js';

export interface FormDataLike
{
    entries() : IterableIterator<[string, unknown]>
    getAll( name: string ) : unknown[]
}

export interface HeadersLike
{
    entries()       : IterableIterator<[string, string]>
    getSetCookie?() : string[]
}

export type HeadersInput =
    | HeadersLike
    | Record<string, unknown>
    | ReadonlyArray<readonly [string, string]>;

export type ParseSource = 'json' | 'query' | 'string' | 'formData' | 'headers';

export type ParseInput = string | FormDataLike | HeadersInput;

export class ParseError extends Error
{
    public readonly path : string;

    public constructor( path: string, message: string )
    {
        super( path ? `Parse error at "${path}": ${message}` : `Parse error: ${message}` );
        this.name = 'ParseError';
        this.path = path;
    }
}

export interface SafeParseSuccess<T>
{
    success : true
    data    : T
    error?  : undefined
}

export interface SafeParseFailure
{
    success : false
    data?   : undefined
    error   : ParseError
}

export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

export function safeParse<T>(
    parserFn : ( input: unknown, options?: any ) => T,
    input    : unknown,
    options? : any
): SafeParseResult<T>
{
    try
    {
        return { success : true, data : parserFn( input, options ) };
    }
    catch( e )
    {
        if( e instanceof ParseError )
        {
            return { success : false, error : e };
        }

        return {
            success : false,
            error   : new ParseError( '', e instanceof Error ? e.message : String( e ))
        };
    }
}

function parseErrorCode( err: ParseError ): string
{
    const prefix = err.path ? `Parse error at "${err.path}": ` : 'Parse error: ';

    if( err.message.startsWith( prefix )){ return err.message.slice( prefix.length ) }

    return err.message;
}

export function expectString( v: any, path: string ): string
{
    if( typeof v !== 'string' ){ throw new ParseError( path, 'Type<string>' ) }

    return v;
}

export function expectNumber( v: any, path: string ): number
{
    if( typeof v !== 'number' || Number.isNaN( v )){ throw new ParseError( path, 'Type<number>' ) }

    return v;
}

export function expectBoolean( v: any, path: string ): boolean
{
    if( typeof v !== 'boolean' ){ throw new ParseError( path, 'Type<boolean>' ) }

    return v;
}

export function expectObject( v: any, path: string ): object
{
    if( !isPlainObject( v ))
    {
        throw new ParseError( path, 'Type<Object>' );
    }

    return v;
}

export function expectArray( v: any, path: string ): any[]
{
    if( !Array.isArray( v )){ throw new ParseError( path, 'Type<Array>' ) }

    return v;
}

export function expectFile( v: any, path: string ): File
{
    if( !( v instanceof File )){ throw new ParseError( path, 'Type<File>' ) }

    return v;
}

export function expectBlob( v: any, path: string ): Blob
{
    if( !( v instanceof Blob )){ throw new ParseError( path, 'Type<Blob>' ) }

    return v;
}

function redactSecretText( text: string, rawVal: any ): string
{
    if( typeof rawVal !== 'string' || rawVal.length === 0 ){ return text }

    let out = text.includes( rawVal ) ? text.split( rawVal ).join( '[REDACTED]' ) : text;
    const trimmed = rawVal.trim();

    if( trimmed.length > 0 && out.includes( trimmed ))
    {
        out = out.split( trimmed ).join( '[REDACTED]' );
    }

    return out;
}

let parseSecretDepth = 0;

export function formatParseMessage( template: string, path: string, value: any ): string
{
    return formatConstraintMessage( template, path, value, parseSecretDepth > 0 );
}

function resolveParseMsg( msg: string | undefined, fallback: string, path: string, val: any ): string
{
    return msg !== undefined ? formatConstraintMessage( msg, path, val, parseSecretDepth > 0 ) : fallback;
}

export function redactParseSecret<T>( fn: () => T, rawVal: any, path: string = '' ): T
{
    parseSecretDepth++;

    try
    {
        return fn();
    }
    catch( e )
    {
        if( e instanceof ParseError )
        {
            const rawCode = parseErrorCode( e );
            const redacted = redactSecretText( rawCode, rawVal );

            if( redacted !== rawCode )
            {
                throw new ParseError( e.path, redacted );
            }

            throw e;
        }

        const rawMsg = e instanceof Error ? e.message : String( e );

        throw new ParseError( path, redactSecretText( rawMsg, rawVal ));
    }
    finally
    {
        parseSecretDepth--;
    }
}

export interface ParseProbeFrame
{
    stripped : number
    matched  : number
}

export interface ParseProbeContext
{
    readonly stack : ParseProbeFrame[]
}

let parseProbeStack: ParseProbeFrame[] = [];

export function createParseProbeContext(): ParseProbeContext
{
    return { stack : [] };
}

export function runWithParseProbeContext<T>( ctx: ParseProbeContext, fn: () => T ): T
{
    const prev = parseProbeStack;
    parseProbeStack = ctx.stack;

    try
    {
        return fn();
    }
    finally
    {
        parseProbeStack = prev;
    }
}

export function hasParseUnionProbe( ctx?: ParseProbeContext ): boolean
{
    const stack = ctx ? ctx.stack : parseProbeStack;

    return stack.length > 0;
}

export function recordParseObjectStats( stripped: number, matched: number, ctx?: ParseProbeContext ): void
{
    const stack = ctx ? ctx.stack : parseProbeStack;
    const top = stack[stack.length - 1];

    if( top )
    {
        top.stripped += stripped;
        top.matched += matched;
    }
}

let parseUnionProbeDepth = 0;
let savedParseStackTraceLimit = 10;

function enterParseUnionProbe(): void
{
    if( parseUnionProbeDepth++ === 0 )
    {
        savedParseStackTraceLimit = Error.stackTraceLimit;
        Error.stackTraceLimit = 0;
    }
}

function exitParseUnionProbe(): void
{
    if( --parseUnionProbeDepth === 0 )
    {
        Error.stackTraceLimit = savedParseStackTraceLimit;
    }
}

export function parseUnion(
    v             : any,
    path          : string,
    expected      : string,
    arms          : Array<( v: any, p: string ) => any>,
    probeBestFit  : boolean = false,
    fallbackFlags?: boolean[],
    exclusiveKeys?: string[]
): any
{
    let last: ParseError | undefined;
    const matchedIdx = findExclusiveKeyArm( v, exclusiveKeys );

    if( matchedIdx >= 0 )
    {
        arms = [ arms[matchedIdx] ];
        probeBestFit = false;
    }

    if( !probeBestFit )
    {
        const top = parseProbeStack.length > 0 ? parseProbeStack[parseProbeStack.length - 1] : undefined;
        enterParseUnionProbe();

        try
        {
            for( const arm of arms )
            {
                const savedStripped = top ? top.stripped : 0;
                const savedMatched = top ? top.matched : 0;

                try
                {
                    return arm( v, path );
                }
                catch( e )
                {
                    if( top )
                    {
                        top.stripped = savedStripped;
                        top.matched = savedMatched;
                    }

                    if( e instanceof ParseError )
                    {
                        last = e;
                        continue;
                    }

                    throw e;
                }
            }
        }
        finally
        {
            exitParseUnionProbe();
        }

        if( last && parseErrorCode( last ) === expected )
        {
            throw new ParseError( last.path, expected );
        }

        throw new ParseError( path, expected );
    }

    let bestResult: any;
    let hasBest = false;
    let bestStripped = Infinity;
    let bestMatched = -1;
    let fallbackResult: any;
    let hasFallback = false;
    enterParseUnionProbe();

    try
    {
        for( let i = 0; i < arms.length; i++ )
        {
            const isFallback = Boolean( fallbackFlags && fallbackFlags[i]);

            if( isFallback && ( hasBest || hasFallback )){ continue }

            const frame: ParseProbeFrame = { stripped : 0, matched : 0 };
            parseProbeStack.push( frame );

            try
            {
                const res = arms[i]( v, path );
                parseProbeStack.pop();

                if( isFallback )
                {
                    fallbackResult = res;
                    hasFallback = true;
                    continue;
                }

                if( frame.stripped === 0 )
                {
                    recordParseObjectStats( 0, frame.matched );

                    return res;
                }

                if(
                    !hasBest ||
                    frame.stripped < bestStripped ||
                    ( frame.stripped === bestStripped && frame.matched > bestMatched )
                )
                {
                    bestResult = res;
                    hasBest = true;
                    bestStripped = frame.stripped;
                    bestMatched = frame.matched;
                }
            }
            catch( e )
            {
                parseProbeStack.pop();

                if( e instanceof ParseError )
                {
                    last = e;
                    continue;
                }

                throw e;
            }
        }
    }
    finally
    {
        exitParseUnionProbe();
    }

    if( hasBest )
    {
        recordParseObjectStats( bestStripped, bestMatched );

        return bestResult;
    }

    if( hasFallback )
    {
        return fallbackResult;
    }

    if( last && parseErrorCode( last ) === expected )
    {
        throw new ParseError( last.path, expected );
    }

    throw new ParseError( path, expected );
}

/** decodeURIComponent throws URIError on lone `%` / bad hex; keep the raw segment instead. */
function safeDecodeURIComponent( value: string ): string
{
    try
    {
        return decodeURIComponent( value );
    }
    catch
    {
        return value;
    }
}

/**
 * Parses a URL query string or x-www-form-urlencoded string into a nested JavaScript object structure,
 * handling bracket notation like user[name]=Alice, tags[]=a, and items[0]=b matching server QueryParser.
 * The string must not start with `?` (`url.search.slice(1)` / form body).
 */
export function parseQueryString( querystring: string ): Record<string, any>
{
    const query: any = Object.create( null );

    if( !querystring ){ return query }

    if( querystring.charAt( 0 ) === '?' ){ throw new ParseError( '', 'Invalid query' ) }

    let value, pair, last_pair = 0, paramCount = 0;
    const sep = '&', eq = '=';

    do
    {
        if( ++paramCount > MAX_BRACKET_KEYS ){ break }

        pair = querystring.indexOf( sep, last_pair );

        if( pair === -1 ){ pair = querystring.length }

        if( pair - last_pair > 0 )
        {
            if( ~( value = querystring.indexOf( eq, last_pair )) && value < pair )
            {
                assignBracketPair(
                    query,
                    safeDecodeURIComponent( querystring.substring( last_pair, value ).replace( /\+/g, ' ' )),
                    safeDecodeURIComponent( querystring.substring( value + 1, pair ).replace( /\+/g, ' ' ))
                );
            }
            else
            {
                assignBracketPair(
                    query,
                    safeDecodeURIComponent( querystring.substring( last_pair, pair ).replace( /\+/g, ' ' )),
                    true
                );
            }
        }

        last_pair = pair + 1;
    }
    while( last_pair < querystring.length );

    return query;
}

export function parseFormData( raw: unknown ): Record<string, any>
{
    const out = extractFormDataObject( raw );

    if( !out )
    {
        throw new ParseError( '', 'Input must be FormData' );
    }

    return out;
}

export function parseHeaders( raw: unknown ): Record<string, any>
{
    const out = extractHeadersObject( raw );

    if( !out )
    {
        throw new ParseError( '', 'Input must be Headers, header tuples, or a header object' );
    }

    return out;
}

export function coerceNumber( val: any, path: string ): number
{
    if( typeof val === 'number' && !Number.isNaN( val )){ return val }

    if( typeof val === 'string' && val.trim() !== '' )
    {
        const num = Number( val );

        if( !Number.isNaN( num ) && Number.isFinite( num )){ return num }
    }

    throw new ParseError( path, 'Type<number>' );
}

export function coerceBoolean( val: any, path: string ): boolean
{
    if( typeof val === 'boolean' ){ return val }

    if( typeof val === 'string' || typeof val === 'number' )
    {
        const s = String( val ).toLowerCase();

        if( s === 'true' || s === '1' || s === 'yes' || s === 'on' ){ return true }

        if( s === 'false' || s === '0' || s === 'no' || s === 'off' ){ return false }

        // Flag keys (`active` with no `=`) often arrive as empty string.
        if( s === '' ){ return true }
    }

    throw new ParseError( path, 'Type<boolean>' );
}

export function coerceDate( val: any, path: string ): Date
{
    if( val instanceof Date && !isNaN( val.getTime())){ return val }

    if( typeof val === 'string' || typeof val === 'number' )
    {
        const d = new Date( val );

        if( !isNaN( d.getTime())){ return d }
    }

    throw new ParseError( path, 'Type<Date>' );
}

export function coerceArray<T>( val: any, path: string, mapper: ( item: any, itemPath: string ) => T ): T[]
{
    if( val === undefined || val === null ){ return [] }

    const arr = Array.isArray( val ) ? val : [val];
    const out: T[] = new Array( arr.length );

    for( let i = 0; i < arr.length; i++ )
    {
        out[i] = mapper( arr[i], `${path}[${i}]` );
    }

    return out;
}

export function coerceHeaderArray<T>( val: any, path: string, mapper: ( item: any, itemPath: string ) => T ): T[]
{
    if( val === undefined || val === null ){ return [] }

    const arr = Array.isArray( val ) ? val : typeof val === 'string' ? splitHeaderList( val ) : [val];
    const out: T[] = new Array( arr.length );

    for( let i = 0; i < arr.length; i++ )
    {
        out[i] = mapper( arr[i], `${path}[${i}]` );
    }

    return out;
}

export function mapParseArray<T>( val: any, path: string, mapper: ( item: any, itemPath: string, index: number, arr: any[]) => T ): T[]
{
    const arr = expectArray( val, path );
    const out: T[] = new Array( arr.length );

    for( let i = 0; i < arr.length; i++ )
    {
        out[i] = mapper( arr[i], `${path}[${i}]`, i, arr );
    }

    return out;
}

export function parseSet<T>(
    val    : any,
    path   : string,
    from   : ParseSource,
    mapper : ( item: any, itemPath: string, index: number, items: any[]) => T
): Set<T>
{
    let items: any[];

    if( val instanceof Set )
    {
        items = [ ...val ];
    }
    else if( Array.isArray( val ))
    {
        items = val;
    }
    else if( from === 'headers' && typeof val === 'string' )
    {
        items = splitHeaderList( val );
    }
    else if( from !== 'json' )
    {
        if( val === undefined || val === null ){ return new Set<T>() }

        if( typeof val === 'object' && Object.keys( val ).length === 0 ){ return new Set<T>() }

        items = [ val ];
    }
    else
    {
        throw new ParseError( path, 'Type<Set>' );
    }

    const out = new Set<T>();

    for( let i = 0; i < items.length; i++ )
    {
        out.add( mapper( items[i], `${path}[${i}]`, i, items ));
    }

    return out;
}

export function parseMap<K, V>(
    val       : any,
    path      : string,
    from      : ParseSource,
    keyMapper : ( k: any, keyPath: string ) => K,
    valMapper : ( v: any, valPath: string, key: any, holder: any ) => V
): Map<K, V>
{
    const out = new Map<K, V>();

    if( val instanceof Map )
    {
        for( const [ k, v ] of val.entries())
        {
            const mappedK = keyMapper( k, `${path}.key(${String( k )})` );
            const mappedV = valMapper( v, `${path}[${String( k )}]`, k, null );
            out.set( mappedK, mappedV );
        }

        return out;
    }

    const wantsCoerce = from !== 'json';

    if( wantsCoerce && ( val === undefined || val === null ))
    {
        return out;
    }

    const allowSparseArray = wantsCoerce && Array.isArray( val );

    if( !isPlainObject( val ) && !allowSparseArray )
    {
        throw new ParseError( path, 'Type<Map>' );
    }

    for( const k of Object.keys( val ))
    {
        if( val[k] === undefined ){ continue }

        const mappedK = keyMapper( k, `${path}.key(${k})` );
        const mappedV = valMapper( val[k], `${path}[${k}]`, k, val );
        out.set( mappedK, mappedV );
    }

    return out;
}

const STRICT_PARSE_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeStrictBase64( val: string, path: string, typeName: string ): Uint8Array
{
    const trimmed = val.trim();

    if( !STRICT_PARSE_BASE64_RE.test( trimmed ))
    {
        throw new ParseError( path, `Type<${typeName}>` );
    }

    if( typeof Buffer !== 'undefined' )
    {
        const buf = Buffer.from( trimmed, 'base64' );

        return new Uint8Array( buf.buffer, buf.byteOffset, buf.byteLength );
    }

    const bin = atob( trimmed );
    const out = new Uint8Array( bin.length );

    for( let i = 0; i < bin.length; i++ ){ out[i] = bin.charCodeAt( i ) }

    return out;
}

export function coerceBuffer( val: any, path: string ): Buffer
{
    const hasBuffer = typeof Buffer !== 'undefined';

    if( hasBuffer && Buffer.isBuffer( val )){ return val }

    if( val instanceof Uint8Array )
    {
        return hasBuffer ? Buffer.from( val ) : ( new Uint8Array( val ) as unknown as Buffer );
    }

    if( val instanceof ArrayBuffer || ( typeof SharedArrayBuffer !== 'undefined' && val instanceof SharedArrayBuffer ))
    {
        return hasBuffer ? Buffer.from( new Uint8Array( val )) : ( new Uint8Array( val ) as unknown as Buffer );
    }

    if( ArrayBuffer.isView( val ))
    {
        const view = new Uint8Array( val.buffer, val.byteOffset, val.byteLength );

        return hasBuffer ? Buffer.from( view ) : ( new Uint8Array( view ) as unknown as Buffer );
    }

    if( typeof val === 'string' )
    {
        const bytes = decodeStrictBase64( val, path, 'Buffer' );

        return hasBuffer ? Buffer.from( bytes ) : ( bytes as unknown as Buffer );
    }

    throw new ParseError( path, 'Type<Buffer>' );
}

export function coerceTypedArray( val: any, path: string, typeName: string ): any
{
    if( typeName === 'Buffer' ){ return coerceBuffer( val, path ) }

    const ctor = ( globalThis as any )[typeName];

    if( typeof ctor !== 'function' )
    {
        throw new ParseError( path, `Type<${typeName}>` );
    }

    if( val instanceof ctor ){ return val }

    let bytes: Uint8Array;

    if( val instanceof Uint8Array )
    {
        bytes = val;
    }
    else if( ArrayBuffer.isView( val ))
    {
        bytes = new Uint8Array( val.buffer, val.byteOffset, val.byteLength );
    }
    else if( val instanceof ArrayBuffer || ( typeof SharedArrayBuffer !== 'undefined' && val instanceof SharedArrayBuffer ))
    {
        bytes = new Uint8Array( val );
    }
    else if( typeof val === 'string' )
    {
        bytes = decodeStrictBase64( val, path, typeName );
    }
    else
    {
        throw new ParseError( path, `Type<${typeName}>` );
    }

    if( typeName === 'ArrayBuffer' )
    {
        const ab = new ArrayBuffer( bytes.byteLength );
        new Uint8Array( ab ).set( bytes );

        return ab;
    }

    if( typeName === 'SharedArrayBuffer' )
    {
        const sab = new SharedArrayBuffer( bytes.byteLength );
        new Uint8Array( sab ).set( bytes );

        return sab;
    }

    if( typeName === 'DataView' )
    {
        const ab = new ArrayBuffer( bytes.byteLength );
        new Uint8Array( ab ).set( bytes );

        return new DataView( ab );
    }

    const elemSize: number = ctor.BYTES_PER_ELEMENT;

    if( bytes.byteLength % elemSize !== 0 )
    {
        throw new ParseError( path, `Type<${typeName}>` );
    }

    const ab = new ArrayBuffer( bytes.byteLength );
    new Uint8Array( ab ).set( bytes );

    return new ctor( ab );
}

const rawJsonIntegers = new WeakMap<object, Record<string, string>>();
const RAW_JSON_INT_RE = /^-?\d+$/;

function bigIntSourceReviver( this: any, key: string, val: any, ctx?: { source? : string }): any
{
    if(
        key !== '' &&
        typeof val === 'number' &&
        !Number.isSafeInteger( val ) &&
        typeof ctx?.source === 'string' &&
        RAW_JSON_INT_RE.test( ctx.source ) &&
        this !== null &&
        typeof this === 'object'
    )
    {
        let map = rawJsonIntegers.get( this );

        if( !map )
        {
            map = Object.create( null ) as Record<string, string>;
            rawJsonIntegers.set( this, map );
        }

        map[key] = ctx.source;
    }

    return val;
}

export function parseJson( raw: unknown, preserveBigInt = false ): any
{
    if( typeof raw !== 'string' )
    {
        throw new ParseError( '', 'Input must be a JSON string' );
    }

    try
    {
        return preserveBigInt
            ? JSON.parse( raw, bigIntSourceReviver as any )
            : JSON.parse( raw );
    }
    catch( e )
    {
        throw new ParseError( '', 'Invalid JSON: ' + ( e as Error ).message );
    }
}

export function coerceBigInt( val: any, path: string ): bigint
{
    if( typeof val === 'bigint' ){ return val }

    if( typeof val === 'string' && val.trim() !== '' )
    {
        try
        {
            return BigInt( val );
        }
        catch
        {
            throw new ParseError( path, 'Type<bigint>' );
        }
    }

    if( typeof val === 'number' && Number.isSafeInteger( val ))
    {
        return BigInt( val );
    }

    throw new ParseError( path, 'Type<bigint>' );
}

export function coerceBigIntProp( holder: any, key: string | number, val: any, path: string ): bigint
{
    if( typeof val === 'number' && !Number.isSafeInteger( val ) && holder !== null && typeof holder === 'object' )
    {
        const rawSrc = rawJsonIntegers.get( holder )?.[String( key )];

        if( rawSrc !== undefined )
        {
            return BigInt( rawSrc );
        }
    }

    return coerceBigInt( val, path );
}

export function coerceBigIntRoot( raw: unknown, val: any, path: string ): bigint
{
    if( typeof val === 'number' && !Number.isSafeInteger( val ) && typeof raw === 'string' )
    {
        const trimmed = raw.trim();

        if( RAW_JSON_INT_RE.test( trimmed ))
        {
            return BigInt( trimmed );
        }
    }

    return coerceBigInt( val, path );
}

export function coerceUrl( val: any, path: string ): URL
{
    if( val instanceof URL ){ return val }

    if( typeof val === 'string' && val.trim() !== '' )
    {
        try
        {
            return new URL( val );
        }
        catch
        { /* fall through */ }
    }

    throw new ParseError( path, 'Type<URL>' );
}

export type ParseConstraint =
    {
        type     : string
        value?   : any
        message? : string
        regex?   : RegExp | null
    };

/**
 * Applies defaults, transforms, then validator constraint helpers; throws ParseError on failure.
 */
export function applyParseConstraints(
    val         : any,
    path        : string,
    constraints : ParseConstraint[],
    from?       : ParseSource,
    root?       : any
): any
{
    let v = val;
    const defaultC: ParseConstraint[] = [];
    const transforms: ParseConstraint[] = [];
    const messageC: ParseConstraint[] = [];
    const remaining: ParseConstraint[] = [];

    for( const c of constraints )
    {
        if( c.type === 'default' ){ defaultC.push( c ) }
        else if( c.type === 'transform' || c.type === 'transform_split' ){ transforms.push( c ) }
        else if( c.type === 'message' ){ messageC.push( c ) }
        else { remaining.push( c ) }
    }

    if( v === undefined && defaultC.length > 0 ){ v = defaultC[0].value }

    if( v !== undefined && v !== null )
    {
        for( const tc of transforms )
        {
            if( tc.type === 'transform_split' )
            {
                v = splitStringValue( v, typeof tc.value === 'string' ? tc.value : ',' );
            }
            else if( tc.value === 'lowercase' && typeof v === 'string' ){ v = v.toLowerCase() }
            else if( tc.value === 'uppercase' && typeof v === 'string' ){ v = v.toUpperCase() }
            else if( tc.value === 'trim' && typeof v === 'string' ){ v = v.trim() }
            else if( tc.value === 'capitalize' && typeof v === 'string' && v.length > 0 )
            {
                v = v.charAt( 0 ).toUpperCase() + v.slice( 1 );
            }
            else if( tc.value === 'tonumber' ){ v = coerceNumber( v, path ) }
            else if( tc.value === 'toboolean' ){ v = coerceBoolean( v, path ) }
            else if( tc.value === 'todate' ){ v = coerceDate( v, path ) }
        }
    }

    if( v === undefined || v === null || remaining.length === 0 ){ return v }

    // Lazy import path via globalThis validators on runtime ns — callers pass validators through closure in generated code.
    // Here we implement the common checks directly to avoid circular imports.
    for( const c of remaining )
    {
        const msg = c.message || messageC[0]?.value;

        if( c.type === 'minLength' )
        {
            if( typeof v === 'string' && v.length < c.value )
            {
                throw new ParseError( path, resolveParseMsg( msg, `MinLength<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'maxLength' )
        {
            if( typeof v === 'string' && v.length > c.value )
            {
                throw new ParseError( path, resolveParseMsg( msg, `MaxLength<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'minimum' )
        {
            if(( typeof v === 'number' || typeof v === 'bigint' ) && v < c.value )
            {
                throw new ParseError( path, resolveParseMsg( msg, `Minimum<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'maximum' )
        {
            if(( typeof v === 'number' || typeof v === 'bigint' ) && v > c.value )
            {
                throw new ParseError( path, resolveParseMsg( msg, `Maximum<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'exclusiveMinimum' )
        {
            if(( typeof v === 'number' || typeof v === 'bigint' ) && v <= c.value )
            {
                throw new ParseError( path, resolveParseMsg( msg, `ExclusiveMinimum<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'exclusiveMaximum' )
        {
            if(( typeof v === 'number' || typeof v === 'bigint' ) && v >= c.value )
            {
                throw new ParseError( path, resolveParseMsg( msg, `ExclusiveMaximum<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'multipleOf' )
        {
            if( typeof v === 'bigint' || typeof c.value === 'bigint' )
            {
                try
                {
                    const divisor = BigInt( c.value );

                    if( divisor === 0n || BigInt( v ) % divisor !== 0n )
                    {
                        throw new ParseError( path, resolveParseMsg( msg, `MultipleOf<${c.value}>`, path, v ));
                    }
                }
                catch( e )
                {
                    if( e instanceof ParseError ){ throw e }

                    throw new ParseError( path, resolveParseMsg( msg, `MultipleOf<${c.value}>`, path, v ));
                }
            }
            else if( typeof v === 'number' && !isMultipleOfNumber( v, c.value ))
            {
                throw new ParseError( path, resolveParseMsg( msg, `MultipleOf<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'integer' )
        {
            if( typeof v === 'number' && !Number.isInteger( v ))
            {
                throw new ParseError( path, resolveParseMsg( msg, 'Integer', path, v ));
            }
        }
        else if( c.type === 'safeInteger' )
        {
            if(
                ( typeof v === 'number' && !Number.isSafeInteger( v )) ||
                ( typeof v === 'bigint' && ( v < -9007199254740991n || v > 9007199254740991n ))
            )
            {
                throw new ParseError( path, resolveParseMsg( msg, 'SafeInteger', path, v ));
            }
        }
        else if( c.type === 'positive' )
        {
            if(( typeof v === 'number' && !( v > 0 )) || ( typeof v === 'bigint' && v <= 0n ))
            {
                throw new ParseError( path, resolveParseMsg( msg, 'Positive', path, v ));
            }
        }
        else if( c.type === 'nonNegative' )
        {
            if(( typeof v === 'number' && !( v >= 0 )) || ( typeof v === 'bigint' && v < 0n ))
            {
                throw new ParseError( path, resolveParseMsg( msg, 'NonNegative', path, v ));
            }
        }
        else if( c.type === 'negative' )
        {
            if(( typeof v === 'number' && !( v < 0 )) || ( typeof v === 'bigint' && v >= 0n ))
            {
                throw new ParseError( path, resolveParseMsg( msg, 'Negative', path, v ));
            }
        }
        else if( c.type === 'finite' )
        {
            if( typeof v === 'number' && !Number.isFinite( v ))
            {
                throw new ParseError( path, resolveParseMsg( msg, 'Finite', path, v ));
            }
        }
        else if( c.type === 'minDate' )
        {
            if( !isMinDateValid( v, c.value ))
            {
                throw new ParseError( path, resolveParseMsg( msg, `MinDate<'${c.value}'>`, path, v ));
            }
        }
        else if( c.type === 'maxDate' )
        {
            if( !isMaxDateValid( v, c.value ))
            {
                throw new ParseError( path, resolveParseMsg( msg, `MaxDate<'${c.value}'>`, path, v ));
            }
        }
        else if( c.type === 'pattern' )
        {
            if( typeof v === 'string' )
            {
                const regex = c.regex !== undefined ? c.regex : getCachedPattern( c.value );

                if( !regex ){ throw new ParseError( path, resolveParseMsg( msg, 'UnsafePattern', path, v )) }

                if( !testRegex( regex, v ))
                {
                    throw new ParseError( path, resolveParseMsg( msg, `Pattern<'${c.value}'>`, path, v ));
                }
            }
        }
        else if( c.type === 'minItems' && ( Array.isArray( v ) || v instanceof Set ))
        {
            const size = v instanceof Set ? v.size : v.length;

            if( size < c.value )
            {
                throw new ParseError( path, resolveParseMsg( msg, `MinItems<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'maxItems' && ( Array.isArray( v ) || v instanceof Set ))
        {
            const size = v instanceof Set ? v.size : v.length;

            if( size > c.value )
            {
                throw new ParseError( path, resolveParseMsg( msg, `MaxItems<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'minProperties' && ( v instanceof Map || isPlainObject( v )))
        {
            const size = v instanceof Map ? v.size : Object.keys( v ).length;

            if( size < c.value )
            {
                throw new ParseError( path, resolveParseMsg( msg, `MinProperties<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'maxProperties' && ( v instanceof Map || isPlainObject( v )))
        {
            const size = v instanceof Map ? v.size : Object.keys( v ).length;

            if( size > c.value )
            {
                throw new ParseError( path, resolveParseMsg( msg, `MaxProperties<${c.value}>`, path, v ));
            }
        }
        else if( c.type === 'format' )
        {
            const ctx =
            {
                success     : true,
                errors      : [] as { path : string, value : any, error : string }[],
                mode        : 'strict' as const,
                from,
                root        : root !== undefined ? root : v,
                secretDepth : parseSecretDepth
            };
            v = validators.format( v, path, ctx as any, c.value, msg );

            if( !ctx.success )
            {
                throw new ParseError( path, ctx.errors[0].error );
            }
        }
        else if( c.type === 'requires' )
        {
            const keys = Array.isArray( c.value ) ? c.value : [c.value];
            const rootTarget = root !== undefined ? root : v;

            for( const key of keys )
            {
                const resolved = resolvePath( path, key );

                if( !hasPath( rootTarget, resolved ))
                {
                    throw new ParseError( path, resolveParseMsg( msg, `Requires<${key}>`, path, v ));
                }
            }
        }
        else if( c.type === 'uniqueItems' )
        {
            if( Array.isArray( v ) && !hasUniqueItems( v ))
            {
                throw new ParseError( path, resolveParseMsg( msg, 'UniqueItems', path, v ));
            }
        }
    }

    return v;
}

export function applyContains(
    v           : any,
    path        : string,
    itemParse   : ( item: any, itemPath: string ) => any,
    minContains : number = 1,
    maxContains?: number,
    message?    : string
): any
{
    if( !Array.isArray( v )){ return v }

    let count = 0;

    for( let i = 0; i < v.length; i++ )
    {
        try
        {
            itemParse( v[i], path + '[' + i + ']' );
            count++;
        }
        catch( e )
        {
            if( !( e instanceof ParseError )){ throw e }
        }
    }

    if( count < minContains )
    {
        throw new ParseError( path, resolveParseMsg( message, `Contains<min:${minContains}>`, path, v ));
    }

    if( maxContains !== undefined && count > maxContains )
    {
        throw new ParseError( path, resolveParseMsg( message, `Contains<max:${maxContains}>`, path, v ));
    }

    return v;
}

export function applyPropertyNames(
    v        : any,
    path     : string,
    keyParse : ( key: any, keyPath: string ) => any,
    message? : string
): any
{
    if( v === null || typeof v !== 'object' || Array.isArray( v )){ return v }

    for( const key of Object.keys( v ))
    {
        const keyPath = path ? path + '.' + key : key;

        try
        {
            keyParse( key, keyPath );
        }
        catch( e )
        {
            if( e instanceof ParseError )
            {
                throw new ParseError( e.path, resolveParseMsg( message, parseErrorCode( e ), e.path, key ));
            }

            throw e;
        }
    }

    return v;
}

export function reviveTree( value: any, reviver: JsonReviver ): any
{
    try
    {
        return runWithParseProbeContext( createParseProbeContext(), () => walkRevive( value, reviver ));
    }
    catch( e )
    {
        if( e instanceof ParseError ){ throw e }

        const path = e instanceof TransformWalkError ? e.path : '';

        throw new ParseError( path, e instanceof Error ? e.message : String( e ));
    }
}

export function applyParseTransform(
    value     : any,
    path      : string,
    transform : TransformFn | TransformFn[] | undefined,
    kind      : CoercionKind,
    tags      : string[],
    root      : any
): any
{
    if( transform == null || value === undefined || value === null ){ return value }

    try
    {
        return runWithParseProbeContext(
            createParseProbeContext(),
            () => applyNodeTransform( value, path, transform, kind, tags, root )
        );
    }
    catch( e )
    {
        if( e instanceof ParseError ){ throw e }

        throw new ParseError( path, e instanceof Error ? e.message : String( e ));
    }
}

export interface RuntimeParseOptions
{
    reviver?   : JsonReviver
    transform? : TransformFn | TransformFn[]
}

export interface CompiledParser<T, Input = string> extends StandardSchemaV1<Input, T>
{
    ( input: Input, options?: RuntimeParseOptions ) : T
    parse     : ( input: Input, options?: RuntimeParseOptions ) => T
    safe      : ( input: unknown, options?: RuntimeParseOptions ) => SafeParseResult<T>
    safeParse : ( input: unknown, options?: RuntimeParseOptions ) => SafeParseResult<T>
}

export function checkParseOptions(
    opts             : any,
    expectedMode     : ValidationMode,
    expectedFrom     : ParseSource,
    expectedUnionRes : UnionResolution,
    expectedCasing?  : CasingFormat
): any
{
    if( opts == null ){ return opts }

    if( typeof opts === 'string' )
    {
        if( opts !== expectedMode )
        {
            throw new ParseError( '', `Dynamic option "mode" ("${opts}") does not match compiled mode "${expectedMode}"` );
        }

        return undefined;
    }

    if( typeof opts === 'object' )
    {
        if( opts.mode !== undefined && opts.mode !== expectedMode )
        {
            throw new ParseError( '', `Dynamic option "mode" ("${opts.mode}") does not match compiled mode "${expectedMode}"` );
        }

        if( opts.from !== undefined && opts.from !== expectedFrom )
        {
            throw new ParseError( '', `Dynamic option "from" ("${opts.from}") does not match compiled source "${expectedFrom}"` );
        }

        if( opts.unionResolution !== undefined && opts.unionResolution !== expectedUnionRes )
        {
            throw new ParseError( '', `Dynamic option "unionResolution" ("${opts.unionResolution}") does not match compiled strategy "${expectedUnionRes}"` );
        }

        if( opts.propertyCasing !== undefined && opts.propertyCasing !== expectedCasing )
        {
            throw new ParseError( '', `Dynamic option "propertyCasing" ("${opts.propertyCasing}") does not match compiled casing "${expectedCasing ?? 'none'}"` );
        }
    }

    return opts;
}

function mergeRuntimeParseOptions( defaults?: any, override?: RuntimeParseOptions ): any
{
    if( override === undefined ){ return defaults }

    if( defaults === undefined || typeof defaults === 'string' ){ return override }

    return { ...defaults, ...override };
}

function parseErrorToStandardIssues( err: ParseError ): StandardSchemaV1.Issue[]
{
    const segments = tokenizePath( err.path ).map( segment =>
    {
        if( !isIndexSegment( segment )){ return segment }

        const inner = segment.slice( 1, -1 );

        return /^\d+$/.test( inner ) ? Number( inner ) : inner;
    });

    return [{
        message : parseErrorCode( err ),
        ...( segments.length > 0 ? { path : segments } : {})
    }];
}

export function createParser<T, Input = string>(
    parseFn        : ( input: any, options?: any ) => T,
    defaultOptions?: any
): CompiledParser<T, Input>
{
    const fn = (( input: Input, overrideOptions?: RuntimeParseOptions ): T =>
        parseFn( input, mergeRuntimeParseOptions( defaultOptions, overrideOptions ))
    ) as CompiledParser<T, Input>;

    fn.parse = fn;
    fn.safe = ( input: unknown, overrideOptions?: RuntimeParseOptions ): SafeParseResult<T> =>
        safeParse( parseFn, input, mergeRuntimeParseOptions( defaultOptions, overrideOptions ));
    fn.safeParse = fn.safe;

    Object.defineProperty( fn, '~standard', {
        value : {
            version : 1 as const,
            vendor  : 'webergency-typechecker' as const,
            validate( value: unknown ): StandardSchemaV1.Result<T>
            {
                const res = fn.safe( value );

                if( res.success )
                {
                    return { value : res.data };
                }

                return { issues : parseErrorToStandardIssues( res.error ) };
            }
        },
        writable     : true,
        configurable : true,
        enumerable   : false
    });

    return fn;
}
