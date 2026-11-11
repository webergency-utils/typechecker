import { isPlainObject } from './validators.js';
import { getCachedPattern, testRegex } from './regex.js';
export { isPlainObject, getCachedPattern, testRegex };

export type CompiledCloner<T> = ( input: T ) => T;

export type CompiledPruner<T> = ( input: T ) => T;

export interface UnionArmSpec
{
    match      : ( v: any ) => boolean
    run        : ( v: any ) => any
    scoreKeys? : readonly string[]
}

export function setSafeProp( target: Record<string, any>, key: string, val: any ): void
{
    if( key === '__proto__' || key === 'constructor' || key === 'prototype' )
    {
        Object.defineProperty( target, key, {
            value        : val,
            enumerable   : true,
            configurable : true,
            writable     : true
        });
    }
    else
    {
        target[key] = val;
    }
}

export function cloneDate( val: Date ): Date
{
    return new Date( val.getTime());
}

export function cloneUrl( val: URL ): URL
{
    return new URL( val.href );
}

export function cloneRegExp( val: RegExp ): RegExp
{
    const out = new RegExp( val.source, val.flags );
    out.lastIndex = val.lastIndex;

    return out;
}

export function cloneBuffer( val: Buffer ): Buffer
{
    return Buffer.from( val );
}

export function cloneBinary( val: any, typeName: string ): any
{
    if( typeName === 'ArrayBuffer' )
    {
        return ( val as ArrayBuffer ).slice( 0 );
    }

    if( typeName === 'SharedArrayBuffer' )
    {
        const out = new SharedArrayBuffer(( val as SharedArrayBuffer ).byteLength );
        new Uint8Array( out ).set( new Uint8Array( val as SharedArrayBuffer ));

        return out;
    }

    if( typeName === 'DataView' )
    {
        const view = val as DataView;

        return new DataView( view.buffer.slice( view.byteOffset, view.byteOffset + view.byteLength ));
    }

    return new ( val.constructor as any )( val );
}

export function cloneBlob( val: Blob ): Blob
{
    return val.slice( 0, val.size, val.type );
}

export function cloneFile( val: File ): File
{
    return new File(
        [ val.slice( 0, val.size, val.type ) ],
        val.name,
        { type : val.type, lastModified : val.lastModified }
    );
}

export function cloneSet<T>( val: ReadonlySet<T>, cloneElem: ( item: T ) => T ): Set<T>
{
    const out = new Set<T>();

    for( const item of val )
    {
        out.add( cloneElem( item ));
    }

    return out;
}

export function cloneMap<K, V>(
    val      : ReadonlyMap<K, V>,
    cloneKey : ( k: K ) => K,
    cloneVal : ( v: V ) => V
): Map<K, V>
{
    const out = new Map<K, V>();

    for( const [ k, v ] of val.entries())
    {
        out.set( cloneKey( k ), cloneVal( v ));
    }

    return out;
}

export function cloneClassInstance<T extends object>(
    val             : T,
    cloneKnownProps : ( src: any, dst: any ) => void,
    knownKeys       : ReadonlySet<string>
): T
{
    const dst = Object.create( Object.getPrototypeOf( val ));
    cloneKnownProps( val, dst );

    for( const k of Object.keys( val ))
    {
        if( !knownKeys.has( k ))
        {
            setSafeProp( dst, k, cloneAny(( val as any )[k]));
        }
    }

    return dst;
}

export function cloneAny( val: any, seen?: WeakMap<object, any> ): any
{
    if( val === null || typeof val !== 'object' ){ return val }

    if( seen?.has( val )){ return seen.get( val ) }

    if( val instanceof Date ){ return cloneDate( val ) }

    if( val instanceof URL ){ return cloneUrl( val ) }

    if( val instanceof RegExp ){ return cloneRegExp( val ) }

    if( val instanceof File ){ return cloneFile( val ) }

    if( val instanceof Blob ){ return cloneBlob( val ) }

    if( Buffer.isBuffer( val )){ return cloneBuffer( val ) }

    if( val instanceof ArrayBuffer ){ return cloneBinary( val, 'ArrayBuffer' ) }

    if( val instanceof SharedArrayBuffer ){ return cloneBinary( val, 'SharedArrayBuffer' ) }

    if( val instanceof DataView ){ return cloneBinary( val, 'DataView' ) }

    if( ArrayBuffer.isView( val )){ return cloneBinary( val, 'TypedArray' ) }

    const map = seen ?? new WeakMap<object, any>();

    if( Array.isArray( val ))
    {
        const out = new Array( val.length );
        map.set( val, out );

        for( let i = 0; i < val.length; i++ )
        {
            out[i] = cloneAny( val[i], map );
        }

        return out;
    }

    if( val instanceof Set )
    {
        const out = new Set<any>();
        map.set( val, out );

        for( const item of val )
        {
            out.add( cloneAny( item, map ));
        }

        return out;
    }

    if( val instanceof Map )
    {
        const out = new Map<any, any>();
        map.set( val, out );

        for( const [ k, v ] of val.entries())
        {
            out.set( cloneAny( k, map ), cloneAny( v, map ));
        }

        return out;
    }

    const proto = Object.getPrototypeOf( val );
    const out = proto === null ? Object.create( null ) : Object.create( proto );
    map.set( val, out );

    for( const k of Object.keys( val ))
    {
        setSafeProp( out, k, cloneAny( val[k], map ));
    }

    return out;
}

export function dispatchUnion( val: any, arms: readonly UnionArmSpec[]): any
{
    let bestArm: UnionArmSpec | undefined;
    let bestScore = -1;

    for( let i = 0; i < arms.length; i++ )
    {
        const arm = arms[i];

        if( !arm.match( val )){ continue }

        if( !arm.scoreKeys ){ return arm.run( val ) }

        let score = 0;

        for( let j = 0; j < arm.scoreKeys.length; j++ )
        {
            const k = arm.scoreKeys[j];

            if( Object.hasOwn( val, k ) && val[k] !== undefined ){ score++ }
        }

        if( score > bestScore )
        {
            bestScore = score;
            bestArm = arm;
        }
    }

    return bestArm ? bestArm.run( val ) : val;
}
