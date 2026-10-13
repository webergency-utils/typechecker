/** Join a parent path with a property key without a leading `.` on the root. */
export function childPath( path: string, key: string ): string
{
    if( !path ){ return key }

    return path + '.' + key;
}

/** Join a parent path with an array index segment (`[n]`). */
export function indexPath( path: string, index: number | string ): string
{
    return path + '[' + index + ']';
}

export function isIndexSegment( seg: string ): boolean
{
    return seg.startsWith( '[' ) && seg.endsWith( ']' );
}

export function tokenizePath( path: string ): string[]
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

export function joinPathSegments( segments: string[]): string
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

export function resolvePath( currentPath: string, targetPath: string ): string
{
    if( !targetPath.startsWith( '.' ))
    {
        return targetPath;
    }

    const dotsMatch = targetPath.match( /^\.+/ )!;
    const dots = dotsMatch[0].length;
    const targetClean = targetPath.substring( dots );

    const currentParts = tokenizePath( currentPath );
    const baseParts = currentParts.slice( 0, Math.max( 0, currentParts.length - dots ));

    if( targetClean )
    {
        baseParts.push( ...tokenizePath( targetClean ));
    }

    return joinPathSegments( baseParts );
}

export function getValueAtPath( obj: any, path: string ): any
{
    if( !obj || typeof obj !== 'object' ){ return undefined }

    const parts = tokenizePath( path );

    if( parts.length === 0 ){ return obj }

    let current = obj;

    for( const part of parts )
    {
        if( current === null || current === undefined || typeof current !== 'object' )
        {
            return undefined;
        }

        if( part.startsWith( '[' ) && part.endsWith( ']' ))
        {
            const idx = parseInt( part.slice( 1, -1 ), 10 );
            current = current[idx];
        }
        else
        {
            current = current[part];
        }
    }

    return current;
}

export function hasPath( obj: any, path: string ): boolean
{
    const val = getValueAtPath( obj, path );

    return val !== undefined && val !== null;
}

