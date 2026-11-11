import { hasUniqueItems } from './validators.js';
import { setSafeProp } from './clone-runtime.js';
export { setSafeProp };

export type Rng = () => number;

export type CompiledRandomGenerator<T> = ( seed?: number ) => T;

export interface NumberRandomOpts
{
    min?     : number
    max?     : number
    exclMin? : number
    exclMax? : number
    step?    : number
    integer? : boolean
}

export interface BigIntRandomOpts
{
    min?     : bigint
    max?     : bigint
    exclMin? : bigint
    exclMax? : bigint
    step?    : bigint
}

export interface StringRandomOpts
{
    minLength?  : number
    maxLength?  : number
    format?     : string
    pattern?    : string
    mapping?    : string
    transforms? : readonly string[]
    minDateMs?  : number
    maxDateMs?  : number
}

export interface ArrayRandomOpts<T>
{
    minItems?    : number
    maxItems?    : number
    unique?      : boolean
    containsGen? : ( rng: Rng ) => T
    minContains? : number
    maxContains? : number
}

const ALPHANUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LOWER_ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const HEX = '0123456789abcdef';
const PRINTABLE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.:/@';

export function createRng( seed?: number ): Rng
{
    if( seed === undefined ){ return Math.random }

    let s = seed | 0;

    return (): number =>
    {
        s = ( s + 0x6D2B79F5 ) | 0;
        let t = Math.imul( s ^ ( s >>> 15 ), 1 | s );
        t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t )) ^ t;

        return (( t ^ ( t >>> 14 )) >>> 0 ) / 4294967296;
    };
}

export function createRandomGenerator<T>(
    buildFn     : ( rng: Rng ) => T,
    defaultSeed?: number
): CompiledRandomGenerator<T>
{
    const defaultRng = createRng( defaultSeed );

    return ( seed?: number ): T =>
        buildFn( seed !== undefined ? createRng( seed ) : defaultRng );
}

export function randInt( rng: Rng, min: number, max: number ): number
{
    const hi = max < min ? min : max;

    return Math.floor( rng() * ( hi - min + 1 )) + min;
}

export function randBool( rng: Rng ): boolean
{
    return rng() >= 0.5;
}

function randChars( rng: Rng, alphabet: string, len: number ): string
{
    let out = '';

    for( let i = 0; i < len; i++ )
    {
        out += alphabet.charAt( randInt( rng, 0, alphabet.length - 1 ));
    }

    return out;
}

export function randNumber( rng: Rng, opts?: NumberRandomOpts ): number
{
    const step = opts?.step && opts.step > 0
        ? opts.step
        : ( opts?.integer ? 1 : undefined );
    const hasLower = opts?.min !== undefined || opts?.exclMin !== undefined;
    const hasUpper = opts?.max !== undefined || opts?.exclMax !== undefined;

    if( step !== undefined )
    {
        let kMin = 0;

        if( opts?.exclMin !== undefined )
        {
            kMin = Math.floor( opts.exclMin / step ) + 1;
        }

        if( opts?.min !== undefined )
        {
            const m = Math.ceil( opts.min / step );
            kMin = opts.exclMin !== undefined ? Math.max( kMin, m ) : m;
        }

        let kMax = kMin + 100;

        if( opts?.exclMax !== undefined )
        {
            kMax = Math.ceil( opts.exclMax / step ) - 1;
        }

        if( opts?.max !== undefined )
        {
            const m = Math.floor( opts.max / step );
            kMax = opts.exclMax !== undefined ? Math.min( kMax, m ) : m;
        }

        if( !hasLower && hasUpper )
        {
            kMin = kMax - 100;
        }

        const k = randInt( rng, kMin, Math.min( Math.max( kMin, kMax ), kMin + 10000 ));

        return Number.isInteger( step ) ? k * step : Number(( k * step ).toFixed( 10 ));
    }

    let lo = 0;

    if( opts?.exclMin !== undefined && opts?.min !== undefined )
    {
        lo = Math.max( opts.exclMin, opts.min );
    }
    else if( opts?.exclMin !== undefined )
    {
        lo = opts.exclMin;
    }
    else if( opts?.min !== undefined )
    {
        lo = opts.min;
    }

    let hi = lo + 100;

    if( opts?.exclMax !== undefined && opts?.max !== undefined )
    {
        hi = Math.min( opts.exclMax, opts.max );
    }
    else if( opts?.exclMax !== undefined )
    {
        hi = opts.exclMax;
    }
    else if( opts?.max !== undefined )
    {
        hi = opts.max;
    }

    if( !hasLower && hasUpper )
    {
        lo = hi - 100;
    }

    if( hi <= lo )
    {
        return lo;
    }

    const frac = 0.05 + rng() * 0.9;

    return lo + frac * ( hi - lo );
}

export function randBigInt( rng: Rng, opts?: BigIntRandomOpts ): bigint
{
    const hasLower = opts?.min !== undefined || opts?.exclMin !== undefined;
    const hasUpper = opts?.max !== undefined || opts?.exclMax !== undefined;
    let lo = 0n;

    if( opts?.exclMin !== undefined )
    {
        lo = opts.exclMin + 1n;
    }

    if( opts?.min !== undefined )
    {
        lo = opts.exclMin !== undefined && lo > opts.min ? lo : opts.min;
    }

    let hi = lo + 100n;

    if( opts?.exclMax !== undefined )
    {
        hi = opts.exclMax - 1n;
    }

    if( opts?.max !== undefined )
    {
        hi = opts.exclMax !== undefined && hi < opts.max ? hi : opts.max;
    }

    if( !hasLower && hasUpper )
    {
        lo = hi - 100n;
    }

    const step = opts?.step && opts.step > 0n ? opts.step : undefined;

    if( step !== undefined )
    {
        const rem = (( lo % step ) + step ) % step;

        if( rem !== 0n ){ lo += step - rem }

        const span = hi >= lo ? ( hi - lo ) / step : 0n;
        const maxSteps = span > 10000n ? 10000 : Number( span );

        return lo + BigInt( randInt( rng, 0, maxSteps )) * step;
    }

    const span = hi >= lo ? hi - lo : 0n;
    const maxSpan = span > 10000n ? 10000 : Number( span );

    return lo + BigInt( randInt( rng, 0, maxSpan ));
}

function pad2( n: number ): string
{
    return n < 10 ? `0${n}` : String( n );
}

const CROCKFORD32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LOWER_ALPHANUM = '0123456789abcdefghijklmnopqrstuvwxyz';
const JWT_HEADER_B64 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

export function randFormat( rng: Rng, fmt: string ): string
{
    const n = randInt( rng, 100, 9999 );

    switch ( fmt )
    {
        case 'uuid':
            return `${randChars( rng, HEX, 8 )}-${randChars( rng, HEX, 4 )}-4${randChars( rng, HEX, 3 )}-${'89ab'.charAt( randInt( rng, 0, 3 ))}${randChars( rng, HEX, 3 )}-${randChars( rng, HEX, 12 )}`;
        case 'ulid':
            return `01H${randChars( rng, CROCKFORD32, 23 )}`;
        case 'cuid2':
            return `${randChars( rng, LOWER_ALPHA, 1 )}${randChars( rng, LOWER_ALPHANUM, 23 )}`;
        case 'jwt':
        {
            const payload = Buffer.from( `{"sub":"${n}"}` ).toString( 'base64url' );
            const sig = Buffer.from( randChars( rng, ALPHANUM, 12 )).toString( 'base64url' );

            return `${JWT_HEADER_B64}.${payload}.${sig}`;
        }
        case 'semver':
            return `${randInt( rng, 0, 9 )}.${randInt( rng, 0, 20 )}.${randInt( rng, 0, 50 )}`;
        case 'base64url':
            return Buffer.from( randChars( rng, ALPHANUM, 9 )).toString( 'base64url' );
        case 'email':
        case 'idn-email':
            return `${randChars( rng, LOWER_ALPHA, 5 )}${n}@example.com`;
        case 'url':
        case 'uri':
        case 'iri':
            return `https://example.com/${randChars( rng, LOWER_ALPHA, 5 )}/${n}`;
        case 'uri-reference':
        case 'iri-reference':
            return `/${randChars( rng, LOWER_ALPHA, 5 )}/${n}`;
        case 'uri-template':
            return `https://example.com/items/{id_${n}}`;
        case 'hostname':
        case 'idn-hostname':
            return `${randChars( rng, LOWER_ALPHA, 5 )}-${n}.example.com`;
        case 'ipv4':
            return `${randInt( rng, 1, 254 )}.${randInt( rng, 0, 255 )}.${randInt( rng, 0, 255 )}.${randInt( rng, 1, 254 )}`;
        case 'ipv6':
        {
            const groups: string[] = [];

            for( let i = 0; i < 8; i++ )
            {
                groups.push( randChars( rng, HEX, 4 ));
            }

            return groups.join( ':' );
        }
        case 'date':
            return `${randInt( rng, 2000, 2030 )}-${pad2( randInt( rng, 1, 12 ))}-${pad2( randInt( rng, 1, 28 ))}`;
        case 'date-time':
            return `${randInt( rng, 2000, 2030 )}-${pad2( randInt( rng, 1, 12 ))}-${pad2( randInt( rng, 1, 28 ))}T${pad2( randInt( rng, 0, 23 ))}:${pad2( randInt( rng, 0, 59 ))}:${pad2( randInt( rng, 0, 59 ))}.000Z`;
        case 'time':
            return `${pad2( randInt( rng, 0, 23 ))}:${pad2( randInt( rng, 0, 59 ))}:${pad2( randInt( rng, 0, 59 ))}Z`;
        case 'duration':
            return `P${randInt( rng, 1, 9 )}DT${randInt( rng, 1, 23 )}H`;
        case 'byte':
            return Buffer.from( randChars( rng, ALPHANUM, 6 )).toString( 'base64' );
        case 'objectId':
            return randChars( rng, HEX, 24 );
        case 'regex':
            return `^[a-z]{${randInt( rng, 1, 5 )}}$`;
        default:
            return randChars( rng, ALPHANUM, 12 );
    }
}

function splitTopLevelAlternation( src: string ): string[]
{
    const parts: string[] = [];
    let depth = 0;
    let inClass = false;
    let start = 0;

    for( let i = 0; i < src.length; i++ )
    {
        const ch = src.charAt( i );

        if( ch === '\\' )
        {
            i++;
            continue;
        }

        if( inClass )
        {
            if( ch === ']' ){ inClass = false }

            continue;
        }

        if( ch === '[' ){ inClass = true }
        else if( ch === '(' ){ depth++ }
        else if( ch === ')' && depth > 0 ){ depth-- }
        else if( ch === '|' && depth === 0 )
        {
            parts.push( src.slice( start, i ));
            start = i + 1;
        }
    }

    parts.push( src.slice( start ));

    return parts;
}

function expandEscapeChars( ch: string ): string
{
    if( ch === 'd' ){ return '0123456789' }

    if( ch === 'w' ){ return `${ALPHANUM}_` }

    if( ch === 's' ){ return ' ' }

    if( ch === 'D' ){ return LOWER_ALPHA }

    if( ch === 'W' ){ return '-' }

    if( ch === 'S' ){ return ALPHANUM }

    if( ch === 't' ){ return '\t' }

    if( ch === 'n' ){ return '\n' }

    if( ch === 'r' ){ return '\r' }

    return ch;
}

function sampleCharClass( rng: Rng, body: string ): string
{
    const negated = body.startsWith( '^' );
    const raw = negated ? body.slice( 1 ) : body;
    const chars: string[] = [];

    for( let i = 0; i < raw.length; i++ )
    {
        if( raw.charAt( i ) === '\\' && i + 1 < raw.length )
        {
            const exp = expandEscapeChars( raw.charAt( ++i ));

            for( let j = 0; j < exp.length; j++ ){ chars.push( exp.charAt( j )) }

            continue;
        }

        if( i + 2 < raw.length && raw.charAt( i + 1 ) === '-' && raw.charAt( i + 2 ) !== '\\' )
        {
            const lo = raw.charCodeAt( i );
            const hi = raw.charCodeAt( i + 2 );

            for( let c = Math.min( lo, hi ); c <= Math.max( lo, hi ); c++ )
            {
                chars.push( String.fromCharCode( c ));
            }

            i += 2;
            continue;
        }

        chars.push( raw.charAt( i ));
    }

    if( negated )
    {
        const excluded = new Set( chars );
        const allowed: string[] = [];

        for( let i = 0; i < PRINTABLE.length; i++ )
        {
            const c = PRINTABLE.charAt( i );

            if( !excluded.has( c )){ allowed.push( c ) }
        }

        return allowed.length > 0 ? allowed[randInt( rng, 0, allowed.length - 1 )] : 'a';
    }

    return chars.length > 0 ? chars[randInt( rng, 0, chars.length - 1 )] : '';
}

function readQuantifier( src: string, idx: number ): [ number, number, number ]
{
    if( idx >= src.length ){ return [ 1, 1, idx ] }

    const ch = src.charAt( idx );
    let min = 1;
    let max = 1;
    let next = idx;

    if( ch === '?' ){ min = 0; max = 1; next = idx + 1 }
    else if( ch === '*' ){ min = 0; max = 3; next = idx + 1 }
    else if( ch === '+' ){ min = 1; max = 4; next = idx + 1 }
    else if( ch === '{' )
    {
        const close = src.indexOf( '}', idx + 1 );

        if( close !== -1 )
        {
            const spec = src.slice( idx + 1, close );
            const m = /^(\d+)(?:,(\d*))?$/.exec( spec );

            if( m )
            {
                min = parseInt( m[1], 10 );
                max = m[2] === undefined ? min : ( m[2] === '' ? min + 3 : parseInt( m[2], 10 ));
                next = close + 1;
            }
        }
    }

    if( next > idx && next < src.length && src.charAt( next ) === '?' )
    {
        next++;
    }

    return [ min, Math.max( min, max ), next ];
}

export function randFromPattern( rng: Rng, pattern: string ): string
{
    const branches = splitTopLevelAlternation( pattern );

    if( branches.length > 1 )
    {
        return randFromPattern( rng, branches[randInt( rng, 0, branches.length - 1 )]);
    }

    const src = branches[0];
    let out = '';
    let i = 0;

    while( i < src.length )
    {
        const ch = src.charAt( i );

        if( ch === '^' || ch === '$' )
        {
            i++;
            continue;
        }

        let unitGen: () => string;

        if( ch === '(' )
        {
            let depth = 1;
            let inClass = false;
            let end = i + 1;

            while( end < src.length && depth > 0 )
            {
                const c = src.charAt( end );

                if( c === '\\' ){ end += 2; continue }

                if( inClass )
                {
                    if( c === ']' ){ inClass = false }
                }
                else if( c === '[' ){ inClass = true }
                else if( c === '(' ){ depth++ }
                else if( c === ')' ){ depth-- }

                end++;
            }

            let inner = src.slice( i + 1, end - 1 );
            i = end;

            if( inner.startsWith( '?=' ) || inner.startsWith( '?!' ))
            {
                continue;
            }

            if( inner.startsWith( '?:' ))
            {
                inner = inner.slice( 2 );
            }

            const groupBody = inner;
            unitGen = () => randFromPattern( rng, groupBody );
        }
        else if( ch === '[' )
        {
            let end = i + 1;

            while( end < src.length )
            {
                if( src.charAt( end ) === '\\' ){ end += 2; continue }

                if( src.charAt( end ) === ']' ){ break }

                end++;
            }

            const clsBody = src.slice( i + 1, end );
            i = end + 1;
            unitGen = () => sampleCharClass( rng, clsBody );
        }
        else if( ch === '\\' && i + 1 < src.length )
        {
            const esc = src.charAt( i + 1 );
            i += 2;

            if( esc === 'b' || esc === 'B' ){ continue }

            if( esc === 'x' && i + 2 <= src.length )
            {
                const code = parseInt( src.slice( i, i + 2 ), 16 );
                i += 2;
                unitGen = () => String.fromCharCode( Number.isNaN( code ) ? 97 : code );
            }
            else if( esc === 'u' && i + 4 <= src.length )
            {
                const code = parseInt( src.slice( i, i + 4 ), 16 );
                i += 4;
                unitGen = () => String.fromCharCode( Number.isNaN( code ) ? 97 : code );
            }
            else
            {
                const pool = expandEscapeChars( esc );
                unitGen = () => pool.charAt( randInt( rng, 0, pool.length - 1 ));
            }
        }
        else if( ch === '.' )
        {
            i++;
            unitGen = () => ALPHANUM.charAt( randInt( rng, 0, ALPHANUM.length - 1 ));
        }
        else
        {
            i++;
            unitGen = () => ch;
        }

        const [ qMin, qMax, nextIdx ] = readQuantifier( src, i );
        i = nextIdx;
        const count = randInt( rng, qMin, Math.min( qMax, qMin + 8 ));

        for( let k = 0; k < count; k++ )
        {
            out += unitGen();
        }
    }

    return out;
}

function applyStringMapping( val: string, kind: string ): string
{
    if( kind === 'Uppercase' || kind === 'uppercase' ){ return val.toUpperCase() }

    if( kind === 'Lowercase' || kind === 'lowercase' ){ return val.toLowerCase() }

    if( kind === 'Capitalize' || kind === 'capitalize' )
    {
        return val.length > 0 ? val.charAt( 0 ).toUpperCase() + val.slice( 1 ) : val;
    }

    if( kind === 'Uncapitalize' )
    {
        return val.length > 0 ? val.charAt( 0 ).toLowerCase() + val.slice( 1 ) : val;
    }

    if( kind === 'trim' ){ return val.trim() }

    return val;
}

export function randString( rng: Rng, opts?: StringRandomOpts ): string
{
    let out: string;
    const hasDateBounds = opts?.minDateMs !== undefined || opts?.maxDateMs !== undefined;

    if( hasDateBounds && ( !opts?.format || opts.format === 'date' || opts.format === 'date-time' ))
    {
        const dayMs = 86400000;
        const effMin = opts?.format === 'date' && opts.minDateMs !== undefined
            ? Math.ceil( opts.minDateMs / dayMs ) * dayMs
            : opts?.minDateMs;
        const iso = randDate( rng, effMin, opts?.maxDateMs ).toISOString();
        out = opts?.format === 'date' ? iso.slice( 0, 10 ) : iso;
    }
    else if( opts?.format )
    {
        out = randFormat( rng, opts.format );
    }
    else if( opts?.pattern )
    {
        out = randFromPattern( rng, opts.pattern );
    }
    else
    {
        const minL = opts?.minLength ?? 4;
        const maxL = opts?.maxLength ?? Math.max( minL + 8, 12 );
        const len = randInt( rng, minL, Math.max( minL, maxL ));
        out = randChars( rng, ALPHANUM, len );
    }

    if( opts?.transforms )
    {
        for( const t of opts.transforms )
        {
            out = applyStringMapping( out, t );
        }
    }

    if( opts?.mapping )
    {
        out = applyStringMapping( out, opts.mapping );
    }

    return out;
}

export function randArray<T>(
    rng     : Rng,
    itemGen : ( rng: Rng ) => T,
    opts?   : ArrayRandomOpts<T>
): T[]
{
    const minContains = opts?.containsGen ? ( opts.minContains ?? 1 ) : 0;
    const minItems = Math.max( opts?.minItems ?? 1, minContains );
    const maxItems = opts?.maxItems ?? Math.max( minItems + 2, 3 );
    const targetLen = randInt( rng, minItems, Math.max( minItems, maxItems ));
    const out: T[] = [];

    if( opts?.containsGen )
    {
        const maxC = opts.maxContains !== undefined
            ? Math.min( opts.maxContains, targetLen )
            : minContains;
        const cCount = randInt( rng, Math.min( minContains, maxC ), Math.max( minContains, maxC ));

        for( let i = 0; i < cCount && out.length < targetLen; i++ )
        {
            out.push( opts.containsGen( rng ));
        }
    }

    while( out.length < targetLen )
    {
        const candidate = itemGen( rng );

        if( opts?.unique )
        {
            let accepted = false;

            for( let attempt = 0; attempt < 32; attempt++ )
            {
                const item = attempt === 0 ? candidate : itemGen( rng );
                out.push( item );

                if( hasUniqueItems( out ))
                {
                    accepted = true;
                    break;
                }

                out.pop();
            }

            if( !accepted ){ break }
        }
        else
        {
            out.push( candidate );
        }
    }

    return out;
}

export function randSet<T>(
    rng      : Rng,
    itemGen  : ( rng: Rng ) => T,
    minItems : number = 1,
    maxItems?: number
): Set<T>
{
    const hi = maxItems ?? Math.max( minItems + 2, 3 );
    const target = randInt( rng, minItems, Math.max( minItems, hi ));
    const out = new Set<T>();
    let attempts = 0;
    const limit = Math.max( target * 16, 32 );

    while( out.size < target && attempts < limit )
    {
        out.add( itemGen( rng ));
        attempts++;
    }

    return out;
}

export function randMap<K, V>(
    rng      : Rng,
    keyGen   : ( rng: Rng ) => K,
    valGen   : ( rng: Rng ) => V,
    minProps : number = 1,
    maxProps?: number
): Map<K, V>
{
    const hi = maxProps ?? Math.max( minProps + 2, 3 );
    const target = randInt( rng, minProps, Math.max( minProps, hi ));
    const out = new Map<K, V>();
    let attempts = 0;
    const limit = Math.max( target * 16, 32 );

    while( out.size < target && attempts < limit )
    {
        out.set( keyGen( rng ), valGen( rng ));
        attempts++;
    }

    return out;
}

export function randRecord<V>(
    rng      : Rng,
    keyGen   : ( rng: Rng ) => string,
    valGen   : ( rng: Rng ) => V,
    existing : Record<string, any>,
    minProps : number = 0,
    maxProps?: number
): Record<string, any>
{
    const currentCount = Object.keys( existing ).length;
    const effMin = Math.max( minProps, currentCount );
    const effMax = maxProps !== undefined
        ? Math.max( effMin, maxProps )
        : Math.max( effMin, currentCount + 2 );
    const target = randInt( rng, effMin, effMax );
    let count = currentCount;
    let attempts = 0;

    while( count < target && attempts < 64 )
    {
        const k = keyGen( rng );
        attempts++;

        if( Object.hasOwn( existing, k )){ continue }

        setSafeProp( existing, k, valGen( rng ));
        count++;
    }

    return existing;
}

export function randDate( rng: Rng, minMs?: number, maxMs?: number ): Date
{
    const lo = minMs !== undefined
        ? minMs
        : ( maxMs !== undefined ? maxMs - 86400000 * 365 : 1700000000000 );
    const hi = maxMs !== undefined ? maxMs : lo + 100000000 * 1000;
    const spanSec = hi > lo ? Math.min( Math.floor(( hi - lo ) / 1000 ), 100000000 ) : 0;

    return new Date( lo + randInt( rng, 0, spanSec ) * 1000 );
}

export function randUrl( rng: Rng ): URL
{
    return new URL( randFormat( rng, 'url' ));
}

export function randRegExp( rng: Rng ): RegExp
{
    return new RegExp( randFormat( rng, 'regex' ));
}

export function randBuffer( rng: Rng ): Buffer
{
    const buf = Buffer.alloc( 8 );

    for( let i = 0; i < 8; i++ )
    {
        buf[i] = randInt( rng, 0, 255 );
    }

    return buf;
}

export function randBinary( rng: Rng, typeName: string ): any
{
    const ab = new ArrayBuffer( 8 );
    const u8 = new Uint8Array( ab );

    for( let i = 0; i < 8; i++ )
    {
        u8[i] = randInt( rng, 0, 255 );
    }

    if( typeName === 'ArrayBuffer' ){ return ab }

    if( typeName === 'SharedArrayBuffer' )
    {
        const sab = new SharedArrayBuffer( 8 );
        new Uint8Array( sab ).set( u8 );

        return sab;
    }

    if( typeName === 'DataView' ){ return new DataView( ab ) }

    const ctor = ( globalThis as any )[typeName];

    return new ctor( ab );
}

export function randBlob( rng: Rng ): Blob
{
    return new Blob([ randChars( rng, ALPHANUM, 8 ) ], { type : 'text/plain' });
}

export function randFile( rng: Rng ): File
{
    return new File(
        [ randChars( rng, ALPHANUM, 8 ) ],
        `file-${randInt( rng, 100, 999 )}.txt`,
        { type : 'text/plain', lastModified : 1700000000000 }
    );
}
