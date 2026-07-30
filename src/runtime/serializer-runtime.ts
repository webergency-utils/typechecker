export class SerializationError extends Error
{
    constructor( public readonly path: string, message: string )
    {
        super( path ? `Serialization error at "${path}": ${message}` : message );
        this.name = 'SerializationError';
    }
}

export function serializeString( val: string, path = '' ): string
{
    if( typeof val !== 'string' )
    {
        throw new SerializationError( path, `Expected string, got ${typeof val}` );
    }

    return JSON.stringify( val );
}

export function serializeDate( val: Date | string | number, path = '' ): string
{
    if( val instanceof Date )
    {
        if( isNaN( val.getTime())){ throw new SerializationError( path, 'Expected valid Date' ) }

        return `"${val.toISOString()}"`;
    }

    if( typeof val === 'string' || typeof val === 'number' )
    {
        const d = new Date( val );

        if( !isNaN( d.getTime())){ return `"${d.toISOString()}"` }
    }

    throw new SerializationError( path, `Expected valid Date, got ${String( val )}` );
}

export function serializeBuffer( val: Uint8Array | ArrayBuffer, path = '' ): string
{
    if( val instanceof Uint8Array || ( typeof Buffer !== 'undefined' && Buffer.isBuffer( val ) ) || val instanceof ArrayBuffer )
    {
        const buf = val instanceof Uint8Array ? val : new Uint8Array( val );

        return `"${Buffer.from( buf ).toString( 'base64' )}"`;
    }

    throw new SerializationError( path, `Expected Uint8Array or Buffer, got ${typeof val}` );
}

export function serializeArray<T>( val: T[], mapper: ( item: T ) => string, path = '' ): string
{
    if( !Array.isArray( val ))
    {
        throw new SerializationError( path, `Expected array, got ${typeof val}` );
    }

    const parts: string[] = [];

    for( let i = 0; i < val.length; i++ )
    {
        parts.push( mapper( val[i] ) );
    }

    return `[${parts.join( ',' )}]`;
}
