import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validators, groupErrorsByPath, coerceQueryDate, type ValidationContext, getOrCompileSchema, is, validate } from '../runtime/validators.js';

describe( 'Branch coverage edges', () =>
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

    describe( 'commitContainer and assign branches', () =>
    {
        it( 'should no-op commit when target and source are the same reference', () =>
        {
            // Arrange
            const input = { a : 1 };
            const fn = ( v: any ) => v;

            // Act
            expect( is( fn, input )).toBe( true );

            // Assert
            expect( input ).toEqual({ a : 1 });
        });
    });

    describe( 'regex safety branches', () =>
    {
        it( 'should reject overlong patterns and numeric backreferences', () =>
        {
            // Act / Assert
            expect(() => validators.safeRegExp( 'a'.repeat( 1025 ))).toThrow( /Unsafe regular expression/ );
            expect(() => validators.safeRegExp( '(a)\\1' )).toThrow( /Unsafe regular expression/ );
        });
    });

    describe( 'format date / date-time edge branches', () =>
    {
        it( 'should reject impossible calendar dates and malformed date-times', () =>
        {
            // Act
            validators.format( '2024-02-30', 'd', ctx, 'date' );

            // Assert
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            validators.format( '2024-01-01T99:00:00Z', 'd', ctx, 'date-time' );

            // Assert
            expect( ctx.success ).toBe( false );
        });
    });

    describe( 'uniqueItems hash / deepEqual branch matrix', () =>
    {
        it( 'should hash nested special numbers and negative bigints', () =>
        {
            // Arrange / Act
            validators.uniqueItems(
                [
                    { n : -0 },
                    { n : 0 },
                    { n : Number.NaN },
                    { n : Infinity },
                    { n : -Infinity },
                    { n : -1n },
                    { n : 0n }
                ],
                'u',
                ctx
            );

            // Assert
            expect( ctx.success ).toBe( true );
        });

        it( 'should deepEqual arrays, dates, regexes, and maps with mismatches', () =>
        {
            // Arrange / Act
            validators.uniqueItems(
                [
                    new Set([[1]]),
                    new Set([[1, 2]]),
                    new Set([new Date( 1 )]),
                    new Set([{}]),
                    new Set([/a/i]),
                    new Set([/a/g]),
                    new Map([['a', 1]]),
                    new Map([['a', 2]]),
                    new Map([['a', 1], ['b', 2]]),
                    new Map([[{ k : 1 }, 1]]),
                    new Map([[{ k : 2 }, 1]])
                ],
                'u',
                ctx
            );

            // Assert
            expect( ctx.success ).toBe( true );
        });

        it( 'should treat cyclic structures via the complex deepEqual path', () =>
        {
            // Arrange
            const left: any = { tag : 1 };
            const right: any = { tag : 1 };
            left.self = left;
            right.self = right;

            // Act
            validators.uniqueItems([left, right], 'u', ctx );

            // Assert — equal cyclic shapes collide as duplicates
            expect( ctx.success ).toBe( false );
        });

        it( 'should bail content-hash for class instances and nested unhashables', () =>
        {
            // Arrange
            class Box { constructor( public v: number ){} }

            // Act
            validators.uniqueItems([new Box( 1 ), new Box( 2 ), [{ s : new Set([1]) }], [{ s : new Set([2]) }]], 'u', ctx );

            // Assert
            expect( ctx.success ).toBe( true );
        });

        it( 'should fall through to complex compare for symbols and functions', () =>
        {
            // Arrange
            const a = Symbol( 'a' );
            const b = Symbol( 'b' );
            const f1 = () => 1;
            const f2 = () => 2;

            // Act
            validators.uniqueItems([a, b, f1, f2], 'u', ctx );

            // Assert
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            validators.uniqueItems([a, a], 'u', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
        });
    });

    describe( 'commitContainer same-reference via union accept', () =>
    {
        it( 'should commit when a union arm returns the original reference', () =>
        {
            // Arrange
            const input = { a : 1 };
            ctx = { success : true, errors : [], mode : 'strict', mutate : true, root : input };

            // Act
            const result = validators.union( input, '', ctx, [( v: any ) => v]);

            // Assert
            expect( ctx.success ).toBe( true );
            expect( result ).toBe( input );
        });
    });

    describe( 'custom from returning wrong types', () =>
    {
        const kinds: { name: string, validator: Function, bad: any }[] =
        [
            { name : 'string', validator : validators.string, bad : 1 },
            { name : 'number', validator : validators.number, bad : 'x' },
            { name : 'boolean', validator : validators.boolean, bad : 'x' },
            { name : 'bigint', validator : validators.bigint, bad : 'x' },
            { name : 'symbol', validator : validators.symbol, bad : 'x' },
            { name : 'date', validator : validators.date, bad : 'x' },
            { name : 'regexp', validator : validators.regexp, bad : 'x' },
            { name : 'function', validator : validators.function, bad : 'x' }
        ];

        for( const entry of kinds )
        {
            it( `should ignore custom from that returns a non-${entry.name}`, () =>
            {
                // Arrange
                ctx = {
                    success : true,
                    errors  : [],
                    mode    : 'strict',
                    from    : () => entry.bad,
                    root    : null
                };

                // Act
                entry.validator( null, entry.name, ctx );

                // Assert
                expect( ctx.success ).toBe( false );
            });
        }

        it( 'should accept custom from that returns null / undefined / never side effects', () =>
        {
            // Arrange / Act — success paths
            const nullOk: ValidationContext =
            { success : true, errors : [], mode : 'strict', from : () => null, root : 'x' };
            validators.null( 'x', 'n', nullOk );
            const undefOk: ValidationContext =
            { success : true, errors : [], mode : 'strict', from : () => undefined, root : 'x' };
            validators.undefined( 'x', 'u', undefOk );

            // failure paths when from returns the wrong value (hits === false branches)
            const nullBad: ValidationContext =
            { success : true, errors : [], mode : 'strict', from : () => 'nope', root : 'x' };
            validators.null( 'x', 'n', nullBad );
            const undefBad: ValidationContext =
            { success : true, errors : [], mode : 'strict', from : () => 'nope', root : 'x' };
            validators.undefined( 'x', 'u', undefBad );

            const neverCtx: ValidationContext =
            { success : true, errors : [], mode : 'strict', from : () => 1, root : 1 };
            validators.never( 1, 'nv', neverCtx );
            validators.never( 1, 'nv2', { success : true, errors : [], mode : 'strict', root : 1 });

            // Assert
            expect( nullOk.success ).toBe( true );
            expect( undefOk.success ).toBe( true );
            expect( nullBad.success ).toBe( false );
            expect( undefBad.success ).toBe( false );
            expect( neverCtx.success ).toBe( false );
        });

        it( 'should accept instanceOf revival via custom from and reject bad revival', () =>
        {
            // Arrange
            const ok: ValidationContext = {
                success : true,
                errors  : [],
                mode    : 'strict',
                from    : () => new Date( '2024-01-01T00:00:00.000Z' ),
                root    : 'x'
            };
            const bad: ValidationContext = {
                success : true,
                errors  : [],
                mode    : 'strict',
                from    : () => 'still-bad',
                root    : 'x'
            };

            // Act
            const result = validators.instanceOf( 'x', 'd', ok, 'Date' );
            validators.instanceOf( 'x', 'd', bad, 'Date' );

            // Assert
            expect( ok.success ).toBe( true );
            expect( result ).toBeInstanceOf( Date );
            expect( bad.success ).toBe( false );
        });
    });

    describe( 'literal and optional props branches', () =>
    {
        it( 'should coerce literals via query and custom from', () =>
        {
            // Arrange
            const numCtx: ValidationContext =
            { success : true, errors : [], mode : 'strict', from : 'query', root : '7' };
            const boolCtx: ValidationContext =
            { success : true, errors : [], mode : 'strict', from : 'query', root : 'true' };
            const customCtx: ValidationContext = {
                success : true,
                errors  : [],
                mode    : 'strict',
                from    : () => 'fixed',
                root    : {}
            };

            // Act
            expect( validators.literal( '7', 'l', numCtx, 7 )).toBe( 7 );
            expect( validators.literal( 'true', 'l', boolCtx, true )).toBe( true );
            expect( validators.literal( 'x', 'l', customCtx, 'fixed' )).toBe( 'fixed' );
            expect( validators.literal( 'no', 'l', customCtx, 'fixed' )).toBe( 'fixed' );

            const data: any = {};
            const optionalCtx: ValidationContext =
            { success : true, errors : [], mode : 'strict', root : {} };
            validators.props( {}, data, 'o', optionalCtx, [
                ['missing', true, validators.string]
            ]);

            // Assert
            expect( customCtx.success ).toBe( true );
            expect( optionalCtx.success ).toBe( true );
            expect( data ).toEqual({});
        });
    });

    describe( 'safeRegExp flags and date number coercion', () =>
    {
        it( 'should compile flagged safe regexes and coerce epoch dates', () =>
        {
            // Arrange / Act
            const re = validators.safeRegExp( 'abc', 'i' );
            const date = coerceQueryDate( Date.parse( '2024-01-01T00:00:00.000Z' ));

            // Assert
            expect( re.flags ).toContain( 'i' );
            expect( date ).toBeInstanceOf( Date );
        });
    });

    describe( 'pathContext with non-numeric index segment', () =>
    {
        it( 'should omit index when bracket segment is not numeric', () =>
        {
            // Arrange
            const seen: any[] = [];
            ctx = { success : true, errors : [], mode : 'strict', root : { 'x' : 1 } };

            // Act — synthesize a path with a non-numeric index via custom
            validators.custom( 1, 'row[nope]', ctx, ( _val, pc ) =>
            {
                seen.push( pc );

                return true;
            });

            // Assert
            expect( seen[0].index ).toBeUndefined();
            expect( seen[0].key ).toBe( 'row' );
        });

        it( 'should tolerate an unclosed bracket in the path tokenizer', () =>
        {
            // Arrange
            const seen: any[] = [];
            ctx = { success : true, errors : [], mode : 'strict', root : {} };

            // Act
            validators.custom( 1, 'row[unclosed', ctx, ( _val, pc ) =>
            {
                seen.push( pc );

                return true;
            });
            validators.custom( 1, '[0].leaf', ctx, () => true );

            // Assert
            expect( seen[0].path ).toContain( '[' );
        });
    });

    describe( 'coerceQueryDate number branch', () =>
    {
        it( 'should revive finite epoch milliseconds and reject out-of-range numbers', () =>
        {
            // Act
            const date = coerceQueryDate( 0 );
            const invalid = coerceQueryDate( 8640000000000001 );

            // Assert
            expect( date ).toBeInstanceOf( Date );
            expect( invalid ).toBe( 8640000000000001 );
        });
    });

    describe( 'groupErrorsByPath duplicate suppression', () =>
    {
        it( 'should not duplicate the same error string under one path', () =>
        {
            // Arrange
            const errors = [
                { path : 'a', value : 1, error : 'Type<string>' },
                { path : 'a', value : 1, error : 'Type<string>' },
                { path : 'a', value : 1, error : 'Type<number>' }
            ];

            // Act
            const grouped = groupErrorsByPath( errors );

            // Assert
            expect( grouped.a.errors ).toEqual(['Type<string>', 'Type<number>']);
        });
    });

    describe( 'allOf strip mode extras branch', () =>
    {
        it( 'should strip extras on closed allOf when mode is strip', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf :
                [
                    {
                        type                 : 'object',
                        properties           : { a : { type : 'string' } },
                        required             : ['a'],
                        additionalProperties : false
                    },
                    {
                        type                 : 'object',
                        properties           : { b : { type : 'number' } },
                        required             : ['b'],
                        additionalProperties : false
                    }
                ]
            });
            const input = { a : 'x', b : 1, extra : true };

            // Act
            const result = validate( fn, input, { mode : 'strip', mutate : true });

            // Assert
            expect( result.success ).toBe( true );
            expect( input ).toEqual({ a : 'x', b : 1 });
        });
    });

    describe( 'pathContext index and custom path helpers', () =>
    {
        it( 'should expose array index in constraint.Custom path context', () =>
        {
            // Arrange
            const seen: any[] = [];
            ctx = { success : true, errors : [], mode : 'strict', root : [10, 20] };

            // Act
            validators.array( [10, 20], 'rows', ctx, ( v, path, c ) =>
            {
                validators.custom( v, path, c, ( val: any, pc: any ) =>
                {
                    seen.push( pc );

                    return typeof val === 'number';
                });

                return v;
            });

            // Assert
            expect( seen.length ).toBe( 2 );
            expect( seen[0].index ).toBe( 0 );
            expect( seen[1].index ).toBe( 1 );
        });
    });

    describe( 'schema compile branches', () =>
    {
        it( 'should handle allOf members without closed additionalProperties', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf :
                [
                    {
                        type                 : 'object',
                        properties           : { a : { type : 'string' } },
                        required             : ['a'],
                        additionalProperties : true
                    },
                    {
                        type                 : 'object',
                        properties           : { b : { type : 'number' } },
                        required             : ['b']
                    }
                ]
            });

            // Act
            const result = validate( fn, { a : 'x', b : 1, extra : true });

            // Assert
            expect( result.success ).toBe( true );
        });

        it( 'should reject unknown x-typescript-type at compile time', () =>
        {
            // Act / Assert
            expect(() => getOrCompileSchema({ 'x-typescript-type' : 'Nope' }))
                .toThrow( /Unsupported x-typescript-type/ );
        });

        it( 'should compile empty-property closed allOf members', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf :
                [
                    { type : 'object', properties : {}, additionalProperties : false },
                    { type : 'object', properties : { a : { type : 'number' } }, required : ['a'], additionalProperties : false }
                ]
            });

            // Act
            const ok = validate( fn, { a : 1 });
            const bad = validate( fn, { a : 1, extra : 2 });

            // Assert
            expect( ok.success ).toBe( true );
            expect( bad.success ).toBe( false );
        });
    });

    describe( 'uri-template and format helpers', () =>
    {
        it( 'should reject unbalanced uri-template braces', () =>
        {
            // Act
            validators.format( 'http://x/{y', 'u', ctx, 'uri-template' );

            // Assert
            expect( ctx.success ).toBe( false );
        });
    });
});
