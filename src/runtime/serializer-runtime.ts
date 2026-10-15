import
{
    applyNodeTransform,
    type TransformFn
}
    from './transform.js';
import { isPlainObject, type CoercionKind } from './validators.js';

export class SerializationError extends Error
{
    constructor( public readonly path: string, message: string )
    {
        super( path ? `Serialization error at "${path}": ${message}` : message );
        this.name = 'SerializationError';
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

/** Opaque `any` / `unknown` JSON fragment. `undefined` becomes `null` so it embeds safely in object parts. */
export function serializeAny( val: any ): string
{
    if( val === undefined ){ return 'null' }

    return JSON.stringify( val );
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

    if( typeof expr === 'bigint' ){ return String( expr ) }

    return String( expr );
}

/**
 * Deep-encode an opaque `any` / `unknown` value into `application/x-www-form-urlencoded` pairs
 * (objects → bracket keys, arrays → `[]`, scalars → one leaf).
 */
export function appendQueryAny( params: string[], val: any, prefix: string ): void
{
    if( val === undefined ){ return }

    if( val === null || typeof val !== 'object' )
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

    for( const k in val )
    {
        if( val[k] === undefined ){ continue }

        wrote = true;
        const child = prefix === '' ? k : prefix + '[' + k + ']';
        appendQueryAny( params, val[k], child );
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

export function serializeBuffer( val: Uint8Array | ArrayBuffer, path = '' ): string
{
    if( val instanceof Uint8Array || ( typeof Buffer !== 'undefined' && Buffer.isBuffer( val )) || val instanceof ArrayBuffer )
    {
        const buf = val instanceof Uint8Array ? val : new Uint8Array( val );

        return `"${Buffer.from( buf ).toString( 'base64' )}"`;
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

function findExclusiveKeyArm( val: any, exclusiveKeys: string[] | undefined ): number
{
    if( !exclusiveKeys || !isPlainObject( val )){ return -1 }

    let matchedIdx = -1;

    for( let i = 0; i < exclusiveKeys.length; i++ )
    {
        if( val[exclusiveKeys[i]] !== undefined )
        {
            if( matchedIdx !== -1 ){ return -1 }

            matchedIdx = i;
        }
    }

    return matchedIdx;
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
    try
    {
        return applyNodeTransform( value, path, transform, kind, tags, root );
    }
    catch( e )
    {
        if( e instanceof SerializationError ){ throw e }

        throw new SerializationError( path, e instanceof Error ? e.message : String( e ));
    }
}
