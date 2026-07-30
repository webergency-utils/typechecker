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
