import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validators, type ValidationContext, getOrCompileSchema, is, assert, assertGuard, validate } from '../src/runtime/validators.js';

describe( 'validators uniqueItems / commit / regex coverage', () =>
{
    let ctx: ValidationContext;

    beforeEach(() =>
    {
        ctx = { success : true, errors : [], mode : 'strict' };
    });

    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    describe( 'validators.assign and commitContainer via union mutate', () =>
    {
        it( 'should copy own properties with assign', () =>
        {
            // Arrange
            const target: any = { keep : 1 };
            const source = { a : 2, b : 3 };

            // Act
            const result = validators.assign( target, source );

            // Assert
            expect( result ).toBe( target );
            expect( target ).toEqual({ keep : 1, a : 2, b : 3 });
        });

        it( 'should commit a new array onto the original via is()', () =>
        {
            // Arrange
            const input = ['1', '2'];
            const fn = ( v: any ) => ( Array.isArray( v ) ? v.map( Number ) : v );

            // Act
            const ok = is( fn, input );

            // Assert
            expect( ok ).toBe( true );
            expect( input ).toEqual([1, 2]);
        });

        it( 'should commit a new Set / Map onto the original via is()', () =>
        {
            // Arrange
            const setInput = new Set(['1']);
            const setFn = ( v: any ) =>
            {
                if( !( v instanceof Set )){ return v }

                return new Set([ ...v ].map( Number ));
            };

            // Act
            expect( is( setFn, setInput )).toBe( true );

            // Assert
            expect([ ...setInput ]).toEqual([1]);

            // Arrange
            const mapInput = new Map([['a', '1']]);
            const mapFn = ( v: any ) =>
            {
                if( !( v instanceof Map )){ return v }

                return new Map([ ...v ].map(([ k, val ]) => [k, Number( val )]));
            };

            // Act
            expect( is( mapFn, mapInput )).toBe( true );

            // Assert
            expect([ ...mapInput.entries() ]).toEqual([['a', 1]]);
        });

        it( 'should return committed value from assert/validate when mutate copies containers', () =>
        {
            // Arrange
            const fn = ( v: any ) => ( Array.isArray( v ) ? v.map( Number ) : v );
            const input = ['1', '2'];

            // Act
            const asserted = assert( fn, input, { mutate : true });
            const other = ['3', '4'];
            const validated = validate( fn, other, { mutate : true });

            // Assert
            expect( asserted ).toBe( input );
            expect( input ).toEqual([1, 2]);
            expect( validated.success ).toBe( true );
            expect( validated.data ).toBe( other );
            expect( other ).toEqual([3, 4]);
        });

        it( 'should report RootNotRewritable when assertGuard cannot rewrite the root binding', () =>
        {
            // Arrange
            const rewrite = ( v: any ) => ( v === 1 ? 2 : v );

            // Act / Assert
            expect(() => assertGuard( rewrite, 1 )).toThrow( /RootNotRewritable|Validation Error/ );
        });

        it( 'should return rewritten primitive data from validate/assert when mutate cannot commit', () =>
        {
            // Arrange
            const rewrite = ( v: any ) => ( v === 1 ? 2 : v );

            // Act
            const result = validate( rewrite, 1, { mutate : true });
            const asserted = assert( rewrite, 1, { mutate : true });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toBe( 2 );
            expect( asserted ).toBe( 2 );
        });
    });

    describe( 'safeRegExp and unsafe pattern runtime report', () =>
    {
        it( 'should accept escaped digits, group alternation, and nested repeated groups', () =>
        {
            // Act / Assert
            expect(() => validators.safeRegExp( '\\d+' )).not.toThrow();
            expect(() => validators.safeRegExp( '(a|b)' )).not.toThrow();
            expect(() => validators.safeRegExp( '((a)+)x' )).not.toThrow();
            expect(() => validators.safeRegExp( '((a)+)+' )).toThrow( /Unsafe regular expression/ );
        });

        it( 'should report UnsafePattern for a non-vetted unsafe RegExp at runtime', () =>
        {
            // Arrange
            const unsafe = new RegExp( '(a+)+$' );

            // Act
            validators.pattern( 'aaaaX', 'p', ctx, unsafe, 'Pattern' );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toMatch( /UnsafePattern/ );
        });
    });

    describe( 'uniqueItems scalar and container duplicates', () =>
    {
        const duplicateCases: { name : string, values : any[] }[] =
        [
            { name : 'null', values : [null, null] },
            { name : 'undefined', values : [undefined, undefined] },
            { name : 'neg-zero', values : [-0, -0] },
            { name : 'true', values : [true, true] },
            { name : 'false', values : [false, false] },
            { name : 'bigint', values : [1n, 1n] },
            { name : 'date', values : [new Date( 0 ), new Date( 0 )] },
            { name : 'regexp', values : [/a/g, /a/g] },
            { name : 'short-key-2', values : [{ ab : 1 }, { ab : 1 }] },
            { name : 'short-key-3', values : [{ abc : 1 }, { abc : 1 }] }
        ];

        for( const entry of duplicateCases )
        {
            it( `rejects duplicate ${entry.name}`, () =>
            {
                // Arrange
                ctx = { success : true, errors : [], mode : 'strict' };

                // Act
                validators.uniqueItems( entry.values, 'u', ctx );

                // Assert
                expect( ctx.success ).toBe( false );
                expect( ctx.errors[0].error ).toBe( 'UniqueItems' );
            });
        }

        it( 'should deep-compare Set and Map items for uniqueness', () =>
        {
            // Arrange / Act
            validators.uniqueItems([new Set([1, { a : 1 }]), new Set([{ a : 1 }, 1])], 'u', ctx );

            // Assert
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            validators.uniqueItems(
                [new Map([['k', { a : 1 }]]), new Map([['k', { a : 1 }]])],
                'u',
                ctx
            );

            // Assert
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            const ok = validators.uniqueItems(
                [new Set([1]), new Set([2]), new Map([['a', 1]]), new Uint8Array([1])],
                'u',
                ctx
            );

            // Assert
            expect( ctx.success ).toBe( true );
            expect( ok ).toHaveLength( 4 );
        });

        it( 'should distinguish unequal nested Date and RegExp inside Sets', () =>
        {
            // Arrange / Act
            validators.uniqueItems(
                [new Set([new Date( 1 )]), new Set([new Date( 2 )])],
                'u',
                ctx
            );

            // Assert
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            validators.uniqueItems([new Set([/a/]), new Set([/b/])], 'u', ctx );

            // Assert
            expect( ctx.success ).toBe( true );
        });

        it( 'should use collision buckets when distinct objects share a content hash', () =>
        {
            // Arrange — known uniqueContentHash collisions that are not deep-equal.
            const pair = [{ a : 0, b : 2 }, { a : 2, b : 0 }, { a : 0, b : 2 }];

            // Act
            validators.uniqueItems( pair, 'u', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'UniqueItems' );

            // Arrange — three distinct colliding objects exercise bucket.push after the bucket exists.
            ctx = { success : true, errors : [], mode : 'strict' };
            const triple =
            [
                { a : 0, b : 29, c : 39 },
                { a : 0, b : 35, c : 21 },
                { a : 1, b : 30, c : 45 }
            ];

            // Act
            validators.uniqueItems( triple, 'u', ctx );

            // Assert
            expect( ctx.success ).toBe( true );
        });
    });

    describe( 'schema compile guards and allOf non-object replace', () =>
    {
        it( 'should compile JSON Schema type arrays as anyOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({ type : [ 'string', 'number' ] });

            // Act / Assert
            expect( validate( fn, 'a' ).success ).toBe( true );
            expect( validate( fn, 1 ).success ).toBe( true );
            expect( validate( fn, true ).success ).toBe( false );
        });

        it( 'should replace allOf data when a later non-object arm returns a different value', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [{ type : 'string' }, { type : 'number' }]
            });

            // Act
            const result = validate( fn, '5', { from : 'query' });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toBe( 5 );
        });
    });
});
