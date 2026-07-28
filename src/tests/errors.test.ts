import { describe, it, expect } from 'vitest';
import 
{ 
    validators, ValidationContext, toZodIssues, 
    ZodLikeError, groupErrorsByPath 
} 
from '../runtime/validators.js';

describe( 'Error Reporting Unit Tests', () => 
{
    const createCtx = ( mode: any = 'relaxed' ): ValidationContext => ({
        success : true,
        errors  : [],
        mode
    });

    it( 'should report multiple sibling errors in objects', () => 
    {
        const ctx = createCtx();
        const v = { name : 123, age : 'abc' };
        
        // Mocking a generated validator for { name: string, age: number }
        validators.props( v, v, 'user', ctx, [
            ['name', false, validators.string],
            ['age', false, validators.number]
        ]);

        expect( ctx.success ).toBe( false );
        expect( ctx.errors ).toHaveLength( 2 );
        expect( ctx.errors[0]).toEqual({ path : 'user.name', error : 'Type<string>', value : 123 });
        expect( ctx.errors[1]).toEqual({ path : 'user.age', error : 'Type<number>', value : 'abc' });
    });

    it( 'should resolve nested paths correctly', () => 
    {
        const ctx = createCtx();
        const v = { info : { address : { street : 123 } } };
        
        const addressValidator = ( v: any, path: string, ctx: any ) => 
        {
            const obj = validators.object( v, path, ctx );

            if( obj === false ){ return v }
            validators.props( obj, obj, path, ctx, [['street', false, validators.string]]);

            return obj;
        };

        const infoValidator = ( v: any, path: string, ctx: any ) => 
        {
            const obj = validators.object( v, path, ctx );

            if( obj === false ){ return v }
            validators.props( obj, obj, path, ctx, [['address', false, addressValidator]]);

            return obj;
        };

        validators.props( v, v, 'root', ctx, [['info', false, infoValidator]]);

        expect( ctx.success ).toBe( false );
        expect( ctx.errors[0].path ).toBe( 'root.info.address.street' );
        expect( ctx.errors[0].error ).toBe( 'Type<string>' );
        expect( ctx.errors[0].value ).toBe( 123 );
    });

    it( 'should nest branch failures under a single union error', () => 
    {
        const ctx = createCtx();
        const v = true;
        
        // Union of string | number
        validators.union( v, 'val', ctx, [validators.string, validators.number]);

        expect( ctx.success ).toBe( false );
        expect( ctx.errors ).toHaveLength( 1 );
        expect( ctx.errors[0].error ).toBe( 'Type<Union>' );
        expect( ctx.errors[0].path ).toBe( 'val' );
        expect( ctx.errors[0].value ).toBe( true );
        expect( ctx.errors[0].issues ).toEqual([
            { path : 'val', error : 'Type<string>', value : true },
            { path : 'val', error : 'Type<number>', value : true }
        ]);
    });

    it( 'should report multiple errors in arrays', () => 
    {
        const ctx = createCtx();
        const v = ['a', 1, 'b', 2];
        
        // Array of strings
        validators.array( v, 'tags', ctx, validators.string );

        expect( ctx.success ).toBe( false );
        expect( ctx.errors ).toHaveLength( 2 );
        expect( ctx.errors[0].path ).toBe( 'tags[1]' );
        expect( ctx.errors[1].path ).toBe( 'tags[3]' );
    });

    it( 'should report unknown properties in strict mode', () => 
    {
        const ctx = createCtx( 'strict' );
        const v = { name : 'John', extra : 'bad' };
        
        validators.object( v, 'user', ctx, ['name']);

        expect( ctx.success ).toBe( false );
        expect( ctx.errors[0]).toEqual({
            path  : 'user',
            error : 'PropertyNotAllowed<extra>',
            value : 'bad'
        });
    });

    it( 'should stop at depth if parent type is wrong', () => 
    {
        const ctx = createCtx();
        const v = { info : 'not-an-object' };
        
        const infoValidator = ( v: any, path: string, ctx: any ) => 
        {
            const obj = validators.object( v, path, ctx );

            if( obj === false ){ return v } // Should exit here
            validators.props( obj, obj, path, ctx, [['first', false, validators.string]]);

            return obj;
        };

        validators.props( v, v, 'root', ctx, [['info', false, infoValidator]]);

        expect( ctx.success ).toBe( false );
        expect( ctx.errors ).toHaveLength( 1 );
        expect( ctx.errors[0].path ).toBe( 'root.info' );
        expect( ctx.errors[0].error ).toBe( 'Type<Object>' );
    });

    describe( 'toZodIssues & ZodLikeError', () => 
    {
        it( 'should map validation errors to zod-like issues', () => 
        {
            // Arrange
            const errors = 
            [
                { path : 'user.name', error : 'Type<string>', value : 123 },
                { path : 'items[0].id', error : 'Type<number>', value : 'abc' }
            ];

            // Act
            const issues = toZodIssues( errors );

            // Assert
            expect( issues ).toHaveLength( 2 );

            const expectedFirst = 
            {
                code     : 'custom',
                path     : ['user', 'name'],
                message  : 'Type<string>',
                received : 123
            };

            const expectedSecond = 
            {
                code     : 'custom',
                path     : ['items', 0, 'id'],
                message  : 'Type<number>',
                received : 'abc'
            };

            expect( issues[0]).toEqual( expectedFirst );
            expect( issues[1]).toEqual( expectedSecond );
        });

        it( 'should keep a numeric-looking object key as a string', () =>
        {
            // Arrange: a record key of "0" is an object key, not an array index.
            const errors = [{ path : 'counts.0', error : 'Type<number>', value : 'abc' }];

            // Act
            const issues = toZodIssues( errors );

            // Assert
            expect( issues[0].path ).toEqual(['counts', '0']);
        });

        it( 'should keep a bracketed map key as one segment', () =>
        {
            // Arrange
            const errors = [{ path : 'm[some-key]', error : 'Type<number>', value : 'abc' }];

            // Act
            const issues = toZodIssues( errors );

            // Assert
            expect( issues[0].path ).toEqual(['m', 'some-key']);
        });

        it( 'should report unquoted map key and value paths', () =>
        {
            // Arrange
            const ctx = createCtx( 'strict' );
            const map = new Map<any, any>([['a', 'not-a-number']]);

            // Act
            validators.map( map, 'm', ctx, validators.string, validators.number );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].path ).toBe( 'm[a]' );
            expect( toZodIssues( ctx.errors )[0].path ).toEqual(['m', 'a']);
        });

        it( 'should construct ZodLikeError with zod-like issues', () => 
        {
            // Arrange
            const errors = 
            [
                { path : 'user.name', error : 'Type<string>', value : 123 }
            ];

            // Act
            const err = new ZodLikeError( errors );

            // Assert
            expect( err.name ).toBe( 'ZodError' );
            expect( err.message ).toBe( 'Validation failed' );
            expect( err.issues ).toHaveLength( 1 );
            expect( err.issues[0].path ).toEqual(['user', 'name']);
        });

        it( 'should flatten nested union issues for Zod', () => 
        {
            // Arrange
            const errors = 
            [
                {
                    path   : 'val',
                    error  : 'Type<Union>',
                    value  : true,
                    issues : [
                        { path : 'val', error : 'Type<string>', value : true },
                        { path : 'val', error : 'Type<number>', value : true }
                    ]
                }
            ];

            // Act
            const issues = toZodIssues( errors );

            // Assert
            expect( issues ).toHaveLength( 3 );
            expect( issues.map( i => i.message )).toEqual([
                'Type<Union>',
                'Type<string>',
                'Type<number>'
            ]);
        });
    });

    describe( 'groupErrorsByPath', () => 
    {
        it( 'should group validation errors by path', () => 
        {
            // Arrange
            const errors = 
            [
                { path : 'user.name', error : 'Type<string>', value : 123 },
                { path : 'user.name', error : 'MinLength<3>', value : 123 },
                { path : 'user.age', error : 'Type<number>', value : 'abc' }
            ];

            // Act
            const grouped = groupErrorsByPath( errors );

            // Assert
            const expectedGrouped = 
            {
                'user.name' : 
                {
                    value  : 123,
                    errors : ['Type<string>', 'MinLength<3>']
                },
                'user.age' : 
                {
                    value  : 'abc',
                    errors : ['Type<number>']
                }
            };

            expect( grouped ).toEqual( expectedGrouped );
        });
    });
});
