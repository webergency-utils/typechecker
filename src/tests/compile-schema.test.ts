import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { type ValidationContext, getOrCompileSchema } from '../runtime/validators.js';

describe( 'compileSchema', () => 
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

    describe( 'x-typescript-type branches', () => 
    {
        it( 'should accept and reject Promise instances', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({ 'x-typescript-type' : 'Promise' });

            // Act
            const ok = fn( Promise.resolve( 1 ), '', ctx );

            // Assert
            expect( ok ).toBeInstanceOf( Promise );
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            fn({}, '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<Promise>' );
        });

        it( 'should validate typed-array x-typescript-type schemas', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({ 'x-typescript-type' : 'Uint8Array' });
            const bytes = new Uint8Array([1, 2]);

            // Act
            const result = fn( bytes, '', ctx );

            // Assert
            expect( result ).toBe( bytes );
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            fn([1, 2], '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<Uint8Array>' );
        });

        it( 'should default Set and Map child schemas when items/key/value are omitted', () => 
        {
            // Arrange
            const setFn = getOrCompileSchema({ 'x-typescript-type' : 'Set' });
            const mapFn = getOrCompileSchema({ 'x-typescript-type' : 'Map' });

            // Act
            const setResult = setFn( new Set([1]), '', ctx );

            // Assert
            expect([ ...setResult ]).toEqual([1]);
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            const mapResult = mapFn( new Map([['a', 1]]), '', ctx );

            // Assert
            expect( mapResult.get( 'a' )).toBe( 1 );
            expect( ctx.success ).toBe( true );
        });
    });

    describe( 'combinators', () => 
    {
        it( 'should validate anyOf as a union with nested issues', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({
                anyOf : [{ type : 'string' }, { type : 'number' }]
            });

            // Act
            fn( true, 'v', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors ).toHaveLength( 1 );
            expect( ctx.errors[0].error ).toBe( 'Type<Union>' );
            expect( ctx.errors[0].issues ).toHaveLength( 2 );
        });

        it( 'should preserve strip mode instead of forcing relaxed for allOf', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    {
                        type                 : 'object',
                        properties           : { a : { type : 'string' } },
                        required             : ['a'],
                        additionalProperties : true
                    },
                    {
                        type                 : 'object',
                        properties           : { b : { type : 'number' } },
                        required             : ['b'],
                        additionalProperties : true
                    }
                ]
            });
            ctx.mode = 'strip';
            const payload = { a : 'x', b : 1, extra : true };

            // Act
            const result = fn( payload, '', ctx );

            // Assert
            expect( ctx.success ).toBe( true );
            expect( result ).toEqual( expect.objectContaining({ a : 'x', b : 1 }));
            expect( ctx.mode ).toBe( 'strip' );
        });
    });

    describe( 'object additionalProperties', () => 
    {
        it( 'should validate named props and additionalProperties together', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({
                type                 : 'object',
                properties           : { id : { type : 'number' } },
                required             : ['id'],
                additionalProperties : { type : 'string' }
            });

            // Act
            const result = fn({ id : 1, label : 'ok' }, '', ctx );

            // Assert
            expect( ctx.success ).toBe( true );
            expect( result ).toEqual({ id : 1, label : 'ok' });

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            fn({ id : 1, label : 9 }, '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors.some( e => e.path === 'label' || e.path.endsWith( 'label' ))).toBe( true );
        });

        it( 'should allow open objects when additionalProperties is true', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({
                type                 : 'object',
                properties           : { id : { type : 'number' } },
                required             : ['id'],
                additionalProperties : true
            });

            // Act
            const result = fn({ id : 1, extra : { nested : true } }, '', ctx );

            // Assert
            expect( ctx.success ).toBe( true );
            expect( result.extra ).toEqual({ nested : true });
        });
    });

    describe( 'refs and const', () => 
    {
        it( 'should resolve $ref definitions and cache compiled proxies', () => 
        {
            // Arrange
            const schema = 
            {
                $defs : 
                {
                    Name : { type : 'string', minLength : 2 }
                },
                type : 'object',
                properties : 
                {
                    name : { $ref : '#/$defs/Name' }
                },
                required             : ['name'],
                additionalProperties : false
            };
            const fn = getOrCompileSchema( schema );

            // Act
            const ok = fn({ name : 'ab' }, '', ctx );

            // Assert
            expect( ok ).toEqual({ name : 'ab' });
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            fn({ name : 'a' }, '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
        });

        it( 'should enforce const values', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({ const : 'fixed' });

            // Act
            expect( fn( 'fixed', '', ctx )).toBe( 'fixed' );

            // Assert
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            fn( 'other', '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toContain( 'Const' );
        });

        it( 'should throw when $ref target is missing', () => 
        {
            // Arrange
            const schema = { $ref : '#/$defs/Missing' };

            // Act / Assert
            expect(() => getOrCompileSchema( schema )( 1, '', ctx )).toThrow( /Schema reference not found/ );
        });
    });

    describe( 'array and string schema options', () => 
    {
        it( 'should enforce tuple items, minItems, maxItems, and uniqueItems', () => 
        {
            // Arrange
            const tupleFn = getOrCompileSchema({
                type  : 'array',
                items : [{ type : 'string' }, { type : 'number' }]
            });

            // Act
            expect( tupleFn(['a', 1], '', ctx )).toEqual(['a', 1]);
            expect( ctx.success ).toBe( true );

            // Arrange
            const listFn = getOrCompileSchema({
                type        : 'array',
                items       : { type : 'number' },
                minItems    : 2,
                maxItems    : 3,
                uniqueItems : true
            });
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            listFn([1], '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            listFn([1, 1], '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
        });

        it( 'should apply string pattern and format constraints from schema', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({
                type    : 'string',
                pattern : '^web_',
                format  : 'email'
            });

            // Act
            fn( 'not-email', '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
        });

        it( 'should enforce string maxLength from schema', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({
                type      : 'string',
                maxLength : 3
            });

            // Act
            fn( 'abcd', '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'MaxLength<3>' );
        });

        it( 'should enforce number maximum and multipleOf from schema', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({
                type       : 'number',
                maximum    : 10,
                multipleOf : 2
            });

            // Act
            fn( 11, '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors.some( e => e.error === 'Maximum<10>' )).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            fn( 9, '', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors.some( e => e.error === 'MultipleOf<2>' )).toBe( true );
        });

        it( 'should short-circuit string and number schemas on nullish values', () => 
        {
            // Arrange
            const stringFn = getOrCompileSchema({
                type      : 'string',
                maxLength : 1
            });
            const numberFn = getOrCompileSchema({
                type    : 'number',
                maximum : 1
            });

            // Act — failed type check still returns the nullish input and skips constraints
            const s = stringFn( null, '', ctx );

            // Assert
            expect( s ).toBeNull();
            expect( ctx.errors.some( e => e.error === 'MaxLength<1>' )).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            const n = numberFn( undefined, '', ctx );

            // Assert
            expect( n ).toBeUndefined();
            expect( ctx.errors.some( e => e.error === 'Maximum<1>' )).toBe( false );
        });

        it( 'should throw when compiling a non-object schema', () => 
        {
            // Act / Assert
            expect(() => getOrCompileSchema( null )).toThrow( /Invalid JSON Schema/ );
            expect(() => getOrCompileSchema( 'string' as unknown as object )).toThrow( /Invalid JSON Schema/ );
        });

        it( 'should replace allOf data when a member returns a non-object', () => 
        {
            // Arrange
            const fn = getOrCompileSchema({
                allOf : [
                    { type : 'string' },
                    { type : 'string', minLength : 1 }
                ]
            });

            // Act
            const result = fn( 'hi', '', ctx );

            // Assert
            expect( result ).toBe( 'hi' );
            expect( ctx.success ).toBe( true );
        });
    });
});
