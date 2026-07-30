const regexSafetyCache = new WeakMap<RegExp, boolean>();
const compiledPatternCache = new Map<string, RegExp>();

export function isSafeRegexSource( source: string ): boolean
{
    if( source.length > 1024 || /\\[1-9]/.test( source )){ return false }

    const groups: { hasRepeat : boolean, hasAlternation : boolean }[] = [];
    let inClass = false;
    let escaped = false;

    for( let i = 0; i < source.length; i++ )
    {
        const ch = source[i];

        if( escaped )
        {
            escaped = false;
            continue;
        }

        if( ch === '\\' )
        {
            escaped = true;
            continue;
        }

        if( ch === '[' )
        {
            inClass = true;
            continue;
        }

        if( ch === ']' && inClass )
        {
            inClass = false;
            continue;
        }

        if( inClass ){ continue }

        if( ch === '(' )
        {
            groups.push({ hasRepeat : false, hasAlternation : false });
            continue;
        }

        if( ch === '|' && groups.length > 0 )
        {
            groups[groups.length - 1].hasAlternation = true;
            continue;
        }

        if( ch === '*' || ch === '+' || ch === '{' )
        {
            if( groups.length > 0 ){ groups[groups.length - 1].hasRepeat = true }
            continue;
        }

        if( ch === ')' && groups.length > 0 )
        {
            const group = groups.pop()!;
            const next = source[i + 1];
            const isRepeated = next === '*' || next === '+' || next === '{';

            if( isRepeated && ( group.hasRepeat || group.hasAlternation )){ return false }

            if( isRepeated && groups.length > 0 ){ groups[groups.length - 1].hasRepeat = true }
        }
    }

    return true;
}

export function isRegexSafe( regex: RegExp ): boolean
{
    const cached = regexSafetyCache.get( regex );

    if( cached !== undefined ){ return cached }

    const safe = isSafeRegexSource( regex.source );
    regexSafetyCache.set( regex, safe );

    return safe;
}

export function createSafeRegex( source: string, flags?: string ): RegExp
{
    if( !isSafeRegexSource( source )){ throw new Error( `Unsafe regular expression: ${source}` ) }

    const regex = flags === undefined ? new RegExp( source ) : new RegExp( source, flags );
    regexSafetyCache.set( regex, true );

    return regex;
}

/** Compile + cache a pattern string for hot parse/validate loops (flags empty). */
export function getCachedPattern( source: string ): RegExp | undefined
{
    const hit = compiledPatternCache.get( source );

    if( hit ){ return hit }

    if( !isSafeRegexSource( source )){ return undefined }

    const regex = new RegExp( source );
    regexSafetyCache.set( regex, true );
    compiledPatternCache.set( source, regex );

    return regex;
}

export function testRegex( regex: RegExp, value: string ): boolean
{
    if( !regex.global && !regex.sticky ){ return regex.test( value ) }

    const copy = new RegExp( regex.source, regex.flags );

    return copy.test( value );
}
