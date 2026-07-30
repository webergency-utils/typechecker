import { validators } from './validators.js';
import { getCachedPattern } from './regex.js';

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
    if( typeof v !== 'object' || v === null || Array.isArray( v ))
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

export function parseUnion(
    v        : any,
    path     : string,
    expected : string,
    arms     : Array<( v: any, p: string ) => any>
): any
{
    let last: ParseError | undefined;

    for( const arm of arms )
    {
        try
        {
            return arm( v, path );
        }
        catch( e )
        {
            if( e instanceof ParseError )
            {
                last = e;
                continue;
            }

            throw e;
        }
    }

    if( last && parseErrorCode( last ) === expected ){ throw last }

    throw new ParseError( path, expected );
}

const intRE = /^[0-9]+$/;

function isUnsafeKey( key: string | number ): boolean
{
    return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

function createPlainObject(): Record<string | number, any>
{
    return {};
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
 */
export function parseQueryString( querystring: string ): Record<string, any>
{
    const query: any = createPlainObject();

    if( !querystring ){ return query }

    const assign = ( key: string | number, value: any ) =>
    {
        const keys = key.toString().replace( /\]\[/g, '[' ).replace( /]$/, '' ).split( '[' );
        let obj = query, parent, parent_key;

        for( let i = 0; i < keys.length; ++i )
        {
            let k: string | number = keys[i];

            if( isUnsafeKey( k )){ return }

            if( k && intRE.test( k.toString())){ k = parseInt( k, 10 ) }
            else if( k === '' )
            {
                k = Array.isArray( obj ) ? obj.length - 1 : Math.max( -1, ...Object.keys( obj ).map( k => intRE.test( k ) ? parseInt( k, 10 ) : -1 ));

                if( k === -1 || i === keys.length - 1 || Object.prototype.hasOwnProperty.call( obj[k] || createPlainObject(), keys[i + 1]))
                {
                    k += 1;
                }
            }

            if( typeof k === 'string' && Array.isArray( obj ))
            {
                parent[parent_key!] = obj = obj.reduce(( o: any, v: any, i: number ) => ( o[i] = v, o ), createPlainObject());
            }

            if( i < keys.length - 1 )
            {
                if( !obj[k])
                {
                    obj[k] = ( keys[i + 1] === '' || intRE.test( keys[i + 1])) ? [] : createPlainObject();
                }

                if( isUnsafeKey( keys[i + 1])){ return }

                parent = obj;
                parent_key = k;
                obj = obj[k];
            }
            else
            {
                if( obj[k] !== undefined )
                {
                    if( Array.isArray( obj[k]))
                    {
                        obj[k].push( value );
                    }
                    else if( typeof obj[k] === 'object' && obj[k] !== null )
                    {
                        const nested = obj[k];
                        obj[k][Math.max( -1, ...Object.keys( nested ).map( nk => intRE.test( nk ) ? parseInt( nk, 10 ) : -1 )) + 1] = value;
                    }
                    else
                    {
                        ( obj[k] = [obj[k]]).push( value );
                    }
                }
                else
                {
                    obj[k] = value;
                }
            }
        }
    };

    let value, pair, last_pair = 0;
    const sep = '&', eq = '=';

    do
    {
        pair = querystring.indexOf( sep, last_pair );

        if( pair === -1 ){ pair = querystring.length }

        if( pair - last_pair > 0 )
        {
            if( ~( value = querystring.indexOf( eq, last_pair )) && value < pair )
            {
                assign(
                    safeDecodeURIComponent( querystring.substring( last_pair, value ).replace( /\+/g, ' ' )),
                    safeDecodeURIComponent( querystring.substring( value + 1, pair ).replace( /\+/g, ' ' ))
                );
            }
            else
            {
                assign( safeDecodeURIComponent( querystring.substring( last_pair, pair ).replace( /\+/g, ' ' )), true );
            }
        }

        last_pair = pair + 1;
    }
    while( last_pair < querystring.length );

    return query;
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
    if( val === 'true' || val === '1' || val === 1 || val === true ){ return true }
    if( val === 'false' || val === '0' || val === 0 || val === false ){ return false }

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

    return arr.map(( item, idx ) => mapper( item, `${path}[${idx}]` ));
}

export function coerceBuffer( val: any, path: string ): Buffer
{
    if( typeof Buffer !== 'undefined' && Buffer.isBuffer( val )){ return val }

    if( val instanceof Uint8Array ){ return Buffer.from( val ) }

    if( val instanceof ArrayBuffer ){ return Buffer.from( new Uint8Array( val )) }

    if( typeof val === 'string' )
    {
        return Buffer.from( val, 'base64' );
    }

    throw new ParseError( path, 'Type<Buffer>' );
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

    if( typeof val === 'number' && Number.isFinite( val ) && Number.isInteger( val ))
    {
        return BigInt( val );
    }

    throw new ParseError( path, 'Type<bigint>' );
}

export type ParseConstraint =
{
    type     : string
    value?   : any
    message? : string
};

/**
 * Applies defaults, transforms, then validator constraint helpers; throws ParseError on failure.
 */
export function applyParseConstraints(
    val         : any,
    path        : string,
    constraints : ParseConstraint[],
    from?       : 'json' | 'query'
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
        else if( c.type === 'transform' ){ transforms.push( c ) }
        else if( c.type === 'message' ){ messageC.push( c ) }
        else { remaining.push( c ) }
    }

    if( v === undefined && defaultC.length > 0 ){ v = defaultC[0].value }

    if( v !== undefined && v !== null )
    {
        for( const tc of transforms )
        {
            if( tc.value === 'lowercase' && typeof v === 'string' ){ v = v.toLowerCase() }
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
                throw new ParseError( path, msg || `MinLength<${c.value}>` );
            }
        }
        else if( c.type === 'maxLength' )
        {
            if( typeof v === 'string' && v.length > c.value )
            {
                throw new ParseError( path, msg || `MaxLength<${c.value}>` );
            }
        }
        else if( c.type === 'minimum' )
        {
            if( typeof v === 'number' && v < c.value )
            {
                throw new ParseError( path, msg || `Minimum<${c.value}>` );
            }
        }
        else if( c.type === 'maximum' )
        {
            if( typeof v === 'number' && v > c.value )
            {
                throw new ParseError( path, msg || `Maximum<${c.value}>` );
            }
        }
        else if( c.type === 'exclusiveMinimum' )
        {
            if( typeof v === 'number' && v <= c.value )
            {
                throw new ParseError( path, msg || `ExclusiveMinimum<${c.value}>` );
            }
        }
        else if( c.type === 'exclusiveMaximum' )
        {
            if( typeof v === 'number' && v >= c.value )
            {
                throw new ParseError( path, msg || `ExclusiveMaximum<${c.value}>` );
            }
        }
        else if( c.type === 'multipleOf' )
        {
            if( typeof v === 'number' && c.value !== 0 && v % c.value !== 0 )
            {
                throw new ParseError( path, msg || `MultipleOf<${c.value}>` );
            }
        }
        else if( c.type === 'pattern' )
        {
            if( typeof v === 'string' )
            {
                const regex = getCachedPattern( c.value );

                if( !regex ){ throw new ParseError( path, msg || 'UnsafePattern' ) }

                if( !regex.test( v ))
                {
                    throw new ParseError( path, msg || `Pattern<'${c.value}'>` );
                }
            }
        }
        else if( c.type === 'minItems' )
        {
            if( Array.isArray( v ) && v.length < c.value )
            {
                throw new ParseError( path, msg || `MinItems<${c.value}>` );
            }
        }
        else if( c.type === 'maxItems' )
        {
            if( Array.isArray( v ) && v.length > c.value )
            {
                throw new ParseError( path, msg || `MaxItems<${c.value}>` );
            }
        }
        else if( c.type === 'format' )
        {
            const ctx =
            {
                success : true,
                errors  : [] as { path: string, value: any, error: string }[],
                mode    : 'strict' as const,
                from,
                root    : v
            };
            v = validators.format( v, path, ctx as any, c.value, msg );

            if( !ctx.success )
            {
                throw new ParseError( path, ctx.errors[0]?.error || msg || `Format<${c.value}>` );
            }
        }
        else if( c.type === 'requires' )
        {
            const keys = Array.isArray( c.value ) ? c.value : [c.value];

            for( const key of keys )
            {
                if( v == null || v[key] === undefined )
                {
                    throw new ParseError( path, msg || `Requires<${key}>` );
                }
            }
        }
        else if( c.type === 'uniqueItems' )
        {
            if( Array.isArray( v ))
            {
                const seen = new Set<string>();

                for( const item of v )
                {
                    const key = JSON.stringify( item );

                    if( seen.has( key ))
                    {
                        throw new ParseError( path, msg || 'UniqueItems' );
                    }

                    seen.add( key );
                }
            }
        }
    }

    return v;
}
