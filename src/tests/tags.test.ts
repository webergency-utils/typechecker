import { describe, expect, test } from 'vitest';
import { tag, constraint, ResolveDefaults } from '../runtime/tags.js';

describe( 'ResolveDefaults', () => 
{
    test( 'makes properties with tag.Default required', () => 
    {
        interface TestInterface 
        {
            a?: string & tag.Default<'a'>;
            b?: string;
            c: number;
            d: {
                e?: number & tag.Default<1>;
            };
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
    });

    test( 'allows assigning plain T to T & tag.Default', () => 
    {
        type AType = { foo: string };
        type BType = { foo: string & tag.Default<'v'> };

        const aObj: AType = { foo : 'test' };
        const bObj: BType = aObj;

        expect( bObj.foo ).toBe( 'test' );
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
        type Plain = { age: number; name: string };
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
