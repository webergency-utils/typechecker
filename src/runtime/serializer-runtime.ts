export class SerializationError extends Error 
{
    constructor( public readonly path: string, message: string ) 
    {
        super( message );
        this.name = 'SerializationError';
    }
}

export function serializeString( val: string ): string 
{
    if( typeof val !== 'string' ) 
    {
        throw new SerializationError( '', `Expected string, got ${typeof val}` );
    }

    return JSON.stringify( val );
}

export function serializeDate( val: Date | string | number ): string 
{
    if( val instanceof Date ) 
    {
        return `"${val.toISOString()}"`;
    }

    if( typeof val === 'string' || typeof val === 'number' ) 
    {
        const d = new Date( val );

        if( !isNaN( d.getTime() ))
        {
            return `"${d.toISOString()}"`;
        }
    }

    throw new SerializationError( '', 'Expected valid Date' );
}

export function serializeBuffer( val: Uint8Array | Buffer ): string 
{
    if( !( val instanceof Uint8Array ))
    {
        throw new SerializationError( '', 'Expected Uint8Array / Buffer' );
    }

    return JSON.stringify( Buffer.from( val ).toString( 'base64' ));
}

export function serializeArray<T>( arr: T[], itemSerializer: ( item: T ) => string ): string 
{
    if( !Array.isArray( arr ))
    {
        throw new SerializationError( '', 'Expected Array' );
    }

    let res = '[';

    for( let i = 0; i < arr.length; i++ ) 
    {
        if( i > 0 ){ res += ',' }
        res += itemSerializer( arr[i] );
    }

    return res + ']';
}
