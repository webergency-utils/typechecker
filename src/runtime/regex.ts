const regexSafetyCache = new WeakMap<RegExp, boolean>();
const compiledPatternCache = new Map<string, RegExp>();
const MAX_PATTERN_CACHE_SIZE = 1024;

function isDisjointLiteralAlternation( inner: string ): boolean
{
    if( /[.*+?^${}()[\]\\]/.test( inner )){ return false }

    const branches = inner.split( '|' );
    const seenFirst = new Set<string>();

    for( const b of branches )
    {
        if( b.length === 0 ){ return false }

        const first = b[0];

        if( seenFirst.has( first )){ return false }

        seenFirst.add( first );
    }

    return true;
}

export function isSafeRegexSource( source: string ): boolean
{
    if( source.length > 1024 || /\\[1-9]/.test( source )){ return false }

    const groups: { hasRepeat : boolean, hasAlternation : boolean, start : number }[] = [];
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
            const bodyStart = source.startsWith( '?:', i + 1 ) ? i + 3 : i + 1;
            groups.push({ hasRepeat : false, hasAlternation : false, start : bodyStart });
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

            if( isRepeated )
            {
                if( group.hasRepeat ){ return false }

                if( group.hasAlternation && !isDisjointLiteralAlternation( source.slice( group.start, i )))
                {
                    return false;
                }

                if( groups.length > 0 ){ groups[groups.length - 1].hasRepeat = true }
            }
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

    if( compiledPatternCache.size >= MAX_PATTERN_CACHE_SIZE )
    {
        const oldest = compiledPatternCache.keys().next().value!;
        compiledPatternCache.delete( oldest );
    }

    compiledPatternCache.set( source, regex );

    return regex;
}

const MAX_REGEX_TEST_LENGTH = 10_000;

export function testRegex( regex: RegExp, value: string ): boolean
{
    // Bound subject length to limit polynomial ReDoS on library-input regexes.
    // Unsafe user patterns are rejected earlier via createSafeRegex / isRegexSafe.
    if( value.length > MAX_REGEX_TEST_LENGTH ){ return false }

    if( !regex.global && !regex.sticky ){ return regex.test( value ) }

    const copy = new RegExp( regex.source, regex.flags );

    return copy.test( value );
}
