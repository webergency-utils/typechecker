import type { CoercionKind } from './validators.js';

export type JsonReviver = ( this: any, key: string, value: any ) => any;
export type JsonReplacer = ( this: any, key: string, value: any ) => any;

export type TransformFn = ( value: unknown, ctx: TransformContext ) => unknown;

export interface TransformContext
{
    key    : string
    path   : string
    parent : any
    root   : any
    index? : number
    tags   : string[]
    type   : CoercionKind
}

/** Thrown from the revive/transform walk so callers can wrap a path-aware public error. */
export class TransformWalkError extends Error
{
    public readonly path : string;

    public constructor( path: string, cause: unknown )
    {
        super( cause instanceof Error ? cause.message : String( cause ));
        this.name = 'TransformWalkError';
        this.path = path;
    }
}

/**
 * ECMA-262 `InternalizeJSONProperty` walk. Root `key === ''`, `this` is the holder,
 * returning `undefined` deletes the property. Array keys are `'0'`, `'1'`, …
 */
export function reviveTree( value: any, reviver: JsonReviver ): any
{
    const holder: { '' : any } = { '' : value };

    return internalizeJsonProperty( holder, '', reviver, '' );
}

function internalizeJsonProperty(
    holder  : any,
    name    : string,
    reviver : JsonReviver,
    path    : string
): any
{
    const val = holder[name];

    if( val !== null && typeof val === 'object' )
    {
        if( Array.isArray( val ))
        {
            const len = val.length;

            for( let i = 0; i < len; i++ )
            {
                const key = String( i );
                const childPath = path + '[' + i + ']';
                const next = internalizeJsonProperty( val, key, reviver, childPath );

                if( next === undefined )
                {
                    delete val[i];
                }
                else
                {
                    val[i] = next;
                }
            }
        }
        else
        {
            const keys = Object.keys( val );

            for( let k = 0; k < keys.length; k++ )
            {
                const key = keys[k];
                const childPath = path ? path + '.' + key : key;
                const next = internalizeJsonProperty( val, key, reviver, childPath );

                if( next === undefined )
                {
                    delete val[key];
                }
                else
                {
                    val[key] = next;
                }
            }
        }
    }

    try
    {
        return reviver.call( holder, name, val );
    }
    catch( e )
    {
        if( e instanceof TransformWalkError ){ throw e }

        if( e && typeof e === 'object' && typeof ( e as { path? : unknown } ).path === 'string' )
        {
            throw e;
        }

        throw new TransformWalkError( path, e );
    }
}

export function applyNodeTransform(
    value     : any,
    path      : string,
    transform : TransformFn | TransformFn[] | undefined,
    kind      : CoercionKind,
    tags      : string[],
    root      : any
): any
{
    if( transform == null || value === undefined || value === null ){ return value }

    const fns = Array.isArray( transform ) ? transform : [transform];

    if( fns.length === 0 ){ return value }

    const ctx = makeTransformContext( path, kind, tags, root );
    let current = value;

    for( let i = 0; i < fns.length; i++ )
    {
        current = fns[i]( current, ctx );
    }

    return current;
}

export function makeTransformContext(
    path : string,
    kind : CoercionKind,
    tags : string[],
    root : any
): TransformContext
{
    if( !path )
    {
        return { key : '', path : '', parent : undefined, root, tags, type : kind };
    }

    const parts = tokenizePath( path );
    const parentPath = joinPathSegments( parts.slice( 0, -1 ));
    const parent = parentPath === '' && parts.length > 0
        ? root
        : valueAtPath( root, parentPath );
    const last = parts[parts.length - 1];
    let index: number | undefined;

    if( last && isIndexSegment( last ))
    {
        const parsed = parseInt( last.slice( 1, -1 ), 10 );

        if( !Number.isNaN( parsed )){ index = parsed }
    }

    let key = '';

    for( let i = parts.length - 1; i >= 0; i-- )
    {
        if( !isIndexSegment( parts[i]))
        {
            key = parts[i];
            break;
        }
    }

    if( index === undefined ){ return { key, path, parent, root, tags, type : kind } }

    return { key, path, parent, root, index, tags, type : kind };
}

function isIndexSegment( seg: string ): boolean
{
    return seg.startsWith( '[' ) && seg.endsWith( ']' );
}

function tokenizePath( path: string ): string[]
{
    const cleanPath = path.startsWith( '.' ) ? path.substring( 1 ) : path;

    if( !cleanPath ){ return [] }

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

    if( buf ){ segments.push( buf ) }

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

function valueAtPath( obj: any, path: string ): any
{
    if( !obj || typeof obj !== 'object' ){ return undefined }

    const parts = tokenizePath( path );

    if( parts.length === 0 ){ return obj }

    let current = obj;

    for( let i = 0; i < parts.length; i++ )
    {
        if( current === null || current === undefined || typeof current !== 'object' )
        {
            return undefined;
        }

        const part = parts[i];

        if( part.startsWith( '[' ) && part.endsWith( ']' ))
        {
            current = current[parseInt( part.slice( 1, -1 ), 10 )];
        }
        else
        {
            current = current[part];
        }
    }

    return current;
}
