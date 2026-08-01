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
        params.push( encodeURIComponent( prefix ) + '=' + encodeURIComponent( leafQueryValue( val ) ) );

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
    if( val instanceof Uint8Array || ( typeof Buffer !== 'undefined' && Buffer.isBuffer( val ) ) || val instanceof ArrayBuffer )
    {
        const buf = val instanceof Uint8Array ? val : new Uint8Array( val );

        return `"${Buffer.from( buf ).toString( 'base64' )}"`;
    }

    throw new SerializationError( path, 'Type<Buffer>' );
}

export function serializeArray<T>( val: T[], mapper: ( item: T ) => string, path = '' ): string
{
    if( !Array.isArray( val ))
    {
        throw new SerializationError( path, 'Type<Array>' );
    }

    const parts: string[] = [];

    for( let i = 0; i < val.length; i++ )
    {
        parts.push( mapper( val[i] ) );
    }

    return `[${parts.join( ',' )}]`;
}

export function serializeUnion(
    val      : any,
    path     : string,
    expected : string,
    arms     : Array<( val: any ) => string>
): string
{
    let last: SerializationError | undefined;

    for( const arm of arms )
    {
        try
        {
            return arm( val );
        }
        catch( e )
        {
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
