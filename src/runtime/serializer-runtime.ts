import
{
    applyNodeTransform,
    type JsonReplacer,
    type TransformFn
}
    from './transform.js';
import {
    isPlainObject,
    findExclusiveKeyArm,
    type CoercionKind,
    type ValidationMode,
    type UnionResolution
} from './validators.js';
import type { CasingFormat } from './casing.js';

export class SerializationError extends Error
{
    constructor( public readonly path: string, message: string )
    {
        super( path ? `Serialization error at "${path}": ${message}` : message );
        this.name = 'SerializationError';
    }
}

export interface SafeSerializeSuccess
{
    success : true
    data    : string
    error?  : undefined
}

export interface SafeSerializeFailure
{
    success : false
    data?   : undefined
    error   : SerializationError
}

export type SafeSerializeResult = SafeSerializeSuccess | SafeSerializeFailure;

export function safeSerialize(
    serializerFn : ( input: any, options?: any ) => string,
    input        : unknown,
    options?     : any
): SafeSerializeResult
{
    try
    {
        return { success : true, data : serializerFn( input, options ) };
    }
    catch( e )
    {
        if( e instanceof SerializationError )
        {
            return { success : false, error : e };
        }

        return {
            success : false,
            error   : new SerializationError( '', e instanceof Error ? e.message : String( e ))
        };
    }
}

function serializationErrorCode( err: SerializationError ): string
{
    if( !err.path ){ return err.message }

    const prefix = `Serialization error at "${err.path}": `;

    if( err.message.startsWith( prefix )){ return err.message.slice( prefix.length ) }

    return err.message;
}

export function serializeString( val: string, path = '' ): string
{
    if( typeof val !== 'string' )
    {
        throw new SerializationError( path, 'Type<string>' );
    }

    return JSON.stringify( val );
}

/** Opaque `any` / `unknown` JSON fragment. Non-JSON values become `null` so they embed safely in object/array parts. */
export function serializeAny( val: any, path = '' ): string
{
    if( val === undefined || typeof val === 'function' || typeof val === 'symbol' ){ return 'null' }

    if( typeof val === 'number' && !Number.isFinite( val )){ return 'null' }

    try
    {
        const out = JSON.stringify( val );

        return out === undefined ? 'null' : out;
    }
    catch( e )
    {
        throw new SerializationError( path, e instanceof Error ? e.message : String( e ));
    }
}

export function checkPlainObject( val: any, path = '' ): void
{
    if( !isPlainObject( val ))
    {
        throw new SerializationError( path, 'Type<Object>' );
    }
}

function leafQueryValue( expr: any ): string
{
    if( expr == null ){ return '' }

    if( expr instanceof Date ){ return expr.toISOString() }

    if( expr instanceof URL ){ return expr.href }

    if( typeof expr === 'bigint' ){ return String( expr ) }

    return String( expr );
}

/**
 * Deep-encode an opaque `any` / `unknown` value into `application/x-www-form-urlencoded` pairs
 * (objects → bracket keys, arrays → `[]`, scalars → one leaf).
 */
export function appendQueryAny( params: string[], val: any, prefix: string ): void
{
    if( val === undefined || typeof val === 'function' || typeof val === 'symbol' ){ return }

    if( val === null || typeof val !== 'object' || val instanceof Date || val instanceof URL )
    {
        params.push( encodeURIComponent( prefix ) + '=' + encodeURIComponent( leafQueryValue( val )));

        return;
    }

    if( Array.isArray( val ))
    {
        for( const item of val )
        {
            appendQueryAny( params, item, prefix + '[]' );
        }

        return;
    }

    let wrote = false;

    for( const k of Object.keys( val ))
    {
        const entry = val[k];

        if( entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' ){ continue }

        wrote = true;
        const child = prefix === '' ? k : prefix + '[' + k + ']';
        appendQueryAny( params, entry, child );
    }

    // Empty object still needs a presence marker when nested under a key.
    if( !wrote && prefix !== '' )
    {
        params.push( encodeURIComponent( prefix ) + '=' );
    }
}

export function serializeDate( val: Date | string | number, path = '' ): string
{
    if( val instanceof Date )
    {
        if( isNaN( val.getTime())){ throw new SerializationError( path, 'Type<Date>' ) }

        return `"${val.toISOString()}"`;
    }

    if( typeof val === 'string' || typeof val === 'number' )
    {
        const d = new Date( val );

        if( !isNaN( d.getTime())){ return `"${d.toISOString()}"` }
    }

    throw new SerializationError( path, 'Type<Date>' );
}

export function serializeUrl( val: URL | string, path = '' ): string
{
    if( val instanceof URL )
    {
        return JSON.stringify( val.href );
    }

    if( typeof val === 'string' && val.trim() !== '' )
    {
        try
        {
            return JSON.stringify( new URL( val ).href );
        }
        catch
        { /* fall through */ }
    }

    throw new SerializationError( path, 'Type<URL>' );
}

export function serializeQueryUrl( val: URL | string, path = '' ): string
{
    if( val instanceof URL )
    {
        return encodeURIComponent( val.href );
    }

    if( typeof val === 'string' && val.trim() !== '' )
    {
        try
        {
            return encodeURIComponent( new URL( val ).href );
        }
        catch
        { /* fall through */ }
    }

    throw new SerializationError( path, 'Type<URL>' );
}

export function serializeRegExp( val: RegExp, path = '' ): string
{
    if( !( val instanceof RegExp ))
    {
        throw new SerializationError( path, 'Type<RegExp>' );
    }

    return JSON.stringify( String( val ));
}

export function serializeBuffer( val: Uint8Array | ArrayBuffer | ArrayBufferView | SharedArrayBuffer, path = '' ): string
{
    let bytes: Uint8Array | undefined;

    if( val instanceof Uint8Array || ( typeof Buffer !== 'undefined' && Buffer.isBuffer( val )))
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

    if( bytes )
    {
        if( typeof Buffer !== 'undefined' )
        {
            return `"${Buffer.from( bytes.buffer, bytes.byteOffset, bytes.byteLength ).toString( 'base64' )}"`;
        }

        let bin = '';

        for( let i = 0; i < bytes.length; i++ ){ bin += String.fromCharCode( bytes[i]) }

        return `"${btoa( bin )}"`;
    }

    throw new SerializationError( path, 'Type<Buffer>' );
}

export function serializeArray<T>( val: T[], mapper: ( item: T, index: number ) => string, path = '' ): string
{
    if( !Array.isArray( val ))
    {
        throw new SerializationError( path, 'Type<Array>' );
    }

    const parts: string[] = [];

    for( let i = 0; i < val.length; i++ )
    {
        parts.push( mapper( val[i], i ));
    }

    return `[${parts.join( ',' )}]`;
}

export function serializeSet<T>( val: Set<T>, mapper: ( item: T, index: number ) => string, path = '' ): string
{
    if( !( val instanceof Set ))
    {
        throw new SerializationError( path, 'Type<Set>' );
    }

    const parts: string[] = [];
    let i = 0;

    for( const item of val )
    {
        parts.push( mapper( item, i ));
        i++;
    }

    return `[${parts.join( ',' )}]`;
}

export function serializeMap<K, V>( val: Map<K, V>, mapper: ( k: K, v: V ) => [ string, string ], path = '' ): string
{
    if( !( val instanceof Map ))
    {
        throw new SerializationError( path, 'Type<Map>' );
    }

    const parts: string[] = [];

    for( const [ k, v ] of val.entries())
    {
        const [ kSer, vSer ] = mapper( k, v );
        const keyJson = kSer.charAt( 0 ) === '"' ? kSer : JSON.stringify( kSer );
        parts.push( `${keyJson}:${vSer}` );
    }

    return `{${parts.join( ',' )}}`;
}

export interface SerializerProbeFrame
{
    stripped : number
    matched  : number
}

export interface SerializerProbeContext
{
    readonly stack : SerializerProbeFrame[]
}

let probeStack: SerializerProbeFrame[] = [];

export function createSerializerProbeContext(): SerializerProbeContext
{
    return { stack : [] };
}

export function runWithSerializerProbeContext<T>( ctx: SerializerProbeContext, fn: () => T ): T
{
    const prev = probeStack;
    probeStack = ctx.stack;

    try
    {
        return fn();
    }
    finally
    {
        probeStack = prev;
    }
}

export function hasSerializerUnionProbe( ctx?: SerializerProbeContext ): boolean
{
    const stack = ctx ? ctx.stack : probeStack;

    return stack.length > 0;
}

export function recordSerializerObjectStats( stripped: number, matched: number, ctx?: SerializerProbeContext ): void
{
    const stack = ctx ? ctx.stack : probeStack;
    const top = stack[stack.length - 1];

    if( top )
    {
        top.stripped += stripped;
        top.matched += matched;
    }
}

export function serializeUnion(
    val           : any,
    path          : string,
    expected      : string,
    arms          : Array<( val: any ) => string>,
    probeBestFit  : boolean = false,
    fallbackFlags?: boolean[],
    exclusiveKeys?: string[]
): string
{
    let last: SerializationError | undefined;
    const matchedIdx = findExclusiveKeyArm( val, exclusiveKeys );

    if( matchedIdx >= 0 )
    {
        arms = [ arms[matchedIdx] ];
        probeBestFit = false;
    }

    if( !probeBestFit )
    {
        const top = probeStack.length > 0 ? probeStack[probeStack.length - 1] : undefined;

        for( const arm of arms )
        {
            const savedStripped = top ? top.stripped : 0;
            const savedMatched = top ? top.matched : 0;

            try
            {
                return arm( val );
            }
            catch( e )
            {
                if( top )
                {
                    top.stripped = savedStripped;
                    top.matched = savedMatched;
                }

                if( e instanceof SerializationError )
                {
                    last = e;
                    continue;
                }

                throw e;
            }
        }

        if( last && serializationErrorCode( last ) === expected ){ throw last }

        throw new SerializationError( path, expected );
    }

    let bestResult: string | undefined;
    let hasBest = false;
    let bestStripped = Infinity;
    let bestMatched = -1;
    let fallbackResult: string | undefined;
    let hasFallback = false;

    for( let i = 0; i < arms.length; i++ )
    {
        const isFallback = Boolean( fallbackFlags && fallbackFlags[i]);

        if( isFallback && ( hasBest || hasFallback )){ continue }

        const frame: SerializerProbeFrame = { stripped : 0, matched : 0 };
        probeStack.push( frame );

        try
        {
            const res = arms[i]( val );
            probeStack.pop();

            if( isFallback )
            {
                fallbackResult = res;
                hasFallback = true;
                continue;
            }

            if( frame.stripped === 0 )
            {
                recordSerializerObjectStats( 0, frame.matched );

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
            probeStack.pop();

            if( e instanceof SerializationError )
            {
                last = e;
                continue;
            }

            throw e;
        }
    }

    if( hasBest )
    {
        recordSerializerObjectStats( bestStripped, bestMatched );

        return bestResult as string;
    }

    if( hasFallback )
    {
        return fallbackResult as string;
    }

    if( last && serializationErrorCode( last ) === expected ){ throw last }

    throw new SerializationError( path, expected );
}

export function serializeQueryUnion(
    params        : string[],
    path          : string,
    expected      : string,
    arms          : Array<() => void>,
    probeBestFit  : boolean = false,
    fallbackFlags?: boolean[]
): void
{
    let last: SerializationError | undefined;
    const baseSnap = params.length;

    if( !probeBestFit )
    {
        const top = probeStack.length > 0 ? probeStack[probeStack.length - 1] : undefined;

        for( const arm of arms )
        {
            params.length = baseSnap;
            const savedStripped = top ? top.stripped : 0;
            const savedMatched = top ? top.matched : 0;

            try
            {
                arm();

                return;
            }
            catch( e )
            {
                params.length = baseSnap;

                if( top )
                {
                    top.stripped = savedStripped;
                    top.matched = savedMatched;
                }

                if( e instanceof SerializationError )
                {
                    last = e;
                    continue;
                }

                throw e;
            }
        }

        if( last && serializationErrorCode( last ) === expected ){ throw last }

        throw new SerializationError( path, expected );
    }

    let bestParams: string[] | undefined;
    let bestStripped = Infinity;
    let bestMatched = -1;
    let fallbackParams: string[] | undefined;

    for( let i = 0; i < arms.length; i++ )
    {
        params.length = baseSnap;
        const isFallback = Boolean( fallbackFlags && fallbackFlags[i]);

        if( isFallback && ( bestParams !== undefined || fallbackParams !== undefined )){ continue }

        const frame: SerializerProbeFrame = { stripped : 0, matched : 0 };
        probeStack.push( frame );

        try
        {
            arms[i]();
            probeStack.pop();

            if( isFallback )
            {
                fallbackParams = params.slice( baseSnap );
                params.length = baseSnap;
                continue;
            }

            if( frame.stripped === 0 )
            {
                recordSerializerObjectStats( 0, frame.matched );

                return;
            }

            if(
                !bestParams ||
                frame.stripped < bestStripped ||
                ( frame.stripped === bestStripped && frame.matched > bestMatched )
            )
            {
                bestParams = params.slice( baseSnap );
                bestStripped = frame.stripped;
                bestMatched = frame.matched;
            }

            params.length = baseSnap;
        }
        catch( e )
        {
            probeStack.pop();
            params.length = baseSnap;

            if( e instanceof SerializationError )
            {
                last = e;
                continue;
            }

            throw e;
        }
    }

    if( bestParams )
    {
        params.push( ...bestParams );
        recordSerializerObjectStats( bestStripped, bestMatched );

        return;
    }

    if( fallbackParams )
    {
        params.push( ...fallbackParams );

        return;
    }

    if( last && serializationErrorCode( last ) === expected ){ throw last }

    throw new SerializationError( path, expected );
}

export function applySerializeTransform(
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
        return runWithSerializerProbeContext(
            createSerializerProbeContext(),
            () => applyNodeTransform( value, path, transform, kind, tags, root )
        );
    }
    catch( e )
    {
        if( e instanceof SerializationError ){ throw e }

        throw new SerializationError( path, e instanceof Error ? e.message : String( e ));
    }
}

export type BigIntWireFormat = 'string' | 'number';

export interface RuntimeSerializeOptions
{
    replacer?  : JsonReplacer
    transform? : TransformFn | TransformFn[]
}

export interface CompiledSerializer<T>
{
    ( input: T, options?: RuntimeSerializeOptions ) : string
    stringify     : ( input: T, options?: RuntimeSerializeOptions ) => string
    safe          : ( input: unknown, options?: RuntimeSerializeOptions ) => SafeSerializeResult
    safeSerialize : ( input: unknown, options?: RuntimeSerializeOptions ) => SafeSerializeResult
}

const REPLACER_INT_RE = /^-?\d+$/;

export function applyJsonReplacer( json: string, replacer?: JsonReplacer ): string
{
    if( !replacer ){ return json }

    const rawSources = new WeakMap<object, Record<string, string>>();
    let rootRawSource: string | undefined;

    const parsed = JSON.parse( json, function( this: any, key: string, val: any, ctx?: { source? : string })
    {
        if(
            typeof val === 'number' &&
            !Number.isSafeInteger( val ) &&
            typeof ctx?.source === 'string' &&
            REPLACER_INT_RE.test( ctx.source )
        )
        {
            if( key === '' )
            {
                rootRawSource = ctx.source;
            }
            else
            {
                let map = rawSources.get( this );

                if( !map )
                {
                    map = Object.create( null ) as Record<string, string>;
                    rawSources.set( this, map );
                }

                map[key] = ctx.source;
            }
        }

        return val;
    } as any );

    const rawJSON = ( JSON as any ).rawJSON as (( text: string ) => unknown ) | undefined;
    const out = JSON.stringify( parsed, function( this: any, key: string, val: any )
    {
        const next = replacer.call( this, key, val );

        if( next === val && typeof val === 'number' && !Number.isSafeInteger( val ) && typeof rawJSON === 'function' )
        {
            const src = key === '' ? rootRawSource : rawSources.get( this )?.[key];

            if( src !== undefined ){ return rawJSON( src ) }
        }

        return next;
    });

    if( out === undefined )
    {
        throw new SerializationError( '', 'Replacer returned undefined at root' );
    }

    return out;
}

export function checkSerializeOptions(
    opts             : any,
    expectedMode     : ValidationMode,
    expectedFormat   : 'json' | 'query',
    expectedUnionRes : UnionResolution,
    expectedCasing?  : CasingFormat,
    expectedBigintAs : BigIntWireFormat = 'string'
): any
{
    if( opts == null ){ return opts }

    if( typeof opts === 'string' )
    {
        if( opts !== expectedMode )
        {
            throw new SerializationError( '', `Dynamic option "mode" ("${opts}") does not match compiled mode "${expectedMode}"` );
        }

        return undefined;
    }

    if( typeof opts === 'object' )
    {
        if( opts.mode !== undefined && opts.mode !== expectedMode )
        {
            throw new SerializationError( '', `Dynamic option "mode" ("${opts.mode}") does not match compiled mode "${expectedMode}"` );
        }

        const fmt = opts.format ?? opts.to;

        if( fmt !== undefined && fmt !== expectedFormat )
        {
            throw new SerializationError( '', `Dynamic option "format" ("${fmt}") does not match compiled format "${expectedFormat}"` );
        }

        if( opts.unionResolution !== undefined && opts.unionResolution !== expectedUnionRes )
        {
            throw new SerializationError( '', `Dynamic option "unionResolution" ("${opts.unionResolution}") does not match compiled strategy "${expectedUnionRes}"` );
        }

        if( opts.propertyCasing !== undefined && opts.propertyCasing !== expectedCasing )
        {
            throw new SerializationError( '', `Dynamic option "propertyCasing" ("${opts.propertyCasing}") does not match compiled casing "${expectedCasing ?? 'none'}"` );
        }

        if( opts.bigintAs !== undefined && opts.bigintAs !== expectedBigintAs )
        {
            throw new SerializationError( '', `Dynamic option "bigintAs" ("${opts.bigintAs}") does not match compiled bigintAs "${expectedBigintAs}"` );
        }
    }

    return opts;
}

function mergeRuntimeSerializeOptions( defaults?: any, override?: RuntimeSerializeOptions ): any
{
    if( override === undefined ){ return defaults }

    if( defaults === undefined || typeof defaults === 'string' ){ return override }

    return { ...defaults, ...override };
}

export function createSerializer<T>(
    serFn          : ( input: any, options?: any ) => string,
    defaultOptions?: any
): CompiledSerializer<T>
{
    const fn = (( input: T, overrideOptions?: RuntimeSerializeOptions ): string =>
        serFn( input, mergeRuntimeSerializeOptions( defaultOptions, overrideOptions ))
    ) as CompiledSerializer<T>;

    fn.stringify = fn;
    fn.safe = ( input: unknown, overrideOptions?: RuntimeSerializeOptions ): SafeSerializeResult =>
        safeSerialize( serFn, input, mergeRuntimeSerializeOptions( defaultOptions, overrideOptions ));
    fn.safeSerialize = fn.safe;

    return fn;
}
