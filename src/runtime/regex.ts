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

interface ParsedQuantifier
{
    kind    : 'none' | 'optional' | 'fixed' | 'variable'
    end     : number
    invalid : boolean
}

function readQuantifier( source: string, pos: number ): ParsedQuantifier
{
    if( pos >= source.length )
    {
        return { kind : 'none', end : pos, invalid : false };
    }

    const ch = source[pos];

    if( ch === '*' || ch === '+' )
    {
        const end = source[pos + 1] === '?' ? pos + 2 : pos + 1;

        return { kind : 'variable', end, invalid : false };
    }

    if( ch === '?' )
    {
        const end = source[pos + 1] === '?' ? pos + 2 : pos + 1;

        return { kind : 'optional', end, invalid : false };
    }

    if( ch === '{' )
    {
        const match = /^\{(\d+)(?:,(\d*))?\}\??/.exec( source.slice( pos ));

        if( !match )
        {
            return { kind : 'none', end : pos, invalid : false };
        }

        const end = pos + match[0].length;
        const min = Number( match[1]);

        if( min > 100 )
        {
            return { kind : 'variable', end, invalid : true };
        }

        if( match[2] === undefined )
        {
            const kind = min === 0 ? 'optional' : ( min === 1 ? 'none' : 'fixed' );

            return { kind, end, invalid : false };
        }

        if( match[2] === '' )
        {
            return { kind : 'variable', end, invalid : false };
        }

        const max = Number( match[2]);

        if( max > 100 || max < min )
        {
            return { kind : 'variable', end, invalid : true };
        }

        if( min === max )
        {
            const kind = min === 0 ? 'optional' : ( min === 1 ? 'none' : 'fixed' );

            return { kind, end, invalid : false };
        }

        if( min === 0 && max === 1 )
        {
            return { kind : 'optional', end, invalid : false };
        }

        return { kind : 'variable', end, invalid : false };
    }

    return { kind : 'none', end : pos, invalid : false };
}

interface RegexGroupFrame
{
    hasVarOrOpt    : boolean
    hasFixed       : boolean
    hasAlternation : boolean
    hasUnsafeAlt   : boolean
    start          : number
}

export function isSafeRegexSource( source: string ): boolean
{
    if( source.length > 1024 ){ return false }

    const groups: RegexGroupFrame[] = [];
    let inClass = false;

    for( let i = 0; i < source.length; i++ )
    {
        const ch = source[i];

        if( ch === '\\' )
        {
            if( i + 1 >= source.length ){ return false }

            const next = source[i + 1];

            if( !inClass && (( next >= '1' && next <= '9' ) || next === 'k' ))
            {
                return false;
            }

            i++;
            continue;
        }

        if( ch === '[' && !inClass )
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
            if( source[i + 1] === '?' )
            {
                if( source.startsWith( '<=', i + 2 ) || source.startsWith( '<!', i + 2 ))
                {
                    i += 3;
                }
                else if( source[i + 2] === '<' )
                {
                    const gt = source.indexOf( '>', i + 3 );

                    if( gt === -1 ){ return false }

                    i = gt;
                }
                else if( source[i + 2] === ':' || source[i + 2] === '=' || source[i + 2] === '!' )
                {
                    i += 2;
                }
            }

            groups.push({
                hasVarOrOpt    : false,
                hasFixed       : false,
                hasAlternation : false,
                hasUnsafeAlt   : false,
                start          : i + 1
            });
            continue;
        }

        if( ch === '|' && groups.length > 0 )
        {
            groups[groups.length - 1].hasAlternation = true;
            continue;
        }

        if( ch === ')' && groups.length > 0 )
        {
            const group = groups.pop()!;
            const unsafeAlt = group.hasUnsafeAlt ||
                ( group.hasAlternation && !isDisjointLiteralAlternation( source.slice( group.start, i )));
            const q = readQuantifier( source, i + 1 );

            if( q.invalid ){ return false }

            i = q.end - 1;
            const parent = groups.length > 0 ? groups[groups.length - 1] : undefined;

            if( q.kind === 'variable' )
            {
                if( group.hasVarOrOpt || group.hasFixed || unsafeAlt ){ return false }

                if( parent ){ parent.hasVarOrOpt = true }
            }
            else if( q.kind === 'fixed' )
            {
                if( group.hasVarOrOpt || unsafeAlt ){ return false }

                if( parent ){ parent.hasFixed = true }
            }
            else if( q.kind === 'optional' )
            {
                if( parent ){ parent.hasVarOrOpt = true }
            }
            else if( parent )
            {
                if( group.hasVarOrOpt ){ parent.hasVarOrOpt = true }

                if( group.hasFixed ){ parent.hasFixed = true }

                if( unsafeAlt ){ parent.hasUnsafeAlt = true }
            }

            continue;
        }

        if( ch === '*' || ch === '+' || ch === '?' || ch === '{' )
        {
            const q = readQuantifier( source, i );

            if( q.invalid ){ return false }

            if( q.end > i )
            {
                i = q.end - 1;

                if( q.kind !== 'none' && groups.length > 0 )
                {
                    if( q.kind === 'fixed' ){ groups[groups.length - 1].hasFixed = true }
                    else { groups[groups.length - 1].hasVarOrOpt = true }
                }
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
