import { validators } from './validators.js';

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

const intRE = /^[0-9]+$/;

function isUnsafeKey( key: string | number ): boolean
{
    return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

function createPlainObject(): Record<string | number, any>
{
    return {};
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
                    decodeURIComponent( querystring.substring( last_pair, value ).replace( /\+/g, ' ' )),
                    decodeURIComponent( querystring.substring( value + 1, pair ).replace( /\+/g, ' ' ))
                );
            }
            else
            {
                assign( decodeURIComponent( querystring.substring( last_pair, pair ).replace( /\+/g, ' ' )), true );
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

    throw new ParseError( path, `Expected number, got ${typeof val === 'string' ? `"${val}"` : String( val )}` );
}

export function coerceBoolean( val: any, path: string ): boolean
{
    if( typeof val === 'boolean' ){ return val }
    if( val === 'true' || val === '1' || val === 1 || val === true ){ return true }
    if( val === 'false' || val === '0' || val === 0 || val === false ){ return false }

    throw new ParseError( path, `Expected boolean, got ${typeof val === 'string' ? `"${val}"` : String( val )}` );
}

export function coerceDate( val: any, path: string ): Date
{
    if( val instanceof Date && !isNaN( val.getTime())){ return val }

    if( typeof val === 'string' || typeof val === 'number' )
    {
        const d = new Date( val );

        if( !isNaN( d.getTime())){ return d }
    }

    throw new ParseError( path, `Expected valid Date, got ${String( val )}` );
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

    throw new ParseError( path, `Expected Buffer or base64 string, got ${String( val )}` );
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
            throw new ParseError( path, `Expected bigint, got "${val}"` );
        }
    }

    if( typeof val === 'number' && Number.isFinite( val ) && Number.isInteger( val ))
    {
        return BigInt( val );
    }

    throw new ParseError( path, `Expected bigint, got ${String( val )}` );
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
    const defaultC = constraints.find( c => c.type === 'default' );
    const transforms = constraints.filter( c => c.type === 'transform' );
    const messageC = constraints.find( c => c.type === 'message' );
    const remaining = constraints.filter( c =>
        c.type !== 'default' && c.type !== 'transform' && c.type !== 'message'
    );

    if( v === undefined && defaultC ){ v = defaultC.value }

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
        const msg = c.message || messageC?.value;

        if( c.type === 'minLength' )
        {
            if( typeof v === 'string' && v.length < c.value )
            {
                throw new ParseError( path, msg || `minLength ${c.value}` );
            }
        }
        else if( c.type === 'maxLength' )
        {
            if( typeof v === 'string' && v.length > c.value )
            {
                throw new ParseError( path, msg || `maxLength ${c.value}` );
            }
        }
        else if( c.type === 'minimum' )
        {
            if( typeof v === 'number' && v < c.value )
            {
                throw new ParseError( path, msg || `minimum ${c.value}` );
            }
        }
        else if( c.type === 'maximum' )
        {
            if( typeof v === 'number' && v > c.value )
            {
                throw new ParseError( path, msg || `maximum ${c.value}` );
            }
        }
        else if( c.type === 'exclusiveMinimum' )
        {
            if( typeof v === 'number' && v <= c.value )
            {
                throw new ParseError( path, msg || `exclusiveMinimum ${c.value}` );
            }
        }
        else if( c.type === 'exclusiveMaximum' )
        {
            if( typeof v === 'number' && v >= c.value )
            {
                throw new ParseError( path, msg || `exclusiveMaximum ${c.value}` );
            }
        }
        else if( c.type === 'multipleOf' )
        {
            if( typeof v === 'number' && c.value !== 0 && v % c.value !== 0 )
            {
                throw new ParseError( path, msg || `multipleOf ${c.value}` );
            }
        }
        else if( c.type === 'pattern' )
        {
            if( typeof v === 'string' && !( new RegExp( c.value )).test( v ))
            {
                throw new ParseError( path, msg || `pattern ${c.value}` );
            }
        }
        else if( c.type === 'minItems' )
        {
            if( Array.isArray( v ) && v.length < c.value )
            {
                throw new ParseError( path, msg || `minItems ${c.value}` );
            }
        }
        else if( c.type === 'maxItems' )
        {
            if( Array.isArray( v ) && v.length > c.value )
            {
                throw new ParseError( path, msg || `maxItems ${c.value}` );
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
                throw new ParseError( path, ctx.errors[0]?.error || msg || `format ${c.value}` );
            }
        }
        else if( c.type === 'requires' )
        {
            const keys = Array.isArray( c.value ) ? c.value : [c.value];

            for( const key of keys )
            {
                if( v == null || v[key] === undefined )
                {
                    throw new ParseError( path, msg || `requires ${key}` );
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
                        throw new ParseError( path, msg || 'uniqueItems' );
                    }

                    seen.add( key );
                }
            }
        }
    }

    return v;
}
