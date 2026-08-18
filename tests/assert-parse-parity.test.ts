import { describe, it, expect, beforeAll } from 'vitest';
import { emitAndImport } from './helpers/compile.js';

type ValidateResult =
    {
        success : boolean
        errors  : { path : string, error : string, value? : unknown }[]
        data?   : unknown
    };

type ParityFns =
    {
        assert   : ( value: unknown ) => unknown
        parse    : ( value: string ) => unknown
        validate : ( value: unknown ) => ValidateResult
        wire     : 'json' | 'query'
    };

type CanonicalFailure =
    {
        path : string
        code : string
    };

/**
 * Map assert / parse wording onto one canonical failure so the suite can assert shared semantics
 * even where wrappers still differ (`Validation Error:` vs `ParseError`).
 *
 * Note: `parse` options (`mode` / `from`) are compile-time only — each export below bakes them into
 * a distinct `__parse_*` hoist, matching how assert receives the same options at runtime.
 */
function canonicalizeFailure( path: string, code: string ): CanonicalFailure
{
    const p = path.replace( /^\./, '' );
    let c = code;

    const notAllowed = c.match( /^PropertyNotAllowed<(.+)>$/ );

    if( notAllowed )
    {
        return { path : notAllowed[1], code : `PropertyNotAllowed<${notAllowed[1]}>` };
    }

    // Assert labels unions with the alias (`Type<Shape>`); fold alias / quoted-literal unions.
    if(
        c === 'Type<Union>' ||
        c.startsWith( 'Type<Union' ) ||
        /^Type<".*"(\|".*")*>$/.test( c ) ||
        /^Type<'.*'(\|'.*')*>$/.test( c ) ||
        /^Type<[A-Z][A-Za-z0-9_]*>$/.test( c )
    )
    {
        if( c === 'Type<string>' || c === 'Type<number>' || c === 'Type<boolean>' ||
            c === 'Type<bigint>' || c === 'Type<Object>' || c === 'Type<Array>' ||
            c === 'Type<Date>' || c === 'Type<null>' || c === 'Type<undefined>' ||
            c === 'Type<never>' || c === 'Type<symbol>' || c === 'Type<function>' )
        {
            return { path : p, code : c };
        }

        return { path : p, code : 'Type<Union>' };
    }

    // Pattern<'x'> (parse) vs Pattern<x> (assert) — compare without the extra quotes.
    c = c.replace( /^Pattern<'(.*)'>$/, 'Pattern<$1>' );

    return { path : p, code : c };
}

function isParseError( err: unknown ): err is { name : string, path : string, message : string }
{
    return Boolean(
        err &&
        typeof err === 'object' &&
        ( err as { name? : string }).name === 'ParseError' &&
        typeof ( err as { path? : unknown }).path === 'string' &&
        typeof ( err as { message? : unknown }).message === 'string'
    );
}

function failureFromValidate( result: ValidateResult ): CanonicalFailure
{
    expect( result.success ).toBe( false );
    expect( result.errors.length ).toBeGreaterThan( 0 );

    const first = result.errors[0];

    return canonicalizeFailure( first.path, first.error );
}

function failureFromParse( err: unknown ): CanonicalFailure
{
    expect( isParseError( err )).toBe( true );

    const pe = err as { path : string, message : string };
    const body = pe.message
        .replace( /^Parse error at "[^"]*":\s*/, '' )
        .replace( /^Parse error:\s*/, '' );

    return canonicalizeFailure( pe.path, body );
}

function objectToQuery( input: unknown ): string
{
    if( typeof input !== 'object' || input === null || Array.isArray( input ))
    {
        throw new Error( 'objectToQuery expects a flat object' );
    }

    const parts: string[] = [];

    for( const [ key, value ] of Object.entries( input as Record<string, unknown> ))
    {
        if( value === undefined ){ continue }

        if( Array.isArray( value ))
        {
            for( const item of value )
            {
                parts.push( `${encodeURIComponent( key )}=${encodeURIComponent( String( item ))}` );
            }

            continue;
        }

        parts.push( `${encodeURIComponent( key )}=${encodeURIComponent( String( value ))}` );
    }

    return parts.join( '&' );
}

function toParseWire( input: unknown, wire: 'json' | 'query' ): string
{
    if( typeof input === 'string' ){ return input }

    if( wire === 'query' ){ return objectToQuery( input ) }

    return JSON.stringify( input );
}

function expectParitySuccess( fns: ParityFns, input: unknown )
{
    const asserted = fns.assert( input );
    const parsed = fns.parse( toParseWire( input, fns.wire ));

    expect( parsed ).toEqual( asserted );
    expect( fns.validate( input )).toMatchObject({ success : true, data : asserted });
}

function expectParityThrow( fns: ParityFns, input: unknown, expected?: Partial<CanonicalFailure> )
{
    const validated = fns.validate( input );
    const assertFailure = failureFromValidate( validated );

    expect(() => fns.assert( input )).toThrow( /Validation Error/ );

    let thrown: unknown;

    try
    {
        fns.parse( toParseWire( input, fns.wire ));
        expect.unreachable( 'parse should throw' );
    }
    catch( e )
    {
        thrown = e;
    }

    const parseFailure = failureFromParse( thrown );

    expect( parseFailure ).toEqual( assertFailure );

    if( expected?.path !== undefined ){ expect( parseFailure.path ).toBe( expected.path ) }

    if( expected?.code !== undefined ){ expect( parseFailure.code ).toBe( expected.code ) }
}

describe( 'assert ↔ parse parity', () =>
{
    let mod: {
        userStrip        : ParityFns
        userStrict       : ParityFns
        userRelaxed      : ParityFns
        customStrip      : ParityFns
        customQuery      : ParityFns
        taggedStrip      : ParityFns
        taggedQuery      : ParityFns
        plainUnion       : ParityFns
        queryRow         : ParityFns
        defaults         : ParityFns
        nested           : ParityFns
        patterns         : ParityFns
        tuplesStrip      : ParityFns
        enumStrip        : ParityFns
        bigintQuery      : ParityFns
        recordStrip      : ParityFns
        requiresStrip    : ParityFns
        arrayStrip       : ParityFns
        propsStrip       : ParityFns
        containsStrip    : ParityFns
        namesStrip       : ParityFns
        brandStrip       : ParityFns
        litStrip         : ParityFns
        maxLenStrip      : ParityFns
        queryDefaults    : ParityFns
        nestedCustom     : ParityFns
        intersectionObjs : ParityFns
    };

    beforeAll( async() =>
    {
        mod = await emitAndImport<typeof mod>( `
            import { assert, parse, validate, constraint, transform, tag, format } from '../src/index.js';

            function addPrefix( val: string )
            {
                return 'web_' + val;
            }

            function startsWithWeb( val: string )
            {
                return typeof val === 'string' && val.startsWith( 'web_' );
            }

            function isEven( val: number )
            {
                return typeof val === 'number' && val % 2 === 0;
            }

            interface User
            {
                name : string & transform.Trim & constraint.MinLength<2>
                age  : number & constraint.Minimum<18>
                role?: string & tag.Default<'guest'>
            }

            interface CustomRow
            {
                code : string & transform.Custom<typeof addPrefix>
                key  : string & constraint.Custom<typeof startsWithWeb>
                n    : number & constraint.Custom<typeof isEven, 'must be even'>
            }

            type Shape =
                | { kind: 'circle'; r: number & constraint.Minimum<0> }
                | { kind: 'square'; s: number & constraint.Minimum<0> };

            type IdOrName =
                | { id: string & constraint.MinLength<1> }
                | { name: string & transform.Trim & constraint.MinLength<2> };

            interface QueryRow
            {
                q      : string & transform.Trim & constraint.MinLength<1>
                page   : number & constraint.Minimum<1>
                active : boolean
                tags?  : string[]
            }

            interface DefaultsRow
            {
                host?: string & tag.Default<'localhost'>
                port?: number & tag.Default<8080>
                name : string & transform.UpperCase
            }

            interface Nested
            {
                user :
                {
                    profile :
                    {
                        email : string & format.Email
                        age   : number & constraint.Maximum<120>
                    }
                }
                tags : string[] & constraint.MinItems<1> & constraint.UniqueItems
            }

            interface Patterns
            {
                code : string & constraint.Pattern<'^[A-Z]{2}[0-9]{2}$'>
                size : number & constraint.MultipleOf<5> & constraint.ExclusiveMinimum<0>
            }

            type Pair = [string, number];

            enum Color
            {
                Red = 'red',
                Blue = 'blue'
            }

            interface EnumRow
            {
                color : Color
            }

            interface BigRow
            {
                id : bigint
            }

            type Scores = Record<string, number>;

            interface RequiresRow
            {
                a : number
                b?: number
            }

            type RequiresTagged = RequiresRow & constraint.Requires<'b'>;

            interface ArrayRow
            {
                items : string[] & constraint.MinItems<2> & constraint.MaxItems<3>
            }

            type PropsBag = Record<string, number> & constraint.MinProperties<2> & constraint.MaxProperties<3>;

            type ContainsRow = ( string | number )[] &
                constraint.Contains<string & constraint.MinLength<2>> &
                constraint.MinContains<2> &
                constraint.MaxContains<3>;

            type NamesBag = Record<string, number> &
                constraint.PropertyNames<string & constraint.Pattern<'^[a-z]+$'>>;

            type UserId = string & { __brand: 'UserId' };

            interface BrandRow
            {
                id : UserId
            }

            interface LitRow
            {
                status : 'on' | 'off'
            }

            interface MaxLenRow
            {
                name : string & constraint.MaxLength<3>
            }

            interface QueryDefaultsRow
            {
                q?: string & tag.Default<'*'>
                n : number
            }

            interface NestedCustom
            {
                meta :
                {
                    code : string & transform.Custom<typeof addPrefix>
                    key  : string & constraint.Custom<typeof startsWithWeb>
                }
            }

            type IntersectionObjs = { a: string } & { b: number };

            type VR = { success: boolean; errors: { path: string; error: string; value?: unknown }[]; data?: unknown };

            function wrap(
                a: ( v: unknown ) => unknown,
                p: ( v: string ) => unknown,
                v: ( v: unknown ) => VR,
                wire: 'json' | 'query' = 'json'
            )
            {
                return { assert: a, parse: p, validate: v, wire };
            }

            export const userStrip = wrap(
                ( v ) => assert<User>( v, { mode: 'strip' } ),
                ( v ) => parse<User>( v, { mode: 'strip' } ),
                ( v ) => validate<User>( v, { mode: 'strip' } )
            );

            export const userStrict = wrap(
                ( v ) => assert<User>( v, { mode: 'strict' } ),
                ( v ) => parse<User>( v, { mode: 'strict' } ),
                ( v ) => validate<User>( v, { mode: 'strict' } )
            );

            export const userRelaxed = wrap(
                ( v ) => assert<User>( v, { mode: 'relaxed' } ),
                ( v ) => parse<User>( v, { mode: 'relaxed' } ),
                ( v ) => validate<User>( v, { mode: 'relaxed' } )
            );

            export const customStrip = wrap(
                ( v ) => assert<CustomRow>( v, { mode: 'strip' } ),
                ( v ) => parse<CustomRow>( v, { mode: 'strip' } ),
                ( v ) => validate<CustomRow>( v, { mode: 'strip' } )
            );

            export const customQuery = wrap(
                ( v ) => assert<CustomRow>( v, { mode: 'strip', from: 'query' } ),
                ( v ) => parse<CustomRow>( v, { mode: 'strip', from: 'query' } ),
                ( v ) => validate<CustomRow>( v, { mode: 'strip', from: 'query' } ),
                'query'
            );

            export const taggedStrip = wrap(
                ( v ) => assert<Shape>( v, { mode: 'strip' } ),
                ( v ) => parse<Shape>( v, { mode: 'strip' } ),
                ( v ) => validate<Shape>( v, { mode: 'strip' } )
            );

            export const taggedQuery = wrap(
                ( v ) => assert<Shape>( v, { mode: 'strip', from: 'query' } ),
                ( v ) => parse<Shape>( v, { mode: 'strip', from: 'query' } ),
                ( v ) => validate<Shape>( v, { mode: 'strip', from: 'query' } ),
                'query'
            );

            export const plainUnion = wrap(
                ( v ) => assert<IdOrName>( v, { mode: 'strip' } ),
                ( v ) => parse<IdOrName>( v, { mode: 'strip' } ),
                ( v ) => validate<IdOrName>( v, { mode: 'strip' } )
            );

            export const queryRow = wrap(
                ( v ) => assert<QueryRow>( v, { mode: 'strip', from: 'query' } ),
                ( v ) => parse<QueryRow>( v, { mode: 'strip', from: 'query' } ),
                ( v ) => validate<QueryRow>( v, { mode: 'strip', from: 'query' } ),
                'query'
            );

            export const defaults = wrap(
                ( v ) => assert<DefaultsRow>( v, { mode: 'strip' } ),
                ( v ) => parse<DefaultsRow>( v, { mode: 'strip' } ),
                ( v ) => validate<DefaultsRow>( v, { mode: 'strip' } )
            );

            export const nested = wrap(
                ( v ) => assert<Nested>( v, { mode: 'strip' } ),
                ( v ) => parse<Nested>( v, { mode: 'strip' } ),
                ( v ) => validate<Nested>( v, { mode: 'strip' } )
            );

            export const patterns = wrap(
                ( v ) => assert<Patterns>( v, { mode: 'strip' } ),
                ( v ) => parse<Patterns>( v, { mode: 'strip' } ),
                ( v ) => validate<Patterns>( v, { mode: 'strip' } )
            );

            export const tuplesStrip = wrap(
                ( v ) => assert<Pair>( v, { mode: 'strip' } ),
                ( v ) => parse<Pair>( v, { mode: 'strip' } ),
                ( v ) => validate<Pair>( v, { mode: 'strip' } )
            );

            export const enumStrip = wrap(
                ( v ) => assert<EnumRow>( v, { mode: 'strip' } ),
                ( v ) => parse<EnumRow>( v, { mode: 'strip' } ),
                ( v ) => validate<EnumRow>( v, { mode: 'strip' } )
            );

            export const bigintQuery = wrap(
                ( v ) => assert<BigRow>( v, { mode: 'strip', from: 'query' } ),
                ( v ) => parse<BigRow>( v, { mode: 'strip', from: 'query' } ),
                ( v ) => validate<BigRow>( v, { mode: 'strip', from: 'query' } ),
                'query'
            );

            export const recordStrip = wrap(
                ( v ) => assert<Scores>( v, { mode: 'strip' } ),
                ( v ) => parse<Scores>( v, { mode: 'strip' } ),
                ( v ) => validate<Scores>( v, { mode: 'strip' } )
            );

            export const requiresStrip = wrap(
                ( v ) => assert<RequiresTagged>( v, { mode: 'strip' } ),
                ( v ) => parse<RequiresTagged>( v, { mode: 'strip' } ),
                ( v ) => validate<RequiresTagged>( v, { mode: 'strip' } )
            );

            export const arrayStrip = wrap(
                ( v ) => assert<ArrayRow>( v, { mode: 'strip' } ),
                ( v ) => parse<ArrayRow>( v, { mode: 'strip' } ),
                ( v ) => validate<ArrayRow>( v, { mode: 'strip' } )
            );

            export const propsStrip = wrap(
                ( v ) => assert<PropsBag>( v, { mode: 'strip' } ),
                ( v ) => parse<PropsBag>( v, { mode: 'strip' } ),
                ( v ) => validate<PropsBag>( v, { mode: 'strip' } )
            );

            export const containsStrip = wrap(
                ( v ) => assert<ContainsRow>( v, { mode: 'strip' } ),
                ( v ) => parse<ContainsRow>( v, { mode: 'strip' } ),
                ( v ) => validate<ContainsRow>( v, { mode: 'strip' } )
            );

            export const namesStrip = wrap(
                ( v ) => assert<NamesBag>( v, { mode: 'strip' } ),
                ( v ) => parse<NamesBag>( v, { mode: 'strip' } ),
                ( v ) => validate<NamesBag>( v, { mode: 'strip' } )
            );

            export const brandStrip = wrap(
                ( v ) => assert<BrandRow>( v, { mode: 'strip' } ),
                ( v ) => parse<BrandRow>( v, { mode: 'strip' } ),
                ( v ) => validate<BrandRow>( v, { mode: 'strip' } )
            );

            export const litStrip = wrap(
                ( v ) => assert<LitRow>( v, { mode: 'strip' } ),
                ( v ) => parse<LitRow>( v, { mode: 'strip' } ),
                ( v ) => validate<LitRow>( v, { mode: 'strip' } )
            );

            export const maxLenStrip = wrap(
                ( v ) => assert<MaxLenRow>( v, { mode: 'strip' } ),
                ( v ) => parse<MaxLenRow>( v, { mode: 'strip' } ),
                ( v ) => validate<MaxLenRow>( v, { mode: 'strip' } )
            );

            export const queryDefaults = wrap(
                ( v ) => assert<QueryDefaultsRow>( v, { mode: 'strip', from: 'query' } ),
                ( v ) => parse<QueryDefaultsRow>( v, { mode: 'strip', from: 'query' } ),
                ( v ) => validate<QueryDefaultsRow>( v, { mode: 'strip', from: 'query' } ),
                'query'
            );

            export const nestedCustom = wrap(
                ( v ) => assert<NestedCustom>( v, { mode: 'strip' } ),
                ( v ) => parse<NestedCustom>( v, { mode: 'strip' } ),
                ( v ) => validate<NestedCustom>( v, { mode: 'strip' } )
            );

            export const intersectionObjs = wrap(
                ( v ) => assert<IntersectionObjs>( v, { mode: 'strip' } ),
                ( v ) => parse<IntersectionObjs>( v, { mode: 'strip' } ),
                ( v ) => validate<IntersectionObjs>( v, { mode: 'strip' } )
            );
        `, 'temp_assert_parse_parity' );
    }, 60_000 );

    describe( 'JSON success', () =>
    {
        it( 'matches on trimmed fields, defaults, and constraints', () =>
        {
            expectParitySuccess( mod.userStrip, { name : '  ab  ', age : 20 });
            expectParitySuccess( mod.userStrip, { name : 'Tom', age : 42, role : 'admin' });
        });

        it( 'matches on Custom transform + Custom constraints', () =>
        {
            expectParitySuccess( mod.customStrip, { code : 'abc', key : 'web_ok', n : 4 });
        });

        it( 'matches on tagged unions', () =>
        {
            expectParitySuccess( mod.taggedStrip, { kind : 'circle', r : 1.5 });
            expectParitySuccess( mod.taggedStrip, { kind : 'square', s : 0 });
        });

        it( 'matches on plain object unions', () =>
        {
            expectParitySuccess( mod.plainUnion, { id : 'x' });
            expectParitySuccess( mod.plainUnion, { name : '  ab  ' });
        });

        it( 'matches on defaults + UpperCase transform', () =>
        {
            expectParitySuccess( mod.defaults, { name : 'api' });
            expectParitySuccess( mod.defaults, { name : 'api', host : 'example.com', port : 443 });
        });

        it( 'matches on nested objects, formats, and unique arrays', () =>
        {
            expectParitySuccess( mod.nested, {
                user : { profile : { email : 'a@b.co', age : 30 }},
                tags : [ 'a', 'b' ]
            });
        });

        it( 'matches on pattern and multipleOf constraints', () =>
        {
            expectParitySuccess( mod.patterns, { code : 'AB12', size : 15 });
        });

        it( 'matches when parse receives a JSON string and assert receives the object', () =>
        {
            const obj = { name : '  hi  ', age : 19 };
            const fromAssert = mod.userStrip.assert( obj );
            const fromParse = mod.userStrip.parse( JSON.stringify( obj ));

            expect( fromParse ).toEqual( fromAssert );
        });
    });

    describe( 'JSON failures (same canonical error)', () =>
    {
        it( 'MinLength', () =>
        {
            expectParityThrow( mod.userStrip, { name : 'x', age : 20 }, {
                path : 'name', code : 'MinLength<2>'
            });
        });

        it( 'Minimum age', () =>
        {
            expectParityThrow( mod.userStrip, { name : 'ab', age : 10 }, {
                path : 'age', code : 'Minimum<18>'
            });
        });

        it( 'wrong base type on name', () =>
        {
            expectParityThrow( mod.userStrip, { name : 1, age : 20 }, {
                path : 'name', code : 'Type<string>'
            });
        });

        it( 'Custom constraint without message', () =>
        {
            expectParityThrow( mod.customStrip, { code : 'abc', key : 'bad', n : 2 }, {
                path : 'key', code : 'Custom<startsWithWeb>'
            });
        });

        it( 'Custom constraint with message', () =>
        {
            expectParityThrow( mod.customStrip, { code : 'abc', key : 'web_ok', n : 3 }, {
                path : 'n', code : 'must be even'
            });
        });

        it( 'tagged union unknown kind', () =>
        {
            expectParityThrow( mod.taggedStrip, { kind : 'triangle', r : 1 });
        });

        it( 'tagged union arm constraint', () =>
        {
            expectParityThrow( mod.taggedStrip, { kind : 'circle', r : -1 }, {
                path : 'r', code : 'Minimum<0>'
            });
        });

        it( 'plain union mismatch', () =>
        {
            expectParityThrow( mod.plainUnion, { other : true });
        });

        it( 'format.Email', () =>
        {
            expectParityThrow( mod.nested, {
                user : { profile : { email : 'not-an-email', age : 20 }},
                tags : [ 'a' ]
            }, {
                path : 'user.profile.email', code : 'Format<email>'
            });
        });

        it( 'UniqueItems', () =>
        {
            expectParityThrow( mod.nested, {
                user : { profile : { email : 'a@b.co', age : 20 }},
                tags : [ 'a', 'a' ]
            }, {
                path : 'tags', code : 'UniqueItems'
            });
        });

        it( 'Pattern', () =>
        {
            expectParityThrow( mod.patterns, { code : 'ab12', size : 15 }, {
                path : 'code', code : 'Pattern<^[A-Z]{2}[0-9]{2}$>'
            });
        });

        it( 'MultipleOf', () =>
        {
            expectParityThrow( mod.patterns, { code : 'AB12', size : 12 }, {
                path : 'size', code : 'MultipleOf<5>'
            });
        });

        it( 'ExclusiveMinimum', () =>
        {
            expectParityThrow( mod.patterns, { code : 'AB12', size : 0 }, {
                path : 'size', code : 'ExclusiveMinimum<0>'
            });
        });

        it( 'strict mode rejects extras with the same canonical code', () =>
        {
            expectParityThrow( mod.userStrict, { name : 'ab', age : 20, extra : 1 }, {
                path : 'extra', code : 'PropertyNotAllowed<extra>'
            });
        });
    });

    describe( 'query success', () =>
    {
        it( 'matches on object-shaped query input', () =>
        {
            expectParitySuccess( mod.queryRow, {
                q : '  hello  ', page : '2', active : 'true', tags : 'a'
            });
        });

        it( 'matches when parse receives a query string', () =>
        {
            const fromAssert = mod.queryRow.assert({
                q : 'hi', page : '1', active : 'false', tags : [ 'x', 'y' ]
            });
            const fromParse = mod.queryRow.parse( 'q=hi&page=1&active=false&tags=x&tags=y' );

            expect( fromParse ).toEqual( fromAssert );
        });

        it( 'matches Custom + constraints under from:query', () =>
        {
            expectParitySuccess( mod.customQuery, {
                code : 'abc', key : 'web_ok', n : '4'
            });
        });

        it( 'matches tagged union under from:query', () =>
        {
            expectParitySuccess( mod.taggedQuery, { kind : 'square', s : '3' });
        });
    });

    describe( 'query failures (same canonical error)', () =>
    {
        it( 'MinLength after trim', () =>
        {
            expectParityThrow( mod.queryRow, { q : '   ', page : '1', active : 'true' }, {
                path : 'q', code : 'MinLength<1>'
            });
        });

        it( 'Minimum page', () =>
        {
            expectParityThrow( mod.queryRow, { q : 'x', page : '0', active : 'true' }, {
                path : 'page', code : 'Minimum<1>'
            });
        });

        it( 'boolean coerce failure', () =>
        {
            expectParityThrow( mod.queryRow, { q : 'x', page : '1', active : 'maybe' }, {
                path : 'active', code : 'Type<boolean>'
            });
        });

        it( 'Custom even constraint with message', () =>
        {
            expectParityThrow( mod.customQuery, {
                code : 'abc', key : 'web_ok', n : '3'
            }, {
                path : 'n', code : 'must be even'
            });
        });

        it( 'Custom key constraint', () =>
        {
            expectParityThrow( mod.customQuery, {
                code : 'abc', key : 'nope', n : '2'
            }, {
                path : 'key', code : 'Custom<startsWithWeb>'
            });
        });

        it( 'tagged union arm constraint after number coerce', () =>
        {
            expectParityThrow( mod.taggedQuery, { kind : 'circle', r : '-1' }, {
                path : 'r', code : 'Minimum<0>'
            });
        });
    });

    describe( 'mode strip vs relaxed extras', () =>
    {
        it( 'strip drops extras for both', () =>
        {
            const input = { name : 'ab', age : 20, noise : 1 };

            expectParitySuccess( mod.userStrip, input );
            expect( mod.userStrip.assert( input )).toEqual({ name : 'ab', age : 20, role : 'guest' });
        });

        it( 'relaxed keeps extras for both', () =>
        {
            const input = { name : 'ab', age : 20, noise : 1 };

            expectParitySuccess( mod.userRelaxed, input );
            expect( mod.userRelaxed.assert( input )).toEqual({
                name : 'ab', age : 20, role : 'guest', noise : 1
            });
        });
    });

    describe( 'extended shapes (success)', () =>
    {
        it( 'tuples', () =>
        {
            expectParitySuccess( mod.tuplesStrip, [ 'a', 1 ]);
        });

        it( 'enums', () =>
        {
            expectParitySuccess( mod.enumStrip, { color : 'red' });
            expectParitySuccess( mod.enumStrip, { color : 'blue' });
        });

        it( 'bigint via query coerce', () =>
        {
            expectParitySuccess( mod.bigintQuery, { id : '42' });
        });

        it( 'Record<string, number>', () =>
        {
            expectParitySuccess( mod.recordStrip, { a : 1, b : 2 });
        });

        it( 'Requires sibling key', () =>
        {
            expectParitySuccess( mod.requiresStrip, { a : 1, b : 2 });
        });

        it( 'array MinItems/MaxItems', () =>
        {
            expectParitySuccess( mod.arrayStrip, { items : [ 'a', 'b' ] });
            expectParitySuccess( mod.arrayStrip, { items : [ 'a', 'b', 'c' ] });
        });

        it( 'object MinProperties/MaxProperties', () =>
        {
            expectParitySuccess( mod.propsStrip, { a : 1, b : 2 });
            expectParitySuccess( mod.propsStrip, { a : 1, b : 2, c : 3 });
        });

        it( 'Contains / MinContains / MaxContains', () =>
        {
            expectParitySuccess( mod.containsStrip, [ 'ab', 'cd' ]);
            expectParitySuccess( mod.containsStrip, [ 'ab', 1, 'cd' ]);
        });

        it( 'PropertyNames', () =>
        {
            expectParitySuccess( mod.namesStrip, { aa : 1, bb : 2 });
        });

        it( 'branded string', () =>
        {
            expectParitySuccess( mod.brandStrip, { id : 'uid-1' });
        });

        it( 'string literal union field', () =>
        {
            expectParitySuccess( mod.litStrip, { status : 'on' });
        });

        it( 'query defaults fill missing q', () =>
        {
            expectParitySuccess( mod.queryDefaults, { n : '3' });
        });

        it( 'nested Custom transform + constraint', () =>
        {
            expectParitySuccess( mod.nestedCustom, { meta : { code : 'abc', key : 'web_ok' } });
        });

        it( 'object intersection merge', () =>
        {
            expectParitySuccess( mod.intersectionObjs, { a : 'x', b : 1 });
        });
    });

    describe( 'extended shapes (failures)', () =>
    {
        it( 'tuple wrong length', () =>
        {
            expectParityThrow( mod.tuplesStrip, [ 'a' ]);
        });

        it( 'tuple wrong element type', () =>
        {
            expectParityThrow( mod.tuplesStrip, [ 'a', 'nope' ], {
                path : '[1]', code : 'Type<number>'
            });
        });

        it( 'enum mismatch', () =>
        {
            expectParityThrow( mod.enumStrip, { color : 'green' });
        });

        it( 'Record value type', () =>
        {
            expectParityThrow( mod.recordStrip, { a : 'x' }, {
                path : 'a', code : 'Type<number>'
            });
        });

        it( 'Requires missing sibling', () =>
        {
            expectParityThrow( mod.requiresStrip, { a : 1 }, {
                path : '', code : 'Requires<b>'
            });
        });

        it( 'MinItems', () =>
        {
            expectParityThrow( mod.arrayStrip, { items : [ 'a' ] }, {
                path : 'items', code : 'MinItems<2>'
            });
        });

        it( 'MaxItems', () =>
        {
            expectParityThrow( mod.arrayStrip, { items : [ 'a', 'b', 'c', 'd' ] }, {
                path : 'items', code : 'MaxItems<3>'
            });
        });

        it( 'MinProperties', () =>
        {
            expectParityThrow( mod.propsStrip, { a : 1 }, {
                path : '', code : 'MinProperties<2>'
            });
        });

        it( 'MaxProperties', () =>
        {
            expectParityThrow( mod.propsStrip, { a : 1, b : 2, c : 3, d : 4 }, {
                path : '', code : 'MaxProperties<3>'
            });
        });

        it( 'Contains min', () =>
        {
            expectParityThrow( mod.containsStrip, [ 'ab', 1 ], {
                path : '', code : 'Contains<min:2>'
            });
        });

        it( 'Contains max', () =>
        {
            expectParityThrow( mod.containsStrip, [ 'ab', 'cd', 'ef', 'gh' ], {
                path : '', code : 'Contains<max:3>'
            });
        });

        it( 'PropertyNames mismatch', () =>
        {
            expectParityThrow( mod.namesStrip, { AA : 1 });
        });

        it( 'literal field mismatch', () =>
        {
            expectParityThrow( mod.litStrip, { status : 'maybe' });
        });

        it( 'MaxLength', () =>
        {
            expectParityThrow( mod.maxLenStrip, { name : 'abcd' }, {
                path : 'name', code : 'MaxLength<3>'
            });
        });

        it( 'nested Custom constraint', () =>
        {
            expectParityThrow( mod.nestedCustom, { meta : { code : 'abc', key : 'bad' } }, {
                path : 'meta.key', code : 'Custom<startsWithWeb>'
            });
        });

        it( 'query number coerce failure', () =>
        {
            expectParityThrow( mod.queryRow, { q : 'x', page : 'abc', active : 'true' }, {
                path : 'page', code : 'Type<number>'
            });
        });

        it( 'intersection missing prop', () =>
        {
            expect(() => mod.intersectionObjs.assert({ a : 'x' })).toThrow( /Validation Error/ );
            expect(() => mod.intersectionObjs.parse( JSON.stringify({ a : 'x' }))).toThrow( /Parse error/ );
        });
    });
});
