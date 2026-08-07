import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getOrCompileSchema,
    validate,
    type ValidationContext
} from '../src/runtime/validators.js';
import { validateSchema } from '../src/index.js';

describe( 'JSON Schema AJV-complete coverage', () =>
{
    let ctx: ValidationContext;

    beforeEach(() =>
    {
        ctx = {
            success     : true,
            errors      : [],
            mode        : 'strict',
            annotations : { properties : new Set(), items : new Set(), itemsAll : false }
        };
    });

    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    describe( 'unevaluatedProperties across allOf annotations — positive', () =>
    {
        it( 'should accept keys evaluated by sibling allOf members', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    { type : 'object', properties : { a : { type : 'number' } } },
                    { type : 'object', properties : { b : { type : 'string' } } }
                ],
                unevaluatedProperties : false
            });

            // Act
            const result = validate( fn, { a : 1, b : 'x' });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual({ a : 1, b : 'x' });
        });

        it( 'should accept patternProperties evaluations from an allOf member', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        type              : 'object',
                        patternProperties : { '^x_' : { type : 'number' } }
                    },
                    {
                        type       : 'object',
                        properties : { id : { type : 'string' } }
                    }
                ],
                unevaluatedProperties : false
            });

            // Act / Assert
            expect( validate( fn, { id : 'a', x_n : 2 } ).success ).toBe( true );
        });

        it( 'should accept additionalProperties schema evaluations from a member', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        type                 : 'object',
                        properties           : { id : { type : 'string' } },
                        additionalProperties : { type : 'boolean' }
                    }
                ],
                unevaluatedProperties : false
            });

            // Act / Assert
            expect( validate( fn, { id : 'a', flag : true } ).success ).toBe( true );
        });
    });

    describe( 'unevaluatedProperties across allOf annotations — negative', () =>
    {
        it( 'should reject keys not evaluated by any allOf member', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    { type : 'object', properties : { a : { type : 'number' } } },
                    { type : 'object', properties : { b : { type : 'string' } } }
                ],
                unevaluatedProperties : false
            });

            // Act
            const result = validate( fn, { a : 1, b : 'x', c : true });

            // Assert
            expect( result.success ).toBe( false );
            expect( result.errors?.some( e => e.error === 'UnevaluatedProperty<c>' )).toBe( true );
        });

        it( 'should reject when nested allOf/anyOf leaves a key unevaluated', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        anyOf : [
                            { type : 'object', properties : { a : { type : 'number' } } },
                            { type : 'object', properties : { b : { type : 'number' } } }
                        ]
                    }
                ],
                unevaluatedProperties : false
            });

            // Act / Assert
            expect( validate( fn, { a : 1 } ).success ).toBe( true );
            expect( validate( fn, { a : 1, extra : 1 } ).success ).toBe( false );
        });

        it( 'should still reject closed allOf extras without unevaluatedProperties', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        type                 : 'object',
                        properties           : { a : { type : 'number' } },
                        additionalProperties : false
                    },
                    {
                        type                 : 'object',
                        properties           : { b : { type : 'string' } },
                        additionalProperties : false
                    }
                ]
            });

            // Act / Assert
            expect( validate( fn, { a : 1, b : 'x' } ).success ).toBe( true );
            expect( validate( fn, { a : 1, b : 'x', c : 1 } ).success ).toBe( false );
        });
    });

    describe( 'unevaluatedItems across allOf annotations', () =>
    {
        it( 'should accept items evaluated by prefixItems and contains siblings', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    { type : 'array', prefixItems : [ { type : 'string' } ] },
                    { type : 'array', contains : { type : 'number' } }
                ],
                unevaluatedItems : false
            });

            // Act / Assert
            expect( validate( fn, [ 'a', 1 ] ).success ).toBe( true );
            expect( validate( fn, [ 'a', 1, true ] ).success ).toBe( false );
            expect( validate( fn, [ 'a', 1, true ] ).errors?.some( e =>
                e.error === 'UnevaluatedItem<2>'
            )).toBe( true );
        });

        it( 'should treat items applicator as evaluating every index', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    { type : 'array', items : { type : [ 'string', 'number', 'boolean' ] } }
                ],
                unevaluatedItems : false
            });

            // Act / Assert
            expect( validate( fn, [ 'a', 1, false ] ).success ).toBe( true );
        });
    });

    describe( 'if/then/else annotation contribution', () =>
    {
        it( 'should merge then-branch property annotations for unevaluatedProperties', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type       : 'object',
                properties : { kind : { const : 'a' } },
                if         : { properties : { kind : { const : 'a' } } },
                then       : { properties : { value : { type : 'number' } } },
                unevaluatedProperties : false
            });

            // Act / Assert
            expect( validate( fn, { kind : 'a', value : 1 } ).success ).toBe( true );
            expect( validate( fn, { kind : 'a', value : 1, extra : 1 } ).success ).toBe( false );
        });
    });

    describe( 'minProperties / maxProperties', () =>
    {
        it( 'should enforce property count bounds — positive and negative', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type                 : 'object',
                minProperties        : 2,
                maxProperties        : 3,
                additionalProperties : true
            });

            // Act / Assert
            expect( validate( fn, { a : 1 } ).success ).toBe( false );
            expect( validate( fn, { a : 1, b : 2 } ).success ).toBe( true );
            expect( validate( fn, { a : 1, b : 2, c : 3 } ).success ).toBe( true );
            expect( validate( fn, { a : 1, b : 2, c : 3, d : 4 } ).success ).toBe( false );
        });
    });

    describe( 'draft-04 boolean exclusiveMinimum / exclusiveMaximum', () =>
    {
        it( 'should treat boolean exclusiveMinimum as exclusive over minimum', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type             : 'number',
                minimum          : 5,
                exclusiveMinimum : true
            });

            // Act / Assert
            expect( validate( fn, 5 ).success ).toBe( false );
            expect( validate( fn, 5.01 ).success ).toBe( true );
        });

        it( 'should treat boolean exclusiveMaximum as exclusive over maximum', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type             : 'number',
                maximum          : 10,
                exclusiveMaximum : true
            });

            // Act / Assert
            expect( validate( fn, 10 ).success ).toBe( false );
            expect( validate( fn, 9.99 ).success ).toBe( true );
        });

        it( 'should treat boolean exclusiveMinimum false as inclusive minimum', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type             : 'number',
                minimum          : 5,
                exclusiveMinimum : false
            });

            // Act / Assert
            expect( validate( fn, 5 ).success ).toBe( true );
            expect( validate( fn, 4.9 ).success ).toBe( false );
        });

        it( 'should treat boolean exclusiveMaximum false as inclusive maximum', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type             : 'number',
                maximum          : 10,
                exclusiveMaximum : false
            });

            // Act / Assert
            expect( validate( fn, 10 ).success ).toBe( true );
            expect( validate( fn, 10.1 ).success ).toBe( false );
        });

        it( 'should keep numeric exclusive bounds', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type             : 'number',
                exclusiveMinimum : 0,
                exclusiveMaximum : 10
            });

            // Act / Assert
            expect( validate( fn, 0 ).success ).toBe( false );
            expect( validate( fn, 5 ).success ).toBe( true );
            expect( validate( fn, 10 ).success ).toBe( false );
        });
    });

    describe( 'unevaluatedProperties / Items schema forms', () =>
    {
        it( 'should validate unevaluatedProperties schema across allOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    { type : 'object', properties : { a : { type : 'number' } } }
                ],
                unevaluatedProperties : { type : 'boolean' }
            });

            // Act / Assert
            expect( validate( fn, { a : 1, flag : true } ).success ).toBe( true );
            expect( validate( fn, { a : 1, flag : 'no' } ).success ).toBe( false );
        });

        it( 'should validate unevaluatedItems schema across allOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    { type : 'array', prefixItems : [ { type : 'string' } ] }
                ],
                unevaluatedItems : { type : 'number' }
            });

            // Act / Assert
            expect( validate( fn, [ 'a', 2 ] ).success ).toBe( true );
            expect( validate( fn, [ 'a', true ] ).success ).toBe( false );
        });
    });

    describe( 'combinator peel with sibling keywords', () =>
    {
        it( 'should apply type constraints alongside allOf members', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type  : 'object',
                allOf : [
                    { properties : { a : { type : 'number' } } }
                ],
                required             : [ 'a' ],
                additionalProperties : false
            });

            // Act / Assert
            expect( validate( fn, { a : 1 } ).success ).toBe( true );
            expect( validate( fn, {} ).success ).toBe( false );
            expect( validate( fn, 'nope' ).success ).toBe( false );
        });

        it( 'should peel $dynamicRef siblings into composed allOf', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                $defs : {
                    box : {
                        $dynamicAnchor : 'box',
                        type           : 'object',
                        properties     : { n : { type : 'number' } },
                        additionalProperties : false
                    }
                },
                type                 : 'object',
                properties           : { wrap : { $dynamicRef : '#box' } },
                required             : [ 'wrap' ],
                additionalProperties : false
            });

            // Act / Assert
            expect( validate( fn, { wrap : { n : 1 } } ).success ).toBe( true );
            expect( validate( fn, { wrap : { n : 'x' } } ).success ).toBe( false );
        });
    });

    describe( 'contentEncoding / contentMediaType / contentSchema', () =>
    {
        it( 'should decode base64 JSON and validate contentSchema — positive', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type             : 'string',
                contentEncoding  : 'base64',
                contentMediaType : 'application/json',
                contentSchema    : {
                    type                 : 'object',
                    properties           : { n : { type : 'number' } },
                    required             : [ 'n' ],
                    additionalProperties : false
                }
            });
            const payload = Buffer.from( JSON.stringify({ n : 1 })).toString( 'base64' );

            // Act / Assert
            expect( validate( fn, payload ).success ).toBe( true );
        });

        it( 'should reject invalid base64 and contentSchema failures — negative', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type             : 'string',
                contentEncoding  : 'base64',
                contentMediaType : 'application/json',
                contentSchema    : {
                    type                 : 'object',
                    properties           : { n : { type : 'number' } },
                    required             : [ 'n' ],
                    additionalProperties : false
                }
            });

            // Act / Assert
            expect( validate( fn, '@@@' ).success ).toBe( false );
            expect( validate(
                fn,
                Buffer.from( JSON.stringify({ n : 'x' })).toString( 'base64' )
            ).success ).toBe( false );
            expect( validate(
                fn,
                Buffer.from( 'not-json' ).toString( 'base64' )
            ).success ).toBe( false );
        });

        it( 'should validate contentSchema against decoded utf8 when media type is not json', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type             : 'string',
                contentEncoding  : 'base64',
                contentMediaType : 'text/plain',
                contentSchema    : { type : 'string', minLength : 3 }
            });

            // Act / Assert
            expect( validate( fn, Buffer.from( 'hi' ).toString( 'base64' )).success ).toBe( false );
            expect( validate( fn, Buffer.from( 'hello' ).toString( 'base64' )).success ).toBe( true );
        });
    });

    describe( '$anchor / $dynamicRef / $recursiveRef', () =>
    {
        it( 'should resolve $anchor by name', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                $defs : {
                    leaf : {
                        $anchor : 'leaf',
                        type    : 'string',
                        const   : 'ok'
                    }
                },
                $ref : '#leaf'
            });

            // Act / Assert
            expect( validate( fn, 'ok' ).success ).toBe( true );
            expect( validate( fn, 'no' ).success ).toBe( false );
        });

        it( 'should follow $dynamicRef through $dynamicAnchor recursion', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                $defs : {
                    node : {
                        $dynamicAnchor : 'node',
                        type           : 'object',
                        properties     : {
                            v    : { type : 'number' },
                            next : { $dynamicRef : '#node' }
                        },
                        additionalProperties : false
                    }
                },
                $ref : '#/$defs/node'
            });

            // Act / Assert
            expect( validate( fn, { v : 1, next : { v : 2 } } ).success ).toBe( true );
            expect( validate( fn, { v : 1, next : { v : 'x' } } ).success ).toBe( false );
        });

        it( 'should follow $recursiveRef / $recursiveAnchor', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                $defs : {
                    node : {
                        $recursiveAnchor : true,
                        type             : 'object',
                        properties       : {
                            v    : { type : 'number' },
                            next : { $recursiveRef : '#' }
                        },
                        additionalProperties : false
                    }
                },
                $ref : '#/$defs/node'
            });

            // Act / Assert
            expect( validate( fn, { v : 1 } ).success ).toBe( true );
            expect( validate( fn, { v : 1, next : { v : 2 } } ).success ).toBe( true );
            expect( validate( fn, { v : 1, next : { v : 'x' } } ).success ).toBe( false );
        });

        it( 'should reject remote http(s) references', () =>
        {
            // Act / Assert
            expect(() => getOrCompileSchema({ $ref : 'https://example.com/schema.json' })).toThrow(
                /Unsupported JSON Schema reference/
            );
            expect(() => getOrCompileSchema({ $ref : 'http://example.com/schema.json' })).toThrow(
                /Unsupported JSON Schema reference/
            );
        });
    });

    describe( 'oneOf / anyOf annotation merging with unevaluatedProperties', () =>
    {
        it( 'should merge the winning oneOf arm annotations', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                oneOf : [
                    {
                        type       : 'object',
                        properties : { a : { type : 'number' } },
                        required   : [ 'a' ]
                    },
                    {
                        type       : 'object',
                        properties : { b : { type : 'string' } },
                        required   : [ 'b' ]
                    }
                ],
                unevaluatedProperties : false
            });

            // Act / Assert
            expect( validate( fn, { a : 1 } ).success ).toBe( true );
            expect( validate( fn, { a : 1, extra : 1 } ).success ).toBe( false );
        });

        it( 'should union annotations from all successful anyOf arms', () =>
        {
            // Arrange — typeless object applicators leave undeclared keys unevaluated
            const fn = getOrCompileSchema({
                anyOf : [
                    { properties : { a : { type : 'number' } } },
                    { properties : { b : { type : 'number' } } }
                ],
                unevaluatedProperties : false
            });

            // Act / Assert
            expect( validate( fn, { a : 1, b : 2 } ).success ).toBe( true );
            expect( validate( fn, { a : 1, b : 2, c : 3 } ).success ).toBe( false );
        });
    });

    describe( 'validateSchema public API parity', () =>
    {
        it( 'should expose cross-allOf unevaluatedProperties through validateSchema', () =>
        {
            // Arrange
            const schema =
            {
                allOf : [
                    { type : 'object', properties : { a : { type : 'number' } } },
                    { type : 'object', properties : { b : { type : 'string' } } }
                ],
                unevaluatedProperties : false
            };

            // Act / Assert
            expect( validateSchema( schema, { a : 1, b : 'x' }).success ).toBe( true );
            expect( validateSchema( schema, { a : 1, b : 'x', c : 1 }).success ).toBe( false );
        });
    });

    describe( 'content encoding edge cases', () =>
    {
        it( 'should accept 7bit/8bit/binary/quoted-printable and base64url', () =>
        {
            // Arrange / Act / Assert
            for( const encoding of [ '7bit', '8bit', 'binary', 'quoted-printable' ])
            {
                const fn = getOrCompileSchema({
                    type            : 'string',
                    contentEncoding : encoding,
                    contentSchema   : { type : 'string', minLength : 1 }
                });

                expect( validate( fn, 'abc' ).success ).toBe( true );
            }

            const url = getOrCompileSchema({
                type            : 'string',
                contentEncoding : 'base64url',
                contentSchema   : { type : 'string', minLength : 1 }
            });
            const payload = Buffer.from( 'hello' ).toString( 'base64url' );

            expect( validate( url, payload ).success ).toBe( true );
        });

        it( 'should reject unknown contentEncoding values', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type            : 'string',
                contentEncoding : 'unknown-codec'
            });

            // Act / Assert
            expect( validate( fn, 'abc' ).success ).toBe( false );
        });
    });

    describe( 'ref and dynamic resolution edges', () =>
    {
        it( 'should reject missing anchors', () =>
        {
            // Act / Assert
            expect(() => getOrCompileSchema({ $ref : '#missing-anchor' })).toThrow(
                /Schema reference not found/
            );
        });

        it( 'should peel $recursiveRef with sibling type constraints', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                $defs : {
                    node : {
                        $recursiveAnchor : true,
                        type             : 'object',
                        properties       : {
                            v    : { type : 'number' },
                            next : { $recursiveRef : '#' }
                        },
                        additionalProperties : false
                    }
                },
                type                 : 'object',
                properties           : { root : { $ref : '#/$defs/node' } },
                required             : [ 'root' ],
                additionalProperties : false
            });

            // Act / Assert
            expect( validate( fn, { root : { v : 1 } } ).success ).toBe( true );
            expect( validate( fn, { root : { v : 'x' } } ).success ).toBe( false );
        });

        it( 'should coerce query scalars into arrays for prefixItems schemas', () =>
        {
            // Arrange
            const fn = getOrCompileSchema({
                type        : 'array',
                prefixItems : [ { type : 'string' } ],
                items       : false
            });

            // Act
            const result = validate( fn, 'only', { from : 'query' });

            // Assert
            expect( result.success ).toBe( true );
            expect( result.data ).toEqual([ 'only' ]);
        });
    });
});
