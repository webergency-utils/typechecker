import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    validateSchema,
    assertSchema,
    assertGuardSchema,
    isSchema
} from '../src/index.js';
import { getOrCompileSchema, validate } from '../src/runtime/validators.js';

describe( 'JSON Schema portability coverage', () =>
{
    beforeEach(() =>
    {
        // Isolate — no shared ctx; helpers create their own.
    });

    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    describe( 'circular $ref through nested combinators', () =>
    {
        it( 'should validate circular nodes through allOf and anyOf', () =>
        {
            // Arrange
            const schema =
            {
                $defs : {
                    Node : {
                        allOf : [
                            {
                                type                 : 'object',
                                properties           : { id : { type : 'string' } },
                                required             : ['id'],
                                additionalProperties : false
                            },
                            {
                                type       : 'object',
                                properties : {
                                    next : {
                                        anyOf : [
                                            { $ref : '#/$defs/Node' },
                                            { type : 'null' }
                                        ]
                                    }
                                },
                                required             : ['next'],
                                additionalProperties : false
                            }
                        ]
                    }
                },
                $ref : '#/$defs/Node'
            };

            // Act
            const ok = validateSchema( schema, {
                id   : 'a',
                next : { id : 'b', next : null }
            });
            const bad = validateSchema( schema, {
                id   : 'a',
                next : { id : 1, next : null }
            });

            // Assert
            expect( ok.success ).toBe( true );
            expect( bad.success ).toBe( false );
        });
    });

    describe( 'tuple items inside combinators', () =>
    {
        it( 'should enforce tuple items with minItems and uniqueItems under allOf', () =>
        {
            // Arrange
            const tupleSchema =
            {
                allOf : [
                    {
                        type     : 'array',
                        items    : [
                            { type : 'string' },
                            { type : 'number' }
                        ],
                        minItems : 2
                    }
                ]
            };
            const uniqueSchema =
            {
                allOf : [
                    {
                        type     : 'array',
                        items    : { type : 'string' },
                        minItems : 2
                    },
                    {
                        type        : 'array',
                        uniqueItems : true
                    }
                ]
            };

            // Act / Assert
            expect( validateSchema( tupleSchema, [ 'a', 1 ]).success ).toBe( true );
            expect( validateSchema( tupleSchema, [ 'a' ]).success ).toBe( false );
            expect( validateSchema( uniqueSchema, [ 'a', 'b' ]).success ).toBe( true );
            expect( validateSchema( uniqueSchema, [ 'a', 'a' ]).success ).toBe( false );
        });

        it( 'should accept tuple arms inside anyOf', () =>
        {
            // Arrange
            const schema =
            {
                anyOf : [
                    {
                        type     : 'array',
                        items    : [ { type : 'string' }, { type : 'string' } ],
                        minItems : 2,
                        maxItems : 2
                    },
                    { type : 'number' }
                ]
            };

            // Act / Assert
            expect( validateSchema( schema, [ 'x', 'y' ]).success ).toBe( true );
            expect( validateSchema( schema, 9 ).success ).toBe( true );
            expect( validateSchema( schema, [ 'x' ]).success ).toBe( false );
        });
    });

    describe( 'additionalProperties schema under allOf', () =>
    {
        it( 'should validate nested additionalProperties schemas inside allOf members', () =>
        {
            // Arrange
            const schema =
            {
                allOf : [
                    {
                        type       : 'object',
                        properties : {
                            bag : {
                                type                 : 'object',
                                properties           : { id : { type : 'string' } },
                                required             : ['id'],
                                additionalProperties : { type : 'number' }
                            }
                        },
                        required             : ['bag'],
                        additionalProperties : false
                    }
                ]
            };

            // Act
            const ok = validateSchema( schema, { bag : { id : 'x', n : 1, m : 2 } });
            const bad = validateSchema( schema, { bag : { id : 'x', n : 'no' } });

            // Assert
            expect( ok.success ).toBe( true );
            expect( bad.success ).toBe( false );
        });
    });

    describe( 'mutate / from / errorFactory on deep trees', () =>
    {
        it( 'should coerce query values through validateSchema on nested allOf', () =>
        {
            // Arrange
            const schema =
            {
                type       : 'object',
                properties : {
                    row : {
                        allOf : [
                            {
                                type                 : 'object',
                                properties           : { a : { type : 'number' } },
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
                    }
                },
                required             : ['row'],
                additionalProperties : false
            };

            // Act
            const result = validateSchema( schema, { row : { a : '1', b : '2' } }, { from : 'query' });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ row : { a : 1, b : 2 } });
        });

        it( 'should mutate nested closed allOf under strip mode via validateSchema', () =>
        {
            // Arrange
            const schema =
            {
                type       : 'object',
                properties : {
                    row : {
                        allOf : [
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
                    }
                },
                required             : ['row'],
                additionalProperties : false
            };
            const input = { row : { a : 'x', b : 1, extra : true } };

            // Act
            const result = validateSchema( schema, input, { mode : 'strip', mutate : true });

            // Assert
            expect( result.success ).toBe( true );
            expect( input ).toEqual({ row : { a : 'x', b : 1 } });
        });

        it( 'should honor errorFactory on assertSchema deep failures', () =>
        {
            // Arrange
            const schema =
            {
                allOf : [
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
            };
            const factory = ( errors: { error : string }[]) =>
            {
                const err = new Error( `custom:${errors.length}` );
                ( err as Error & { issues : unknown }).issues = errors;

                return err;
            };

            // Act / Assert
            expect(() => assertSchema( schema, { a : 1, b : 'x' }, { errorFactory : factory }))
                .toThrow( /custom:/ );
            expect(() => assertGuardSchema( schema, { a : 1 }, { errorFactory : factory }))
                .toThrow( /custom:/ );
            expect( isSchema( schema, { a : 'x', b : 1 })).toBe( true );
        });
    });

    describe( 'performance smoke', () =>
    {
        it( 'should compile and validate a wide anyOf quickly', () =>
        {
            // Arrange
            const arms = Array.from({ length : 80 }, ( _, i ) => ({
                type  : 'string' as const,
                const : `v${i}`
            }));
            const schema = { anyOf : arms };
            const started = Date.now();

            // Act
            const fn = getOrCompileSchema( schema );
            const ok = validate( fn, 'v40' );
            const bad = validate( fn, 'missing' );
            const elapsed = Date.now() - started;

            // Assert
            expect( ok.success ).toBe( true );
            expect( bad.success ).toBe( false );
            expect( elapsed ).toBeLessThan( 2000 );
        });

        it( 'should compile and validate a deep allOf quickly', () =>
        {
            // Arrange
            let schema: Record<string, unknown> = { type : 'string', minLength : 1 };

            for( let i = 0; i < 25; i++ )
            {
                schema = {
                    allOf : [
                        schema,
                        { type : 'string', maxLength : 100 }
                    ]
                };
            }
            const started = Date.now();

            // Act
            const result = validateSchema( schema as never, 'hello' );
            const elapsed = Date.now() - started;

            // Assert
            expect( result.success ).toBe( true );
            expect( elapsed ).toBeLessThan( 2000 );
        });
    });
});
