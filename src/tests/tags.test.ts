import { describe, expect, expectTypeOf, test } from 'vitest';
import { tag, constraint, ResolveDefaults } from '../runtime/tags.js';
import type { ConvertPropertyCasing } from '../runtime/casing.js';

describe( 'ResolveDefaults', () =>
{
    test( 'makes properties with tag.Default required', () =>
    {
        interface TestInterface
        {
            a? : string & tag.Default<'a'>
            b? : string
            c  : number
            d: {
                e? : number & tag.Default<1>
            }
        }

        type Resolved = ResolveDefaults<TestInterface>;

        const x: Resolved = {
            a : 'a',
            c : 123,
            d : {
                e : 1
            }
        };

        expect( x.a ).toBe( 'a' );
        expect( x.c ).toBe( 123 );
        expect( x.d.e ).toBe( 1 );

        expectTypeOf<Resolved>().toMatchTypeOf<{
            a : string
            b? : string
            c : number
            d : { e : number }
        }>();
        expectTypeOf<Resolved>().not.toMatchTypeOf<{ a? : string }>();
    });

    test( 'keeps optional properties without Default optional', () =>
    {
        type Schema = {
            required : string
            optional? : number
            defaulted? : boolean & tag.Default<false>
        };
        type Resolved = ResolveDefaults<Schema>;

        expectTypeOf<Resolved>().toMatchTypeOf<{
            required : string
            optional? : number
            defaulted : boolean
        }>();

        // `optional` may be omitted; `defaulted` may not.
        const ok: Resolved = { required : 'x', defaulted : false };
        expect( ok.required ).toBe( 'x' );
    });

    test( 'makes a required property with Default stay required', () =>
    {
        type Schema = { retries : number & tag.Default<5> };
        type Resolved = ResolveDefaults<Schema>;

        expectTypeOf<Resolved>().toMatchTypeOf<{ retries : number }>();
        expectTypeOf<Resolved>().not.toMatchTypeOf<{ retries? : number }>();
    });

    test( 'resolves Defaults through arrays of objects', () =>
    {
        type Item = { name? : string & tag.Default<'anon'>; age? : number };
        type Schema = { items : Item[] };
        type Resolved = ResolveDefaults<Schema>;

        expectTypeOf<Resolved['items'][number]>().toMatchTypeOf<{
            name : string
            age? : number
        }>();
    });

    test( 'resolves nested Defaults independently of the parent optionality', () =>
    {
        type Schema = {
            nested? : {
                port? : number & tag.Default<8080>
                host? : string
            }
        };
        type Resolved = ResolveDefaults<Schema>;

        // Parent stays optional (no Default on nested itself); inner port becomes required.
        expectTypeOf<Resolved>().toMatchTypeOf<{
            nested? : { port : number; host? : string }
        }>();
    });

    test( 'composes with ConvertPropertyCasing like AppConfig / PollerConfig', () =>
    {
        type PollerConfigSchema = {
            MAILBOX_ADDRESS : string
            POLL_INTERVAL_MS? : number & constraint.Minimum<0> & tag.Default<60000>
            MARK_AS_READ? : boolean & tag.Default<false>
            PAGE_SIZE? : number
        };

        type PollerConfig = ResolveDefaults<ConvertPropertyCasing<PollerConfigSchema, 'camelCase'>>;

        expectTypeOf<PollerConfig>().toMatchTypeOf<{
            mailboxAddress : string
            pollIntervalMs : number
            markAsRead : boolean
            pageSize? : number
        }>();
        expectTypeOf<PollerConfig>().not.toMatchTypeOf<{ pollIntervalMs? : number }>();
        expectTypeOf<PollerConfig>().not.toMatchTypeOf<{ MARK_AS_READ? : boolean }>();
    });

    test( 'preserves Default beside other constraint tags at the type level', () =>
    {
        type Schema = {
            size? : number & constraint.Range<1, 99> & tag.Default<10>
        };
        type Resolved = ResolveDefaults<Schema>;

        expectTypeOf<Resolved>().toMatchTypeOf<{ size : number }>();

        // Plain numbers remain assignable into the tagged property type.
        const resolved: Resolved = { size : 10 };
        expect( resolved.size ).toBe( 10 );
    });

    test( 'allows assigning plain T to T & tag.Default', () =>
    {
        type AType = { foo : string };
        type BType = { foo : string & tag.Default<'v'> };

        const aObj: AType = { foo : 'test' };
        const bObj: BType = aObj;

        expect( bObj.foo ).toBe( 'test' );
    });

    test( 'keeps Map, Set, Promise, and RegExp as identity', () =>
    {
        type WithContainers = {
            m? : Map<string, number> & tag.Default<Map<string, number>>
            s? : Set<string>
            p  : Promise<string>
            r  : RegExp
        };

        type Resolved = ResolveDefaults<WithContainers>;

        const m = new Map<string, number>([['a', 1]]);
        const resolved: Resolved = {
            m,
            s : new Set([ 'x' ]),
            p : Promise.resolve( 'ok' ),
            r : /abc/
        };

        expect( resolved.m ).toBe( m );
        expect( resolved.s ).toBeInstanceOf( Set );
        expect( resolved.r ).toBeInstanceOf( RegExp );

        expectTypeOf<Resolved>().toMatchTypeOf<{
            m : Map<string, number>
            s? : Set<string>
            p : Promise<string>
            r : RegExp
        }>();
    });

    test( 'leaves primitives and nullish unions alone', () =>
    {
        expectTypeOf<ResolveDefaults<string>>().toEqualTypeOf<string>();
        expectTypeOf<ResolveDefaults<number | undefined>>().toEqualTypeOf<number | undefined>();
        expectTypeOf<ResolveDefaults<null>>().toEqualTypeOf<null>();
    });
});

describe( 'constraint tag assignability', () =>
{
    test( 'allows plain values to assign to tagged primitives (optional phantoms)', () =>
    {
        const age: number & constraint.Minimum<2> = 2;
        const young: number & constraint.Minimum<2> = 1;
        const capped: number & constraint.Maximum<10> = 11;
        const name: string & constraint.MinLength<3> = 'ab';
        const tags: string[] & constraint.MinItems<2> = ['a'];

        expect( age ).toBe( 2 );
        expect( young ).toBe( 1 );
        expect( capped ).toBe( 11 );
        expect( name ).toBe( 'ab' );
        expect( tags ).toEqual([ 'a' ]);
    });

    test( 'allows assigning untagged object shapes into tagged shapes', () =>
    {
        type Plain = { age : number, name : string };
        type Tagged = {
            age  : number & constraint.Minimum<18>
            name : string & constraint.MinLength<3>
        };

        const plain: Plain = { age : 5, name : 'x' };
        const tagged: Tagged = plain;

        expect( tagged.age ).toBe( 5 );
        expect( tagged.name ).toBe( 'x' );
    });

    test( 'composites Range and Length remain assignable from plain values', () =>
    {
        const n: number & constraint.Range<1, 10> = 0;
        const s: string & constraint.Length<2, 4> = 'a';

        expect( n ).toBe( 0 );
        expect( s ).toBe( 'a' );
    });
});
