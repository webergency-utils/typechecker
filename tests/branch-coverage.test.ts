import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    validators,
    groupErrorsByPath,
    coerceQueryDate,
    coerceQueryNumber,
    deepEqual,
    hasUniqueItems,
    toStandardSchemaIssues,
    type ValidationContext,
    getOrCompileSchema,
    compileSchema,
    is,
    validate,
    parseSet,
    parseMap,
    parseUnion,
    parseQueryString,
    coerceBuffer,
    applyParseConstraints,
    applyContains,
    applyPropertyNames,
    reviveTree,
    applyParseTransform,
    recordParseObjectStats,
    ParseError,
    serializeSet,
    serializeMap,
    serializeUnion,
    serializeBuffer,
    appendQueryAny,
    applySerializeTransform,
    recordSerializerObjectStats,
    SerializationError,
    convertPropertyCasing,
    resolvePath,
    getValueAtPath,
    hasPath
} from '../src/runtime/index.js';
import { isSafeRegexSource, testRegex } from '../src/runtime/regex.js';

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
        const kinds: { name : string, validator : Function, bad : any }[] =
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
            validators.props({}, data, 'o', optionalCtx, [
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
            validators.custom( 1, 'row[nope]', ctx, ( _val: any, pc: any ) =>
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
            validators.custom( 1, 'row[unclosed', ctx, ( _val: any, pc: any ) =>
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
            validators.array([10, 20], 'rows', ctx, ( v: any, path: string, c: any ) =>
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
                        type       : 'object',
                        properties : { b : { type : 'number' } },
                        required   : ['b']
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

    describe( 'U1-U6 runtime helper branches', () =>
    {
        it( 'should cover resolvePath, getValueAtPath, and hasPath relative and root branches', () =>
        {
            expect( resolvePath( 'a.b.c', '/root.x' )).toBe( 'root.x' );
            expect( resolvePath( 'a.b.c', './d' )).toBe( 'a.b.c.d' );
            expect( resolvePath( 'a.b.c', '../d' )).toBe( 'a.b.d' );
            expect( resolvePath( 'a.b.c', '../.././d' )).toBe( 'a.d' );
            expect( resolvePath( 'a.b', '..c' )).toBe( 'c' );
            expect( getValueAtPath( null, 'a' )).toBeUndefined();
            expect( getValueAtPath({ a : [ 10, 20 ] }, 'a[1]' )).toBe( 20 );
            expect( getValueAtPath({ a : null }, 'a.b' )).toBeUndefined();
            expect( hasPath({ a : 0 }, 'a' )).toBe( true );
            expect( hasPath({ a : undefined }, 'a' )).toBe( false );
        });

        it( 'should cover parseSet and parseMap branches across json and query modes', () =>
        {
            expect( parseSet( new Set([ 'a', 'b' ]), 's', 'json', x => String( x ))).toEqual( new Set([ 'a', 'b' ]));
            expect( parseSet([ 'x' ], 's', 'json', x => String( x ))).toEqual( new Set([ 'x' ]));
            expect( parseSet( undefined, 's', 'query', x => String( x ))).toEqual( new Set());
            expect( parseSet({}, 's', 'query', x => String( x ))).toEqual( new Set());
            expect( parseSet( 'one', 's', 'query', x => String( x ))).toEqual( new Set([ 'one' ]));
            expect(() => parseSet( 'bad', 's', 'json', x => x )).toThrow( /Type<Set>/ );

            const existingMap = new Map([[ 'k', 1 ]]);
            expect( parseMap( existingMap, 'm', 'json', k => String( k ), v => Number( v ))).toEqual( new Map([[ 'k', 1 ]]));
            expect( parseMap( undefined, 'm', 'query', k => String( k ), v => Number( v ))).toEqual( new Map());
            expect( parseMap([ 'a', 'b' ], 'm', 'query', k => Number( k ), v => String( v ))).toEqual( new Map([[ 0, 'a' ], [ 1, 'b' ]]));
            expect( parseMap({ a : 1, b : undefined }, 'm', 'json', k => k, v => v )).toEqual( new Map([[ 'a', 1 ]]));
            expect(() => parseMap( null, 'm', 'json', k => k, v => v )).toThrow( /Type<Map>/ );
            expect(() => parseMap([ 1 ], 'm', 'json', k => k, v => v )).toThrow( /Type<Map>/ );
            expect(() => parseMap( new Set(), 'm', 'json', k => k, v => v )).toThrow( /Type<Map>/ );
            expect(() => parseMap( new Date(), 'm', 'json', k => k, v => v )).toThrow( /Type<Map>/ );
            expect(() => parseMap( /re/, 'm', 'json', k => k, v => v )).toThrow( /Type<Map>/ );
        });

        it( 'should cover serializeSet and serializeMap branches', () =>
        {
            expect( serializeSet( new Set([ 1, 2 ]), x => String( x ), 's' )).toBe( '[1,2]' );
            expect(() => serializeSet([ 1 ] as any, x => String( x ), 's' )).toThrow( /Type<Set>/ );

            expect( serializeMap(
                new Map<any, any>([[ 'a', 1 ], [ 2, true ]]),
                ( k, v ) => [ typeof k === 'string' ? JSON.stringify( k ) : String( k ), String( v ) ],
                'm'
            )).toBe( '{"a":1,"2":true}' );
            expect(() => serializeMap({} as any, ( k, v ) => [ String( k ), String( v ) ], 'm' )).toThrow( /Type<Map>/ );
        });

        it( 'should cover applyParseConstraints bigint, Set, Map, and Requires branches', () =>
        {
            expect( applyParseConstraints( 10n, 'b', [
                { type : 'minimum', value : 5n },
                { type : 'maximum', value : 20n },
                { type : 'exclusiveMinimum', value : 5n },
                { type : 'exclusiveMaximum', value : 20n },
                { type : 'multipleOf', value : 5n }
            ])).toBe( 10n );

            expect(() => applyParseConstraints( 10n, 'b', [{ type : 'multipleOf', value : 0n }])).toThrow( /MultipleOf<0>/ );
            expect(() => applyParseConstraints( 10n, 'b', [{ type : 'multipleOf', value : 3n }])).toThrow( /MultipleOf<3>/ );
            expect(() => applyParseConstraints( 10n, 'b', [{ type : 'multipleOf', value : 'bad-bigint' }])).toThrow( /MultipleOf<bad-bigint>/ );
            expect(() => applyParseConstraints( 0.35, 'n', [{ type : 'multipleOf', value : 0.1 }])).toThrow( /MultipleOf<0\.1>/ );

            expect( applyParseConstraints( new Set([ 1, 2 ]), 's', [{ type : 'minItems', value : 1 }, { type : 'maxItems', value : 3 }])).toEqual( new Set([ 1, 2 ]));
            expect(() => applyParseConstraints( new Set(), 's', [{ type : 'minItems', value : 1 }])).toThrow( /MinItems<1>/ );
            expect(() => applyParseConstraints( new Set([ 1, 2 ]), 's', [{ type : 'maxItems', value : 1 }])).toThrow( /MaxItems<1>/ );

            expect( applyParseConstraints( new Map([[ 'a', 1 ]]), 'm', [{ type : 'minProperties', value : 1 }, { type : 'maxProperties', value : 2 }])).toEqual( new Map([[ 'a', 1 ]]));
            expect(() => applyParseConstraints( new Map(), 'm', [{ type : 'minProperties', value : 1 }])).toThrow( /MinProperties<1>/ );
            expect(() => applyParseConstraints( new Map([[ 'a', 1 ], [ 'b', 2 ]]), 'm', [{ type : 'maxProperties', value : 1 }])).toThrow( /MaxProperties<1>/ );

            expect( applyParseConstraints({ a : 1 }, 'sub', [{ type : 'requires', value : '/flag' }], 'json', { flag : true, sub : { a : 1 } })).toEqual({ a : 1 });
            expect(() => applyParseConstraints({ a : 1 }, 'sub', [{ type : 'requires', value : '/flag' }], 'json', { sub : { a : 1 } })).toThrow( /Requires<\/flag>/ );

            expect(() => applyParseConstraints([ { a : 1, b : 2 }, { b : 2, a : 1 } ], 'u', [{ type : 'uniqueItems' }])).toThrow( /UniqueItems/ );
        });

        it( 'should cover validators.literal bigint coercion and patternProperties closed object modes', () =>
        {
            const jsonCtx: ValidationContext = { success : true, errors : [], mode : 'strict', from : 'json', root : {} };
            expect( validators.literal( '10', 'b', jsonCtx, 10n )).toBe( 10n );
            expect( validators.literal( 10, 'b', jsonCtx, 10n )).toBe( 10n );
            expect( validators.literal( 'bad', 'b', jsonCtx, 10n )).toBe( 'bad' );
            expect( jsonCtx.errors[0].error ).toBe( 'Literal<10n>' );

            const fn = getOrCompileSchema({
                type                 : 'object',
                properties           : { id : { type : 'number' } },
                patternProperties    : { '^x_' : { type : 'string' } },
                additionalProperties : false
            });
            expect( validate( fn, { id : 1, x_ok : 'hi', extra : 2 }, { mode : 'strict' }).success ).toBe( false );
            expect( validate( fn, { id : 1, x_ok : 'hi', extra : 2 }, { mode : 'strip', mutate : true }).data ).toEqual({ id : 1, x_ok : 'hi' });
            expect( validate( fn, { id : 1, x_ok : 'hi', extra : 2 }, { mode : 'relaxed' }).data ).toEqual({ id : 1, x_ok : 'hi', extra : 2 });

            // Set maxItems & Map minProperties/maxProperties & Map key error path in validators
            const setCtx = { success : true, errors : [] as any[], mode : 'strict' as const };
            validators.maxItems( new Set([ 1, 2, 3 ]), 's', setCtx, 2 );
            expect( setCtx.success ).toBe( false );
            expect( setCtx.errors[0].error ).toBe( 'MaxItems<2>' );

            const mapMinCtx = { success : true, errors : [] as any[], mode : 'strict' as const };
            validators.minProperties( new Map([[ 'a', 1 ]]), 'm', mapMinCtx, 2 );
            expect( mapMinCtx.success ).toBe( false );
            expect( mapMinCtx.errors[0].error ).toBe( 'MinProperties<2>' );

            const mapMaxCtx = { success : true, errors : [] as any[], mode : 'strict' as const };
            validators.maxProperties( new Map([[ 'a', 1 ], [ 'b', 2 ]]), 'm', mapMaxCtx, 1 );
            expect( mapMaxCtx.success ).toBe( false );
            expect( mapMaxCtx.errors[0].error ).toBe( 'MaxProperties<1>' );

            const mapKeyErrCtx = { success : true, errors : [] as any[], mode : 'strict' as const };
            validators.map( new Map<any, any>([[ 123, 'ok' ]]), 'myMap', mapKeyErrCtx, validators.string, validators.string );
            expect( mapKeyErrCtx.success ).toBe( false );
            expect( mapKeyErrCtx.errors[0].path ).toBe( 'myMap.key(123)' );

            // Non-plain-objects (Date, Set, Array) are ignored by minProperties/maxProperties in applyParseConstraints
            const d = new Date();
            expect( applyParseConstraints( d, 'd', [{ type : 'minProperties', value : 1 }, { type : 'maxProperties', value : 0 }])).toBe( d );
        });

        it( 'should cover remaining casing, regex, and serializer-runtime branches', () =>
        {
            // casing.ts: constructor / prototype keys defined via Object.defineProperty
            const converted = convertPropertyCasing({ constructor : 1, prototype : 2 }, 'camelCase' );
            expect(( converted as any ).constructor ).toBe( 1 );
            expect(( converted as any ).prototype ).toBe( 2 );

            // regex.ts: meta-char in alternation, empty alternation branch, and over-length subject
            expect( isSafeRegexSource( '(a.|b)+' )).toBe( false );
            expect( isSafeRegexSource( '(a|)+' )).toBe( false );
            expect( testRegex( /a/, 'a'.repeat( 10_001 ))).toBe( false );

            // serializer-runtime.ts: undefined property in appendQueryAny, serializeUnion worse stripped arm, applySerializeTransform null/undefined
            const params: string[] = [];
            appendQueryAny( params, { a : undefined, b : 1 }, 'p' );
            expect( params ).toEqual([ 'p%5Bb%5D=1' ]);

            const serRes = serializeUnion(
                { a : 1, b : 2, c : 3 },
                '',
                'Type<U>',
                [
                    () =>
                    {
                        recordSerializerObjectStats( 1, 2 );

                        return '{"a":1,"b":2}';
                    },
                    () =>
                    {
                        recordSerializerObjectStats( 2, 1 );

                        return '{"a":1}';
                    }
                ],
                true
            );
            expect( serRes ).toBe( '{"a":1,"b":2}' );

            expect( applySerializeTransform( 42, '', undefined, 'number', [], 42 )).toBe( 42 );
        });

        it( 'should cover remaining parse-runtime branches', () =>
        {
            // parseErrorCode with empty path '' when last error matches expected
            expect(() => parseUnion( 1, '', 'Type<string>', [
                () =>
                {
                    throw new ParseError( '', 'Type<string>' );
                }
            ])).toThrow( ParseError );

            // parseUnion probeBestFit when second arm strips more keys than first arm
            const parsedBest = parseUnion(
                { a : 1, b : 2, c : 3 },
                '',
                'Type<U>',
                [
                    () =>
                    {
                        recordParseObjectStats( 1, 2 );

                        return { a : 1, b : 2 };
                    },
                    () =>
                    {
                        recordParseObjectStats( 2, 1 );

                        return { a : 1 };
                    }
                ],
                true
            );
            expect( parsedBest ).toEqual({ a : 1, b : 2 });

            // maxNumericKey with existing numeric and non-numeric keys in object
            const q1 = parseQueryString( 'a[x]=1&a[0]=first&a[2]=third&a[1]=second&a[]=fourth' );
            expect( q1.a[3]).toBe( 'fourth' );

            // MAX_QUERY_DEPTH truncation (> 32 brackets)
            const deepKey = 'a' + '[b]'.repeat( 35 ) + '=1';
            expect( parseQueryString( deepKey )).toBeDefined();

            // Falsy value at obj[k] before nested bracket key
            const q2 = parseQueryString( 'a[0]=&a[][b]=1' );
            expect( q2.a ).toBeDefined();

            // MAX_QUERY_KEYS (> 10000 params)
            const manyParams = 'a=1&'.repeat( 10002 );
            expect( parseQueryString( manyParams ).a.length ).toBe( 10000 );

            // applyParseConstraints edge branches
            expect( applyParseConstraints( null, 'p', [{ type : 'minLength', value : 1 }])).toBeNull();
            expect( applyParseConstraints( 'hi', 'p', [{ type : 'transform', value : 'unknownTransform' }])).toBe( 'hi' );
            expect( applyParseConstraints( false, 'p', [
                { type : 'maxLength', value : 5 },
                { type : 'multipleOf', value : 2 },
                { type : 'pattern', value : '^a$' }
            ])).toBe( false );
            expect( applyParseConstraints( 124, 'p', [{ type : 'multipleOf', value : 2 }])).toBe( 124 );
            expect( applyParseConstraints( 'a', 'p', [{ type : 'pattern', value : '^a$', regex : /^a$/ }])).toBe( 'a' );
            expect(() => applyParseConstraints( 'bad', 'p', [{ type : 'format', value : 'email', message : 'CustomFormatMsg' }], 'json', {})).toThrow( /CustomFormatMsg/ );

            // applyContains non-array & non-ParseError rethrow
            expect( applyContains( 'not-array', 'p', () => 'x' )).toBe( 'not-array' );
            expect(() => applyContains([ 1 ], 'p', () =>
            {
                throw new TypeError( 'boom' );
            })).toThrow( TypeError );

            // applyPropertyNames non-object, empty path, and non-ParseError rethrow
            expect( applyPropertyNames( null, 'p', () => 'x' )).toBeNull();
            expect( applyPropertyNames({ a : 1 }, '', k => k )).toEqual({ a : 1 });
            expect(() => applyPropertyNames({ a : 1 }, '', () =>
            {
                throw new TypeError( 'boom' );
            })).toThrow( TypeError );

            // reviveTree throwing non-Error string at root and object with custom path
            expect(() => reviveTree({ a : 1 }, () =>
            {
                 
                throw 'raw-string-error';
            })).toThrow( /raw-string-error/ );
            expect(() => reviveTree({ a : 1 }, () =>
            {
                 
                throw { path : 'custom.path' };
            })).toThrow( ParseError );

            // applyParseTransform with undefined transform
            expect( applyParseTransform( 42, '', undefined, 'number', [], 42 )).toBe( 42 );
        });

        it( 'should cover remaining validators.ts branches', () =>
        {
            // coerceQueryNumber signs and exponent edge cases
            expect( coerceQueryNumber( '+42' )).toBe( 42 );
            expect( coerceQueryNumber( '1e+2' )).toBe( 100 );
            expect( coerceQueryNumber( '1e2x' )).toBe( '1e2x' );
            expect( coerceQueryNumber( '1e+' )).toBe( '1e+' );

            // date-time invalid calendar date (Feb 31)
            const dtCtx: ValidationContext = { success : true, errors : [], mode : 'strict' };
            validators.format( '2024-02-31T10:00:00Z', 'dt', dtCtx, 'date-time' );
            expect( dtCtx.success ).toBe( false );

            // deepEqual seenRight.add(right) and key length mismatch
            const shared = { k : 1 };
            expect( deepEqual([ shared, shared ], [ { k : 1 }, { k : 2 } ])).toBe( false );
            expect( deepEqual({ a : 1 }, { a : 1, b : 2 })).toBe( false );

            // uniqueContentHash nested types inside hasUniqueItems (Date and RegExp before Symbol)
            const sym = Symbol( 'x' );
            expect( hasUniqueItems([
                { a : null, b : true, c : false, e : new Date( 1000 ), f : /abc/g },
                { a : null, b : false, c : true, e : new Date( 2000 ), f : /def/i },
                { g : sym }
            ])).toBe( true );

            // literal coercion edge branches
            const qCtx: ValidationContext = { success : true, errors : [], mode : 'strict', from : 'query' };
            expect( validators.literal( '99', 'p', qCtx, 42 )).toBe( '99' );
            expect( validators.literal( 'hello', 'p', { success : true, errors : [], mode : 'strict', from : 'query' }, 'world' )).toBe( 'hello' );
            expect( validators.literal( false, 'p', { success : true, errors : [], mode : 'strict', from : 'json' }, 10n )).toBe( false );
            expect( validators.literal( 11, 'p', { success : true, errors : [], mode : 'strict', from : 'json' }, 10n )).toBe( 11 );
            expect( validators.literal( 'x', 'p', { success : true, errors : [], mode : 'strict', from : () => 'y' }, 'z' )).toBe( 'x' );

            // props inPlace with own undefined property
            const inPlaceObj: any = { a : undefined };
            validators.props( inPlaceObj, inPlaceObj, '', { success : true, errors : [], mode : 'strict', mutate : true }, [
                [ 'a', false, ( v: any ) => v ]
            ]);
            expect( 'a' in inPlaceObj ).toBe( true );

            // additionalProps inPlace when value is unchanged
            const addObj: any = { a : 1, extra : 'ok' };
            validators.additionalProps( addObj, addObj, '', { success : true, errors : [], mode : 'strict', mutate : true }, [ 'a' ], validators.string );
            expect( addObj.extra ).toBe( 'ok' );

            // patternProps with unionProbe, indexValidator, and inPlace modes
            const patObj: any = { known : 1, p_1 : 'a', idx_1 : 10, extra : true };
            const patProbeCtx: ValidationContext = {
                success    : true,
                errors     : [],
                mode       : 'strip',
                mutate     : true,
                unionProbe : { stripped : 0, matched : 0 }
            };
            validators.patternProps(
                patObj,
                patObj,
                '',
                patProbeCtx,
                [ 'known' ],
                [[ /^p_/, validators.string ]]
            );
            expect( patProbeCtx.unionProbe?.matched ).toBe( 2 );
            expect( patProbeCtx.unionProbe?.stripped ).toBe( 2 );
            expect( 'extra' in patObj ).toBe( false );

            const patIdxObj: any = { known : undefined, idx_1 : 10, idx_undef : undefined };
            const patIdxCtx: ValidationContext = {
                success    : true,
                errors     : [],
                mode       : 'strip',
                mutate     : true,
                unionProbe : { stripped : 0, matched : 0 }
            };
            validators.patternProps(
                patIdxObj,
                patIdxObj,
                '',
                patIdxCtx,
                [ 'known' ],
                [[ /^p_/, validators.string ]],
                ( v: any ) => v
            );
            expect( patIdxCtx.unionProbe?.matched ).toBe( 1 );

            const patNonInPlaceObj: any = { extra : undefined };
            const patNonInPlaceCtx: ValidationContext = {
                success    : true,
                errors     : [],
                mode       : 'strip',
                mutate     : false,
                unionProbe : { stripped : 0, matched : 0 }
            };
            validators.patternProps(
                patNonInPlaceObj,
                {},
                '',
                patNonInPlaceCtx,
                [],
                []
            );
            expect( patNonInPlaceCtx.unionProbe?.stripped ).toBe( 0 );

            const patRelaxedObj: any = { extra : 1 };
            validators.patternProps(
                patRelaxedObj,
                patRelaxedObj,
                '',
                { success : true, errors : [], mode : 'relaxed', mutate : true },
                [],
                []
            );
            expect( patRelaxedObj.extra ).toBe( 1 );

            // minItems, maxItems, minProperties, maxProperties, contains, propertyNames on non-matching types
            const dummyCtx: ValidationContext = { success : true, errors : [], mode : 'strict' };
            expect( validators.minItems( new Set([ 1, 2 ]), 'p', dummyCtx, 1 )).toEqual( new Set([ 1, 2 ]));
            expect( validators.minItems( 123, 'p', dummyCtx, 1 )).toBe( 123 );
            expect( validators.maxItems( 123, 'p', dummyCtx, 1 )).toBe( 123 );
            expect( validators.minProperties( 123, 'p', dummyCtx, 1 )).toBe( 123 );
            expect( validators.maxProperties( 123, 'p', dummyCtx, 1 )).toBe( 123 );
            expect( validators.contains( 123, 'p', dummyCtx, validators.string )).toBe( 123 );
            expect( validators.propertyNames( 123, 'p', dummyCtx, validators.string )).toBe( 123 );

            // propertyNames with empty errors array on probe failure
            const emptyErrCheck = ( _v: any, _p: string, c: ValidationContext ) =>
            {
                c.success = false;
            };
            const pnCtx: ValidationContext = { success : true, errors : [], mode : 'strict' };
            validators.propertyNames({ a : 1 }, 'p', pnCtx, emptyErrCheck );
            expect( pnCtx.errors[0].error ).toBe( 'PropertyNames' );

            // anonymous async custom function & anonymous class in instanceOf
            const asyncCtx: ValidationContext = { success : true, errors : [], mode : 'strict' };
            validators.custom( 1, 'p', asyncCtx, (() => () => Promise.resolve( true ))());
            expect( asyncCtx.errors[0].error ).toBe( 'AsyncCustomNotSupported' );

            const instCtx: ValidationContext = { success : true, errors : [], mode : 'strict' };
            validators.instanceOf({}, 'p', instCtx, (() => function () {})());
            expect( instCtx.errors[0].error ).toBe( 'Type<Object>' );

            // validators.set and validators.map query / json edge branches
            expect( validators.set( undefined, 'p', { success : true, errors : [], mode : 'strict', from : 'query' }, validators.string )).toEqual( new Set());
            expect( validators.set({ a : 1 }, 'p', { success : true, errors : [], mode : 'strict', from : 'query' }, ( x: any ) => x )).toEqual( new Set([{ a : 1 }]));
            expect( validators.map( undefined, 'p', { success : true, errors : [], mode : 'strict', from : 'query' }, validators.string, validators.string )).toEqual( new Map());
            expect( validators.map( null, 'p', { success : true, errors : [], mode : 'strict', from : 'query' }, validators.string, validators.string )).toEqual( new Map());
            expect( validators.map([ 'x' ], 'p', { success : true, errors : [], mode : 'strict', from : 'query' }, validators.string, validators.string )).toEqual( new Map([[ '0', 'x' ]]));
            expect( validators.map( 'bad', 'p', { success : true, errors : [], mode : 'strict', from : 'query' }, validators.string, validators.string )).toBe( 'bad' );
            expect( validators.map({ a : undefined, b : 'ok' }, 'p', { success : true, errors : [], mode : 'strict', from : 'json' }, validators.string, validators.string )).toEqual( new Map([[ 'b', 'ok' ]]));

            // toStandardSchemaIssues with nested union issues
            const stdIssues = toStandardSchemaIssues([
                {
                    path   : 'user',
                    value  : {},
                    error  : 'Type<Union>',
                    issues : [{ path : 'user.id', value : 'bad', error : 'Type<number>' }]
                }
            ]);
            expect( stdIssues.length ).toBe( 2 );
        });

        it( 'should cover remaining schema-compiler.ts branches', () =>
        {
            // resolveSchemaRef root '#' / '#/', invalid ref format, boolean root, array traversal, boolean target, non-object target
            const rootRefSchema = compileSchema({
                type       : 'object',
                properties : { self : { $ref : '#' } }
            });
            expect( is( rootRefSchema, { self : {} })).toBe( true );

            expect(() => compileSchema({ $ref : 'relative/ref' })({}, '', ctx )).toThrow( /Schema reference not found/ );
            expect(() => compileSchema({
                $defs : { Bad : 123 as any },
                $ref  : '#/$defs/Bad'
            })({}, '', ctx )).toThrow( /Schema reference not found/ );

            const arrayPointerSchema = compileSchema({
                allOf : [{ type : 'string' }],
                $ref  : '#/allOf/0'
            });
            expect( is( arrayPointerSchema, 'hello' )).toBe( true );

            expect(() => compileSchema({
                allOf : [{ type : 'string' }],
                $ref  : '#/allOf/99'
            })( 'hello', '', ctx )).toThrow( /Schema reference not found/ );

            const boolTargetSchema = compileSchema({
                $defs : { Always : true },
                $ref  : '#/$defs/Always'
            });
            expect( is( boolTargetSchema, 'anything' )).toBe( true );

            // string $recursiveAnchor + missing $dynamicRef target (with non-empty dynamicAnchors stack)
            const recAnchorSchema = compileSchema({
                $recursiveAnchor : 'myNode',
                type             : 'string'
            });
            expect( is( recAnchorSchema, 'ok' )).toBe( true );

            const missingDynSchema = compileSchema({
                $dynamicAnchor : 'rootAnchor',
                type           : 'object',
                properties     : {
                    bad : { $dynamicRef : '#nonexistent' }
                }
            });
            expect(() => is( missingDynSchema, { bad : 1 })).toThrow( /Schema reference not found/ );

            // dynamicAnchors stack search when top frame doesn't have anchor
            const multiAnchorSchema = compileSchema({
                $dynamicAnchor : 'first',
                type           : 'object',
                properties     : {
                    nested : {
                        $dynamicAnchor : 'second',
                        $dynamicRef    : '#first'
                    }
                }
            });
            expect( is( multiAnchorSchema, { nested : {} })).toBe( true );

            // not & if when base check fails (!ctx.success) + if without then / else
            const notFailSchema = compileSchema({ type : 'string', not : { const : 'a' } });
            expect( is( notFailSchema, 123 )).toBe( false );

            const ifFailSchema = compileSchema({
                type : 'string',
                if   : { minLength : 2 },
                else : { const : 'a' }
            });
            expect( is( ifFailSchema, 123 )).toBe( false );
            expect( is( ifFailSchema, 'abc' )).toBe( true );
            expect( is( ifFailSchema, 'a' )).toBe( true );

            const ifNoElseSchema = compileSchema({
                type : 'string',
                if   : { minLength : 3 },
                then : { maxLength : 5 }
            });
            expect( is( ifNoElseSchema, 'a' )).toBe( true );

            // peelCombinators with $ref, $dynamicRef, $recursiveRef + sibling keyword
            const peeledRef = compileSchema({
                $defs     : { Str : { type : 'string' } },
                $ref      : '#/$defs/Str',
                minLength : 2
            });
            expect( is( peeledRef, 'ab' )).toBe( true );
            expect( is( peeledRef, 'a' )).toBe( false );

            const peeledDyn = compileSchema({
                $dynamicAnchor : 'd',
                $dynamicRef    : '#d',
                type           : 'string'
            });
            expect( is( peeledDyn, 'ok' )).toBe( true );

            const peeledRec = compileSchema({
                $recursiveAnchor : true,
                $recursiveRef    : '#',
                type             : 'string'
            });
            expect( is( peeledRec, 'ok' )).toBe( true );

            // Invalid type in type array
            expect(() => compileSchema({ type : [ 'string', 'invalid' as any ] })).toThrow( /Unsupported JSON Schema type/ );

            // allOf with relaxed mode, closed object without properties, & unevaluatedItems on array
            const allOfRelaxed = compileSchema({
                allOf : [
                    { type : 'object', properties : { a : { type : 'number' } } }
                ]
            });
            expect( validate( allOfRelaxed, { a : 1, extra : 2 }, 'relaxed' ).data ).toEqual({ a : 1, extra : 2 });

            const allOfClosedNoProps = compileSchema({
                allOf : [
                    { type : 'object' }
                ]
            });
            expect( validate( allOfClosedNoProps, { extra : 1 }, 'strip' ).data ).toEqual({});

            const allOfUnevalItems = compileSchema({
                allOf            : [{ type : 'array', prefixItems : [{ type : 'number' }] }],
                unevaluatedItems : false
            });
            expect( is( allOfUnevalItems, [ 1 ])).toBe( true );
            expect( is( allOfUnevalItems, [ 1, 2 ])).toBe( false );

            const unevalItemsTrueSchema = compileSchema({
                type             : 'array',
                prefixItems      : [{ type : 'number' }],
                unevaluatedItems : true
            });
            expect( is( unevalItemsTrueSchema, [ 1, 'extra' ])).toBe( true );

            // string contentEncoding / contentMediaType / contentSchema combinations
            const mediaOnlySchema = compileSchema({
                type             : 'string',
                contentMediaType : 'application/json'
            });
            expect( is( mediaOnlySchema, '{"a":1}' )).toBe( true );

            const encodingWithSchema = compileSchema({
                type            : 'string',
                contentEncoding : '7bit',
                contentSchema   : { type : 'string', minLength : 2 }
            });
            expect( is( encodingWithSchema, 'hello' )).toBe( true );

            const encodingOnlySchema = compileSchema({
                type            : 'string',
                contentEncoding : '7bit'
            });
            expect( is( encodingOnlySchema, 'hello' )).toBe( true );

            // draft-04 boolean false exclusiveMinimum / exclusiveMaximum without minimum / maximum
            const draft04BoolExcl = compileSchema({
                type             : 'number',
                exclusiveMinimum : false as any,
                exclusiveMaximum : false as any
            });
            expect( is( draft04BoolExcl, 5 )).toBe( true );

            // oneOf and anyOf with from: 'query' and mutate: true
            const oneOfCoerce = compileSchema({
                oneOf : [
                    { type : 'object', properties : { n : { type : 'number' } }, required : [ 'n' ] }
                ]
            });
            expect( validate( oneOfCoerce, { n : '42' }, { from : 'query', mutate : true }).data ).toEqual({ n : 42 });

            const anyOfMutate = compileSchema({
                anyOf : [
                    { type : 'object', properties : { n : { type : 'number' } }, required : [ 'n' ] }
                ]
            });
            expect( validate( anyOfMutate, { n : 42 }, { mutate : true }).data ).toEqual({ n : 42 });

            // items: true with unevaluatedItems: false
            const itemsTrueSchema = compileSchema({
                type             : 'array',
                items            : true,
                unevaluatedItems : false
            });
            expect( is( itemsTrueSchema, [ 1, 'extra' ])).toBe( true );

            // dependencies when key is absent on object, plus typeless object with additionalProperties
            const depSchema = compileSchema({
                type         : 'object',
                properties   : { a : { type : 'number' } },
                dependencies : { a : [ 'b' ] }
            });
            expect( is( depSchema, {})).toBe( true );

            const depNonPlainSchema = compileSchema({
                type                 : 'object',
                additionalProperties : true,
                dependentSchemas     : { a : { type : 'string' } },
                dependencies         : { b : { type : 'string' } }
            });
            expect( validate( depNonPlainSchema, { a : 1, b : 2 }, { from : () => 'coerced' }).success ).toBe( true );

            const typelessWithAddProps = compileSchema({
                properties           : { a : { type : 'number' } },
                additionalProperties : false
            });
            expect( is( typelessWithAddProps, { a : 1 })).toBe( true );
        });
    });
});
