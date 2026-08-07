import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    type ValidationContext,
    getOrCompileSchema,
    validate,
    is,
    assert,
    assertGuard
} from '../src/runtime/validators.js';

describe( 'schema combinators', () =>
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

    describe( 'allOf — positive', () =>
    {
        it( 'should accept a value that satisfies every primitive member', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    { type : 'string' },
                    { type : 'string', minLength : 3 },
                    { type : 'string', maxLength : 10 }
                ]
            });

            // Act
            const result = fn( 'hello', '', ctx );

            // Assert
            expect( result ).toBe( 'hello' );
            expect( ctx.success ).toBe( true );
        });

        it( 'should merge closed object members into one shape', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
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
            });

            // Act
            const result = validate( fn, { a : 'x', b : 2 });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ a : 'x', b : 2 });
        });

        it( 'should coerce query values across allOf members', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
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
            });

            // Act
            const result = validate( fn, { a : '1', b : '2' }, { from : 'query' });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ a : 1, b : 2 });
        });

        it( 'should strip unknown keys from closed allOf in strip mode', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
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
            });
            const input = { a : 'x', b : 1, extra : true };

            // Act
            const result = validate( fn, input, { mode : 'strip', mutate : true });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toBe( input );
            expect( input ).toEqual({ a : 'x', b : 1 });
        });

        it( 'should keep unknown keys from closed allOf in relaxed mode', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
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
            });

            // Act
            const result = validate( fn, { a : 'x', b : 1, extra : true }, { mode : 'relaxed' });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ a : 'x', b : 1, extra : true });
        });

        it( 'should accept a single-member allOf as that member', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [{ type : 'number', minimum : 0 }]
            });

            // Act
            const result = fn( 5, '', ctx );

            // Assert
            expect( result ).toBe( 5 );
            expect( ctx.success ).toBe( true );
        });

        it( 'should accept an empty allOf as a no-op identity', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({ allOf : [] });

            // Act
            const result = fn({ anything : true }, '', ctx );

            // Assert
            expect( result ).toEqual({ anything : true });
            expect( ctx.success ).toBe( true );
        });

        it( 'should combine allOf with const', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [{ type : 'string', minLength : 2 }],
                const : 'ok'
            });

            // Act
            const result = fn( 'ok', '', ctx );

            // Assert
            expect( result ).toBe( 'ok' );
            expect( ctx.success ).toBe( true );
        });

        it( 'should resolve $ref members inside allOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                $defs : {
                    Name : { type : 'string', minLength : 2 },
                    Age  : { type : 'number', minimum : 0 }
                },
                allOf : [
                    {
                        type                 : 'object',
                        properties           : { name : { $ref : '#/$defs/Name' } },
                        required             : ['name'],
                        additionalProperties : false
                    },
                    {
                        type                 : 'object',
                        properties           : { age : { $ref : '#/$defs/Age' } },
                        required             : ['age'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const result = validate( fn, { name : 'Al', age : 30 });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ name : 'Al', age : 30 });
        });

        it( 'should enforce nested closed objects under allOf with outer strict mode', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        type       : 'object',
                        properties : {
                            nested : {
                                type                 : 'object',
                                properties           : { a : { type : 'string' } },
                                required             : ['a'],
                                additionalProperties : false
                            }
                        },
                        required             : ['nested'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const ok = validate( fn, { nested : { a : 'x' } });

            // Assert
            expect( ok.success ).toBe( true );
            expect( ok.data ).toEqual({ nested : { a : 'x' } });
        });

        it( 'should accept boolean true members in allOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [ true, { type : 'string', minLength : 1 } ]
            });

            // Act
            const result = fn( 'x', '', ctx );

            // Assert
            expect( result ).toBe( 'x' );
            expect( ctx.success ).toBe( true );
        });

        it( 'should nest anyOf inside allOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    { type : 'string' },
                    {
                        anyOf : [
                            { type : 'string', const : 'a' },
                            { type : 'string', const : 'b' }
                        ]
                    }
                ]
            });

            // Act
            const a = validate( fn, 'a' );
            const b = validate( fn, 'b' );

            // Assert
            expect( a.success ).toBe( true );
            expect( b.success ).toBe( true );
        });
    });

    describe( 'allOf — negative', () =>
    {
        it( 'should reject when any primitive member fails', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    { type : 'string' },
                    { type : 'string', minLength : 5 }
                ]
            });

            // Act
            fn( 'hi', '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors.some( e => e.error.includes( 'MinLength' ))).toBe( true );
        });

        it( 'should reject extras on closed allOf in strict mode', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
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
            });

            // Act
            const result = validate( fn, { a : 'x', b : 1, extra : true });

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors.some( e => e.error.includes( 'PropertyNotAllowed' ))).toBe( true );
        });

        it( 'should aggregate errors from every failing allOf member', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
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
            });

            // Act
            const result = validate( fn, { a : 1, b : 'x' });

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors.length ).toBeGreaterThanOrEqual( 2 );
        });

        it( 'should not mutate input when allOf fails under mutate strip', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
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
            });
            const input: Record<string, unknown> = { a : 'x', b : 'invalid' };

            // Act
            const result = validate( fn, input, { mode : 'strip', mutate : true });

            // Assert
            expect( result.success ).toBe( false );
            expect( input ).toEqual({ a : 'x', b : 'invalid' });
        });

        it( 'should reject nested extras under allOf even when member roots are closed', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        type       : 'object',
                        properties : {
                            nested : {
                                type                 : 'object',
                                properties           : { a : { type : 'string' } },
                                additionalProperties : false
                            }
                        },
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const result = validate( fn, { nested : { a : 'x', extra : 1 } });

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors.some( e => e.error.includes( 'PropertyNotAllowed' ))).toBe( true );
        });

        it( 'should reject when allOf const does not match', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [{ type : 'string' }],
                const : 'ok'
            });

            // Act
            fn( 'no', '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toContain( 'Const' );
        });

        it( 'should reject when a boolean false member is present', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [ true, false ]
            });

            // Act
            fn( 'anything', '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Schema<false>' );
        });

        it( 'should reject missing required keys across allOf members', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
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
            });

            // Act
            const result = validate( fn, { a : 'x' });

            // Assert
            expect( result.success ).toBe( false );
        });

        it( 'should fail is() when allOf does not match', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [{ type : 'string' }, { type : 'string', minLength : 3 }]
            });

            // Act / Assert
            expect( is( fn, 'ab' )).toBe( false );
            expect(() => assert( fn, 'ab' )).toThrow( /Validation Error/ );
            expect(() => assertGuard( fn, 'ab' )).toThrow( /Validation Error/ );
        });
    });

    describe( 'anyOf — positive', () =>
    {
        it( 'should accept the first matching arm', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    { type : 'string' },
                    { type : 'number' }
                ]
            });

            // Act
            const asString = validate( fn, 'hi' );
            const asNumber = validate( fn, 7 );

            // Assert
            expect( asString.success ).toBe( true );
            expect( asString.data ).toBe( 'hi' );
            expect( asNumber.success ).toBe( true );
            expect( asNumber.data ).toBe( 7 );
        });

        it( 'should accept typed literal unions via const arms', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    { type : 'string', const : 'folder' },
                    { type : 'string', const : 'file' }
                ]
            });

            // Act
            const folder = validate( fn, 'folder' );
            const file = validate( fn, 'file' );

            // Assert
            expect( folder.success ).toBe( true );
            expect( file.success ).toBe( true );
        });

        it( 'should accept object shape arms', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    {
                        type                 : 'object',
                        properties           : {
                            kind : { type : 'string', const : 'a' },
                            n    : { type : 'number' }
                        },
                        required             : ['kind', 'n'],
                        additionalProperties : false
                    },
                    {
                        type                 : 'object',
                        properties           : {
                            kind : { type : 'string', const : 'b' },
                            s    : { type : 'string' }
                        },
                        required             : ['kind', 's'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const a = validate( fn, { kind : 'a', n : 1 });
            const b = validate( fn, { kind : 'b', s : 'x' });

            // Assert
            expect( a.success ).toBe( true );
            expect( b.success ).toBe( true );
        });

        it( 'should accept a single-member anyOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [{ type : 'boolean' }]
            });

            // Act
            const result = fn( true, '', ctx );

            // Assert
            expect( result ).toBe( true );
            expect( ctx.success ).toBe( true );
        });

        it( 'should accept boolean true as an anyOf arm', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [ false, true ]
            });

            // Act
            const result = validate( fn, 123 );

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toBe( 123 );
        });

        it( 'should nest allOf inside anyOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    {
                        allOf : [
                            { type : 'string' },
                            { type : 'string', minLength : 2 }
                        ]
                    },
                    { type : 'number' }
                ]
            });

            // Act
            const str = validate( fn, 'ab' );
            const num = validate( fn, 9 );

            // Assert
            expect( str.success ).toBe( true );
            expect( num.success ).toBe( true );
        });

        it( 'should coerce a matching anyOf arm with from query', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    { type : 'number' },
                    { type : 'boolean' }
                ]
            });

            // Act
            const result = validate( fn, '42', { from : 'query' });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toBe( 42 );
        });

        it( 'should resolve $ref arms inside anyOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                $defs : {
                    Str : { type : 'string' },
                    Num : { type : 'number' }
                },
                anyOf : [
                    { $ref : '#/$defs/Str' },
                    { $ref : '#/$defs/Num' }
                ]
            });

            // Act
            const str = validate( fn, 'x' );
            const num = validate( fn, 1 );

            // Assert
            expect( str.success ).toBe( true );
            expect( num.success ).toBe( true );
        });
    });

    describe( 'anyOf — negative', () =>
    {
        it( 'should reject when no arm matches', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    { type : 'string' },
                    { type : 'number' }
                ]
            });

            // Act
            fn( true, '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors ).toHaveLength( 1 );
            expect( ctx.errors[0].error ).toBe( 'Type<Union>' );
            expect( ctx.errors[0].issues ).toHaveLength( 2 );
        });

        it( 'should reject values outside a const literal anyOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    { type : 'string', const : 'folder' },
                    { type : 'string', const : 'file' }
                ]
            });

            // Act
            const result = validate( fn, 'other' );

            // Assert
            expect( result.success ).toBe( false );
        });

        it( 'should reject object arms with wrong discriminators', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    {
                        type                 : 'object',
                        properties           : {
                            kind : { type : 'string', const : 'a' },
                            n    : { type : 'number' }
                        },
                        required             : ['kind', 'n'],
                        additionalProperties : false
                    },
                    {
                        type                 : 'object',
                        properties           : {
                            kind : { type : 'string', const : 'b' },
                            s    : { type : 'string' }
                        },
                        required             : ['kind', 's'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const wrong = validate( fn, { kind : 'a', s : 'x' });
            const unknown = validate( fn, { kind : 'c', n : 1 });

            // Assert
            expect( wrong.success ).toBe( false );
            expect( unknown.success ).toBe( false );
        });

        it( 'should reject an empty anyOf for any value', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({ anyOf : [] });

            // Act
            fn( 'x', '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<Union>' );
        });

        it( 'should reject when every anyOf arm is boolean false', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [ false, false ]
            });

            // Act
            const result = validate( fn, 'x' );

            // Assert
            expect( result.success ).toBe( false );
        });

        it( 'should fail is/assert helpers when no anyOf arm matches', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [{ type : 'string' }, { type : 'number' }]
            });

            // Act / Assert
            expect( is( fn, true )).toBe( false );
            expect(() => assert( fn, true )).toThrow( /Validation Error/ );
            expect(() => assertGuard( fn, true )).toThrow( /Validation Error/ );
        });

        it( 'should reject extras on closed anyOf object arms in strict mode', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    {
                        type                 : 'object',
                        properties           : { a : { type : 'string' } },
                        required             : ['a'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const result = validate( fn, { a : 'x', extra : 1 });

            // Assert
            expect( result.success ).toBe( false );
            expect(
                result.errors.some( e =>
                    e.error.includes( 'PropertyNotAllowed' ) ||
                    e.error === 'Type<Union>' ||
                    ( e.issues?.some( i => i.error.includes( 'PropertyNotAllowed' )) ?? false )
                )
            ).toBe( true );
        });
    });

    describe( 'combinator nesting', () =>
    {
        it( 'should accept allOf of anyOf of consts', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        anyOf : [
                            { type : 'string', const : 'x' },
                            { type : 'string', const : 'y' }
                        ]
                    },
                    { type : 'string', minLength : 1 }
                ]
            });

            // Act / Assert
            expect( validate( fn, 'x' ).success ).toBe( true );
            expect( validate( fn, 'y' ).success ).toBe( true );
            expect( validate( fn, 'z' ).success ).toBe( false );
        });

        it( 'should accept deep nested object allOf/anyOf trees', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type       : 'object',
                properties : {
                    payload : {
                        anyOf : [
                            {
                                allOf : [
                                    {
                                        type                 : 'object',
                                        properties           : { id : { type : 'string' } },
                                        required             : ['id'],
                                        additionalProperties : false
                                    },
                                    {
                                        type                 : 'object',
                                        properties           : { n : { type : 'number' } },
                                        required             : ['n'],
                                        additionalProperties : false
                                    }
                                ]
                            },
                            { type : 'string', const : 'none' }
                        ]
                    }
                },
                required             : ['payload'],
                additionalProperties : false
            });

            // Act
            const obj = validate( fn, { payload : { id : '1', n : 2 } });
            const none = validate( fn, { payload : 'none' });
            const bad = validate( fn, { payload : { id : '1' } });

            // Assert
            expect( obj.success ).toBe( true );
            expect( none.success ).toBe( true );
            expect( bad.success ).toBe( false );
        });
    });

    describe( 'deep nesting — positive', () =>
    {
        it( 'should validate a 4-level anyOf/allOf/anyOf/allOf string pipeline', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    {
                        allOf : [
                            {
                                anyOf : [
                                    {
                                        allOf : [
                                            { type : 'string' },
                                            { type : 'string', minLength : 2 },
                                            { type : 'string', maxLength : 8 }
                                        ]
                                    },
                                    { type : 'string', const : 'SHORT' }
                                ]
                            },
                            { type : 'string', pattern : '^[A-Za-z]+$' }
                        ]
                    },
                    { type : 'number', minimum : 100 }
                ]
            });

            // Act / Assert
            expect( validate( fn, 'Hello' ).success ).toBe( true );
            expect( validate( fn, 'SHORT' ).success ).toBe( true );
            expect( validate( fn, 150 ).success ).toBe( true );
        });

        it( 'should validate deeply nested closed object intersections', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        type       : 'object',
                        properties : {
                            meta : {
                                allOf : [
                                    {
                                        type                 : 'object',
                                        properties           : { id : { type : 'string' } },
                                        required             : ['id'],
                                        additionalProperties : false
                                    },
                                    {
                                        type                 : 'object',
                                        properties           : { version : { type : 'number' } },
                                        required             : ['version'],
                                        additionalProperties : false
                                    }
                                ]
                            }
                        },
                        required             : ['meta'],
                        additionalProperties : false
                    },
                    {
                        type       : 'object',
                        properties : {
                            body : {
                                anyOf : [
                                    {
                                        type                 : 'object',
                                        properties           : {
                                            kind  : { type : 'string', const : 'text' },
                                            value : { type : 'string', minLength : 1 }
                                        },
                                        required             : ['kind', 'value'],
                                        additionalProperties : false
                                    },
                                    {
                                        type                 : 'object',
                                        properties           : {
                                            kind : { type : 'string', const : 'count' },
                                            n    : { type : 'number' }
                                        },
                                        required             : ['kind', 'n'],
                                        additionalProperties : false
                                    }
                                ]
                            }
                        },
                        required             : ['body'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const text = validate( fn, {
                meta : { id : 'doc-1', version : 1 },
                body : { kind : 'text', value : 'hi' }
            });
            const count = validate( fn, {
                meta : { id : 'doc-2', version : 2 },
                body : { kind : 'count', n : 9 }
            });

            // Assert
            expect( text.success ).toBe( true );
            expect( text.data ).toEqual({
                meta : { id : 'doc-1', version : 1 },
                body : { kind : 'text', value : 'hi' }
            });
            expect( count.success ).toBe( true );
            expect( count.data ).toEqual({
                meta : { id : 'doc-2', version : 2 },
                body : { kind : 'count', n : 9 }
            });
        });

        it( 'should resolve deeply nested $ref chains through allOf and anyOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                $defs : {
                    LeafStr : { type : 'string', minLength : 1 },
                    LeafNum : { type : 'number', minimum : 0 },
                    Pair    : {
                        allOf : [
                            {
                                type                 : 'object',
                                properties           : { left : { $ref : '#/$defs/LeafStr' } },
                                required             : ['left'],
                                additionalProperties : false
                            },
                            {
                                type                 : 'object',
                                properties           : { right : { $ref : '#/$defs/LeafNum' } },
                                required             : ['right'],
                                additionalProperties : false
                            }
                        ]
                    },
                    Node : {
                        anyOf : [
                            { $ref : '#/$defs/Pair' },
                            {
                                type                 : 'object',
                                properties           : {
                                    child : { $ref : '#/$defs/Pair' }
                                },
                                required             : ['child'],
                                additionalProperties : false
                            }
                        ]
                    }
                },
                $ref : '#/$defs/Node'
            });

            // Act
            const leaf = validate( fn, { left : 'a', right : 1 });
            const wrapped = validate( fn, { child : { left : 'b', right : 2 } });

            // Assert
            expect( leaf.success ).toBe( true );
            expect( wrapped.success ).toBe( true );
            expect( wrapped.data ).toEqual({ child : { left : 'b', right : 2 } });
        });

        it( 'should validate arrays of deeply nested allOf object items', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type  : 'array',
                items : {
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
                                tags : {
                                    type     : 'array',
                                    items    : {
                                        anyOf : [
                                            { type : 'string', const : 'a' },
                                            { type : 'string', const : 'b' }
                                        ]
                                    },
                                    minItems : 1
                                }
                            },
                            required             : ['tags'],
                            additionalProperties : false
                        }
                    ]
                },
                minItems : 1
            });

            // Act
            const result = validate( fn, [
                { id : '1', tags : ['a'] },
                { id : '2', tags : ['b', 'a'] }
            ]);

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual([
                { id : '1', tags : ['a'] },
                { id : '2', tags : ['b', 'a'] }
            ]);
        });

        it( 'should coerce query values through nested allOf object members', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        type       : 'object',
                        properties : {
                            outer : {
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
                        required             : ['outer'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const result = validate( fn, { outer : { a : '1', b : '2' } }, { from : 'query' });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ outer : { a : 1, b : 2 } });
        });

        it( 'should accept recursive-looking depth via repeated anyOf wrappers', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    {
                        anyOf : [
                            {
                                anyOf : [
                                    {
                                        anyOf : [
                                            { type : 'string', const : 'deep' },
                                            { type : 'number', const : 7 }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            });

            // Act / Assert
            expect( validate( fn, 'deep' ).success ).toBe( true );
            expect( validate( fn, 7 ).success ).toBe( true );
        });

        it( 'should strip extras from nested closed allOf under strip mode', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
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
            });
            const input = { row : { a : 'x', b : 1, extra : true } };

            // Act
            const result = validate( fn, input, { mode : 'strip', mutate : true });

            // Assert
            expect( result.success ).toBe( true );
            expect( input ).toEqual({ row : { a : 'x', b : 1 } });
        });
    });

    describe( 'deep nesting — negative', () =>
    {
        it( 'should reject failures buried inside a 4-level combinator pipeline', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [
                    {
                        allOf : [
                            {
                                anyOf : [
                                    {
                                        allOf : [
                                            { type : 'string' },
                                            { type : 'string', minLength : 2 },
                                            { type : 'string', maxLength : 8 }
                                        ]
                                    }
                                ]
                            },
                            { type : 'string', pattern : '^[A-Za-z]+$' }
                        ]
                    },
                    { type : 'number', minimum : 100 }
                ]
            });

            // Act / Assert
            expect( validate( fn, '1' ).success ).toBe( false ); // fails pattern + minLength path, not a large number
            expect( validate( fn, 'toolongvalue' ).success ).toBe( false );
            expect( validate( fn, 50 ).success ).toBe( false );
            expect( validate( fn, true ).success ).toBe( false );
        });

        it( 'should reject nested closed allOf extras under strict mode', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        type       : 'object',
                        properties : {
                            meta : {
                                allOf : [
                                    {
                                        type                 : 'object',
                                        properties           : { id : { type : 'string' } },
                                        required             : ['id'],
                                        additionalProperties : false
                                    },
                                    {
                                        type                 : 'object',
                                        properties           : { version : { type : 'number' } },
                                        required             : ['version'],
                                        additionalProperties : false
                                    }
                                ]
                            }
                        },
                        required             : ['meta'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const result = validate( fn, {
                meta : { id : 'doc', version : 1, rogue : true }
            });

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors.some( e => e.error.includes( 'PropertyNotAllowed' ))).toBe( true );
        });

        it( 'should reject wrong arm deep inside nested object anyOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        type       : 'object',
                        properties : {
                            body : {
                                anyOf : [
                                    {
                                        type                 : 'object',
                                        properties           : {
                                            kind  : { type : 'string', const : 'text' },
                                            value : { type : 'string' }
                                        },
                                        required             : ['kind', 'value'],
                                        additionalProperties : false
                                    },
                                    {
                                        type                 : 'object',
                                        properties           : {
                                            kind : { type : 'string', const : 'count' },
                                            n    : { type : 'number' }
                                        },
                                        required             : ['kind', 'n'],
                                        additionalProperties : false
                                    }
                                ]
                            }
                        },
                        required             : ['body'],
                        additionalProperties : false
                    }
                ]
            });

            // Act
            const mixed = validate( fn, { body : { kind : 'text', n : 1 } });
            const unknown = validate( fn, { body : { kind : 'other', value : 'x' } });

            // Assert
            expect( mixed.success ).toBe( false );
            expect( unknown.success ).toBe( false );
        });

        it( 'should reject deep $ref targets when leaf constraints fail', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                $defs : {
                    LeafStr : { type : 'string', minLength : 2 },
                    LeafNum : { type : 'number', minimum : 10 },
                    Pair    : {
                        allOf : [
                            {
                                type                 : 'object',
                                properties           : { left : { $ref : '#/$defs/LeafStr' } },
                                required             : ['left'],
                                additionalProperties : false
                            },
                            {
                                type                 : 'object',
                                properties           : { right : { $ref : '#/$defs/LeafNum' } },
                                required             : ['right'],
                                additionalProperties : false
                            }
                        ]
                    }
                },
                type       : 'object',
                properties : {
                    node : { $ref : '#/$defs/Pair' }
                },
                required             : ['node'],
                additionalProperties : false
            });

            // Act
            const short = validate( fn, { node : { left : 'a', right : 10 } });
            const small = validate( fn, { node : { left : 'ab', right : 3 } });

            // Assert
            expect( short.success ).toBe( false );
            expect( small.success ).toBe( false );
        });

        it( 'should reject invalid tags in nested array anyOf items', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type  : 'array',
                items : {
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
                                tags : {
                                    type  : 'array',
                                    items : {
                                        anyOf : [
                                            { type : 'string', const : 'a' },
                                            { type : 'string', const : 'b' }
                                        ]
                                    }
                                }
                            },
                            required             : ['tags'],
                            additionalProperties : false
                        }
                    ]
                }
            });

            // Act
            const result = validate( fn, [{ id : '1', tags : ['a', 'c'] }]);

            // Assert
            expect( result.success ).toBe( false );
        });

        it( 'should reject missing required keys several levels down', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type       : 'object',
                properties : {
                    level1 : {
                        type       : 'object',
                        properties : {
                            level2 : {
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
                        required             : ['level2'],
                        additionalProperties : false
                    }
                },
                required             : ['level1'],
                additionalProperties : false
            });

            // Act
            const result = validate( fn, { level1 : { level2 : { a : 'x' } } });

            // Assert
            expect( result.success ).toBe( false );
        });

        it( 'should reject boolean false buried in nested allOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        anyOf : [
                            {
                                allOf : [
                                    { type : 'string' },
                                    false
                                ]
                            },
                            { type : 'number' }
                        ]
                    }
                ]
            });

            // Act
            const asString = validate( fn, 'hello' );
            const asNumber = validate( fn, 3 );

            // Assert
            expect( asString.success ).toBe( false );
            expect( asNumber.success ).toBe( true );
        });

        it( 'should not mutate deeply nested input when nested allOf fails', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
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
            });
            const input = { row : { a : 'x', b : 'bad', extra : 1 } };

            // Act
            const result = validate( fn, input, { mode : 'strip', mutate : true });

            // Assert
            expect( result.success ).toBe( false );
            expect( input ).toEqual({ row : { a : 'x', b : 'bad', extra : 1 } });
        });

        it( 'should surface union issues from a deeply nested anyOf miss', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type       : 'object',
                properties : {
                    wrap : {
                        allOf : [
                            {
                                type       : 'object',
                                properties : {
                                    value : {
                                        anyOf : [
                                            { type : 'string' },
                                            { type : 'number' }
                                        ]
                                    }
                                },
                                required             : ['value'],
                                additionalProperties : false
                            }
                        ]
                    }
                },
                required             : ['wrap'],
                additionalProperties : false
            });

            // Act
            fn({ wrap : { value : true } }, '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors.some( e =>
                e.error === 'Type<Union>' ||
                ( e.issues?.some( i => i.error.includes( 'Type<' )) ?? false )
            )).toBe( true );
        });
    });

    describe( 'type arrays, contains, patternProperties, propertyNames, dependencies', () =>
    {
        it( 'should accept type arrays as anyOf of single-type schemas', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({ type : [ 'string', 'number' ] });

            // Act / Assert
            expect( validate( fn, 'ok' ).success ).toBe( true );
            expect( validate( fn, 3 ).success ).toBe( true );
            expect( validate( fn, true ).success ).toBe( false );
        });

        it( 'should reject when no type-array arm matches nested constraints', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type      : [ 'string', 'number' ],
                minLength : 3,
                minimum   : 10
            });

            // Act / Assert
            expect( validate( fn, 'ab' ).success ).toBe( false );
            expect( validate( fn, 5 ).success ).toBe( false );
            expect( validate( fn, 'abcd' ).success ).toBe( true );
            expect( validate( fn, 10 ).success ).toBe( true );
        });

        it( 'should enforce contains / minContains / maxContains', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type        : 'array',
                contains    : { type : 'string', minLength : 2 },
                minContains : 2,
                maxContains : 3
            });

            // Act / Assert
            expect( validate( fn, [ 1, 'ab', 'cd' ] ).success ).toBe( true );
            expect( validate( fn, [ 1, 'ab' ] ).success ).toBe( false );
            expect( validate( fn, [ 'ab', 'cd', 'ef', 'gh' ] ).success ).toBe( false );
        });

        it( 'should enforce patternProperties alongside properties', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type              : 'object',
                properties        : { id : { type : 'string' } },
                patternProperties : { '^x_' : { type : 'number' } },
                additionalProperties : false
            });

            // Act / Assert
            expect( validate( fn, { id : 'a', x_count : 2 } ).success ).toBe( true );
            expect( validate( fn, { id : 'a', x_count : 'no' } ).success ).toBe( false );
            expect( validate( fn, { id : 'a', other : 1 } ).success ).toBe( false );
        });

        it( 'should enforce propertyNames against every key', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type                 : 'object',
                propertyNames        : { type : 'string', pattern : '^[a-z]+$' },
                additionalProperties : true
            });

            // Act / Assert
            expect( validate( fn, { abc : 1 } ).success ).toBe( true );
            expect( validate( fn, { 'Bad-Key' : 1 } ).success ).toBe( false );
        });

        it( 'should enforce dependentRequired and draft-07 dependencies property lists', () =>
        {
            // Arrange
            const dependent = getOrCompileSchema({
                type              : 'object',
                dependentRequired : { credit_card : [ 'billing_address' ] },
                additionalProperties : true
            });
            const legacy = getOrCompileSchema({
                type         : 'object',
                dependencies : { credit_card : [ 'billing_address' ] },
                additionalProperties : true
            });

            // Act / Assert
            expect( validate( dependent, { name : 'a' } ).success ).toBe( true );
            expect( validate( dependent, { credit_card : '1' } ).success ).toBe( false );
            expect( validate( dependent, {
                credit_card      : '1',
                billing_address  : 'x'
            }).success ).toBe( true );
            expect( validate( legacy, { credit_card : '1' } ).success ).toBe( false );
            expect( validate( legacy, {
                credit_card      : '1',
                billing_address  : 'x'
            }).success ).toBe( true );
        });

        it( 'should enforce dependentSchemas and schema-form dependencies', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type             : 'object',
                dependentSchemas : {
                    credit_card : {
                        type       : 'object',
                        properties : { billing_address : { type : 'string', minLength : 1 } },
                        required   : [ 'billing_address' ]
                    }
                },
                additionalProperties : true
            });
            const legacy = getOrCompileSchema({
                type         : 'object',
                dependencies : {
                    credit_card : {
                        type       : 'object',
                        properties : { billing_address : { type : 'string' } },
                        required   : [ 'billing_address' ]
                    }
                },
                additionalProperties : true
            });

            // Act / Assert
            expect( validate( fn, { name : 'a' } ).success ).toBe( true );
            expect( validate( fn, { credit_card : '1' } ).success ).toBe( false );
            expect( validate( fn, {
                credit_card     : '1',
                billing_address : 'x'
            }).success ).toBe( true );
            expect( validate( legacy, { credit_card : '1' } ).success ).toBe( false );
            expect( validate( legacy, {
                credit_card     : '1',
                billing_address : 'x'
            }).success ).toBe( true );
        });
    });

    describe( 'prefixItems, additionalItems, unevaluatedProperties / unevaluatedItems', () =>
    {
        it( 'should validate prefixItems and items for trailing elements', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type        : 'array',
                prefixItems : [ { type : 'string' }, { type : 'number' } ],
                items       : { type : 'boolean' }
            });

            // Act / Assert
            expect( validate( fn, [ 'a', 1, true, false ] ).success ).toBe( true );
            expect( validate( fn, [ 'a', 1, 'no' ] ).success ).toBe( false );
            expect( validate( fn, [ 1, 1 ] ).success ).toBe( false );
        });

        it( 'should reject trailing items when items is false', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type        : 'array',
                prefixItems : [ { type : 'string' } ],
                items       : false
            });

            // Act / Assert
            expect( validate( fn, [ 'a' ] ).success ).toBe( true );
            expect( validate( fn, [ 'a', 1 ] ).success ).toBe( false );
        });

        it( 'should honor draft-07 tuple items + additionalItems', () =>
        {
            // Arrange
            const open = getOrCompileSchema({
                type  : 'array',
                items : [ { type : 'string' }, { type : 'number' } ]
            });
            const closed = getOrCompileSchema({
                type            : 'array',
                items           : [ { type : 'string' } ],
                additionalItems : false
            });

            // Act / Assert
            expect( validate( open, [ 'a', 1, true ] ).success ).toBe( true );
            expect( validate( closed, [ 'a' ] ).success ).toBe( true );
            expect( validate( closed, [ 'a', 1 ] ).success ).toBe( false );
        });

        it( 'should enforce unevaluatedItems after prefixItems and contains', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type             : 'array',
                prefixItems      : [ { type : 'string' } ],
                contains         : { type : 'number' },
                unevaluatedItems : false
            });

            // Act / Assert
            expect( validate( fn, [ 'a', 2 ] ).success ).toBe( true );
            expect( validate( fn, [ 'a', true ] ).success ).toBe( false );
            expect( validate( fn, [ 'a', 2, false ] ).success ).toBe( false );
        });

        it( 'should enforce unevaluatedProperties for keys not covered by properties/patternProperties', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type                  : 'object',
                properties            : { id : { type : 'string' } },
                patternProperties     : { '^x_' : { type : 'number' } },
                unevaluatedProperties : false
            });

            // Act / Assert
            expect( validate( fn, { id : 'a', x_n : 1 } ).success ).toBe( true );
            expect( validate( fn, { id : 'a', extra : 1 } ).success ).toBe( false );
        });

        it( 'should apply new keywords from typeless schemas when the instance matches', () =>
        {
            // Arrange
            const obj = getOrCompileSchema({
                patternProperties     : { '^n_' : { type : 'number' } },
                unevaluatedProperties : false
            });
            const arr = getOrCompileSchema({
                prefixItems      : [ { type : 'string' } ],
                unevaluatedItems : false
            });

            // Act / Assert
            expect( validate( obj, { n_a : 1 } ).success ).toBe( true );
            expect( validate( obj, { other : 1 } ).success ).toBe( false );
            expect( validate( obj, 'skip' ).success ).toBe( true );
            expect( validate( arr, [ 'a' ] ).success ).toBe( true );
            expect( validate( arr, [ 'a', 1 ] ).success ).toBe( false );
            expect( validate( arr, { not : 'array' } ).success ).toBe( true );
        });

        it( 'should still throw for unknown x-typescript-type values', () =>
        {
            // Act / Assert
            expect(() => getOrCompileSchema({ 'x-typescript-type' : 'UnknownType' })).toThrow(
                /Unsupported x-typescript-type/
            );
        });

        it( 'should reject every item when items is false without prefixItems', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({ type : 'array', items : false });

            // Act / Assert
            expect( validate( fn, [] ).success ).toBe( true );
            expect( validate( fn, [ 1 ] ).success ).toBe( false );
        });

        it( 'should validate unevaluatedProperties / unevaluatedItems schemas', () =>
        {
            // Arrange
            const obj = getOrCompileSchema({
                type                  : 'object',
                properties            : { id : { type : 'string' } },
                unevaluatedProperties : { type : 'number' }
            });
            const arr = getOrCompileSchema({
                type             : 'array',
                prefixItems      : [ { type : 'string' } ],
                unevaluatedItems : { type : 'number' }
            });

            // Act / Assert
            expect( validate( obj, { id : 'a', n : 1 } ).success ).toBe( true );
            expect( validate( obj, { id : 'a', n : 'x' } ).success ).toBe( false );
            expect( validate( arr, [ 'a', 2 ] ).success ).toBe( true );
            expect( validate( arr, [ 'a', 'b' ] ).success ).toBe( false );
        });

        it( 'should allow unevaluatedProperties true and additionalProperties schema forms', () =>
        {
            // Arrange
            const open = getOrCompileSchema({
                type                  : 'object',
                properties            : { id : { type : 'string' } },
                unevaluatedProperties : true
            });
            const extras = getOrCompileSchema({
                type                 : 'object',
                properties           : { id : { type : 'string' } },
                additionalProperties : { type : 'boolean' }
            });

            // Act / Assert
            expect( validate( open, { id : 'a', extra : 'kept' } ).success ).toBe( true );
            expect( validate( extras, { id : 'a', flag : true } ).success ).toBe( true );
            expect( validate( extras, { id : 'a', flag : 1 } ).success ).toBe( false );
        });

        it( 'should keep or strip unknown keys under patternProperties with additionalProperties false', () =>
        {
            // Arrange
            const schema =
            {
                type                 : 'object',
                patternProperties    : { '^x_' : { type : 'number' } },
                additionalProperties : false
            };

            // Act / Assert
            expect( validate( getOrCompileSchema( schema ), { x_a : 1 }, { mode : 'relaxed' }).success )
                .toBe( true );
            expect( validate( getOrCompileSchema( schema ), { x_a : 1, y : 2 }, { mode : 'strip' }).data )
                .toEqual({ x_a : 1 });
            expect( validate( getOrCompileSchema( schema ), { x_a : 1, y : 2 }, { mode : 'relaxed' }).data )
                .toEqual({ x_a : 1, y : 2 });
        });

        it( 'should require keys listed only in required', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type                 : 'object',
                required             : [ 'must' ],
                additionalProperties : true
            });

            // Act / Assert
            expect( validate( fn, {} ).success ).toBe( false );
            expect( validate( fn, { must : 1 } ).success ).toBe( true );
        });
    });

    describe( 'oneOf / not / enum / if-then-else', () =>
    {
        it( 'should accept exactly one matching oneOf arm', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                oneOf : [
                    { type : 'string', const : 'a' },
                    { type : 'string', const : 'b' },
                    { type : 'number' }
                ]
            });

            // Act / Assert
            expect( validate( fn, 'a' ).success ).toBe( true );
            expect( validate( fn, 3 ).success ).toBe( true );
            expect( validate( fn, 'c' ).success ).toBe( false );
        });

        it( 'should reject when multiple oneOf arms match', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                oneOf : [
                    { type : 'string' },
                    { type : 'string', minLength : 1 }
                ]
            });

            // Act
            const result = validate( fn, 'hi' );

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors[0].error ).toBe( 'Type<OneOf:multiple>' );
        });

        it( 'should invert a subschema with not', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type : 'string',
                not  : { const : 'blocked' }
            });

            // Act / Assert
            expect( validate( fn, 'ok' ).success ).toBe( true );
            expect( validate( fn, 'blocked' ).success ).toBe( false );
            expect( validate( fn, 'blocked' ).errors?.[0].error ).toBe( 'Schema<not>' );
        });

        it( 'should enforce enum values with deep equality', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                enum : [ 'a', 1, { x : 1 } ]
            });

            // Act / Assert
            expect( validate( fn, 'a' ).success ).toBe( true );
            expect( validate( fn, 1 ).success ).toBe( true );
            expect( validate( fn, { x : 1 } ).success ).toBe( true );
            expect( validate( fn, 'b' ).success ).toBe( false );
            expect( validate( fn, { x : 2 } ).success ).toBe( false );
        });

        it( 'should apply if/then/else branches', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type : 'object',
                if   : {
                    properties : { kind : { const : 'num' } },
                    required   : ['kind']
                },
                then : {
                    properties : { value : { type : 'number' } },
                    required   : ['value']
                },
                else : {
                    properties : { value : { type : 'string' } },
                    required   : ['value']
                },
                properties : {
                    kind  : { type : 'string' },
                    value : {}
                },
                required             : ['kind', 'value'],
                additionalProperties : true
            });

            // Act
            const num = validate( fn, { kind : 'num', value : 1 });
            const str = validate( fn, { kind : 'str', value : 'x' });
            const bad = validate( fn, { kind : 'num', value : 'x' });

            // Assert
            expect( num.success ).toBe( true );
            expect( str.success ).toBe( true );
            expect( bad.success ).toBe( false );
        });

        it( 'should ignore then/else when if is absent', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type : 'string',
                then : { const : 'nope' }
            });

            // Act / Assert
            expect( validate( fn, 'anything' ).success ).toBe( true );
        });
    });
});
