import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 
{
    validators,
    MetadataStore,
    groupErrorsByPath,
    toZodIssues,
    coerceJsonDate,
    type ValidationContext
} 
from '../runtime/validators.js';

describe( 'validators uncovered branches', () => 
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

    describe( 'plain-object guards', () => 
    {
        it( 'should reject Buffer and ArrayBuffer views as objects', () => 
        {
            // Arrange / Act / Assert
            expect( validators.object( Buffer.from( 'x' ), 'b', ctx )).toBe( false );
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act / Assert
            expect( validators.object( new Uint8Array([1]), 'u', ctx )).toBe( false );
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act / Assert
            expect( validators.object( new ArrayBuffer( 4 ), 'a', ctx )).toBe( false );
            expect( ctx.success ).toBe( false );
        });

        it( 'should accept null-prototype plain objects', () => 
        {
            // Arrange
            const input = Object.create( null );
            input.id = 1;

            // Act
            const result = validators.object( input, 'o', ctx );

            // Assert
            expect( result ).toBe( input );
            expect( ctx.success ).toBe( true );
        });
    });

    describe( 'custom from on containers and primitives', () => 
    {
        it( 'should revive strings and arrays via custom from with path keys', () => 
        {
            // Arrange
            const from = vi.fn(( value: unknown, c: { key : string, kind : string }) => 
            {
                if( c.kind === 'string' && typeof value === 'number' ){ return String( value ) }

                if( c.kind === 'Array' && value && typeof value === 'object' && 'items' in ( value as object ))
                {
                    return ( value as { items : unknown[] }).items;
                }

                return value;
            });
            ctx.from = from;

            // Act
            const str = validators.string( 42, 'user.age', ctx );

            // Assert
            expect( str ).toBe( '42' );
            expect( from ).toHaveBeenCalledWith( 42, expect.objectContaining({
                key  : 'age',
                path : 'user.age',
                kind : 'string'
            }));

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict', from };

            // Act
            const arr = validators.array({ items : [1, 2] }, 'rows[0]', ctx, validators.number );

            // Assert
            expect( arr ).toEqual([1, 2]);
            expect( from ).toHaveBeenCalledWith({ items : [1, 2] }, expect.objectContaining({
                key   : 'rows',
                path  : 'rows[0]',
                index : 0,
                kind  : 'Array'
            }));
        });

        it( 'should report when custom from fails for array and tuple', () => 
        {
            // Arrange
            ctx.from = () => 'nope';

            // Act
            validators.array( 1, 'a', ctx, validators.number );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<Array>' );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict', from : () => [1] };

            // Act
            validators.tuple([1], 't', ctx, [validators.string, validators.number]);

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Tuple<2>' );
        });

        it( 'should revive tuples, records, sets, and maps via custom from', () => 
        {
            // Arrange
            ctx.from = ( value, c ) => 
            {
                if( c.kind === 'tuple' ){ return ['a', 1] }

                if( c.kind === 'Object' && value instanceof Map ){ return Object.fromEntries( value ) }

                if( c.kind === 'Set' ){ return new Set([1, 2]) }

                if( c.kind === 'Map' ){ return new Map([['k', 1]]) }

                return value;
            };

            // Act / Assert
            expect( validators.tuple( null, 't', ctx, [validators.string, validators.number])).toEqual(['a', 1]);
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict', from : ctx.from };

            // Act / Assert
            expect( validators.record( new Map([['a', 1]]), 'r', ctx, validators.number )).toEqual({ a : 1 });

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict', from : ctx.from };

            // Act / Assert
            expect([ ...validators.set( 'x', 's', ctx, validators.number )]).toEqual([1, 2]);

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict', from : ctx.from };

            // Act / Assert
            expect( validators.map( 1, 'm', ctx, validators.string, validators.number ).get( 'k' )).toBe( 1 );
        });

        it( 'should call custom from for never and instanceOf', () => 
        {
            // Arrange
            const from = vi.fn(() => undefined );
            ctx.from = from;

            // Act
            validators.never( 1, 'n', ctx );

            // Assert
            expect( from ).toHaveBeenCalledWith( 1, expect.objectContaining({
                key  : 'n',
                path : 'n',
                kind : 'never'
            }));
            expect( ctx.success ).toBe( false );

            // Arrange
            const date = new Date();
            ctx = {
                success : true,
                errors  : [],
                mode    : 'strict',
                from    : ( _v, c ) => c.kind === 'instance' ? date : _v
            };

            // Act
            const revived = validators.instanceOf( 'x', 'd', ctx, 'Date' );

            // Assert
            expect( revived ).toBe( date );
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            validators.instanceOf( {}, 'x', ctx, 'NotAGlobalCtor' );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<NotAGlobalCtor>' );
        });
    });

    describe( 'constraint edge branches', () => 
    {
        it( 'should handle global/sticky patterns without mutating lastIndex', () => 
        {
            // Arrange
            const regex = /ab/g;
            regex.lastIndex = 2;

            // Act
            const result = validators.pattern( 'ab', 'p', ctx, regex, 'Pattern<ab>' );

            // Assert
            expect( result ).toBe( 'ab' );
            expect( ctx.success ).toBe( true );
            expect( regex.lastIndex ).toBe( 2 );
        });

        it( 'should reject multipleOf zero and accept Infinity as multiple', () => 
        {
            // Arrange / Act
            validators.multipleOf( 10, 'm', ctx, 0 );

            // Assert
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            expect( validators.multipleOf( Infinity, 'm', ctx, 3 )).toBe( Infinity );

            // Assert
            expect( ctx.success ).toBe( true );
        });

        it( 'should detect circular structures in uniqueItems via stable stringify', () => 
        {
            // Arrange
            const a: Record<string, unknown> = {};
            a.self = a;
            const b: Record<string, unknown> = {};
            b.self = b;

            // Act
            validators.uniqueItems([a, b], 'u', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
        });
    });

    describe( 'shells and additionalProps', () => 
    {
        it( 'should leave non-plain values unchanged in objectShell', () => 
        {
            // Arrange
            const date = new Date();

            // Act / Assert
            expect( validators.objectShell( date, ctx )).toBe( date );

            // Arrange
            ctx.mode = 'strip';
            const input = { a : 1 };

            // Act
            const stripped = validators.objectShell( input, ctx );

            // Assert
            expect( stripped ).toEqual({});
            expect( stripped ).not.toBe( input );
        });

        it( 'should validate unknown keys through additionalProps', () => 
        {
            // Arrange
            const input = { id : 1, tag : 'x' };
            const data: Record<string, unknown> = { id : 1 };

            // Act
            validators.additionalProps( input, data, 'row', ctx, ['id'], validators.string );

            // Assert
            expect( data.tag ).toBe( 'x' );
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };
            const bad: Record<string, unknown> = { id : 1 };

            // Act
            validators.additionalProps( input, bad, 'row', ctx, ['id'], validators.number );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].path ).toBe( 'row.tag' );
        });

        it( 'should no-op stripExtras unless mutate strip with keys', () => 
        {
            // Arrange
            const data = { a : 1, b : 2 };

            // Act / Assert
            expect( validators.stripExtras( data, ctx, ['a'])).toEqual({ a : 1, b : 2 });

            // Arrange
            ctx.mutate = true;
            ctx.mode = 'strip';

            // Act
            const stripped = validators.stripExtras( data, ctx, ['a']);

            // Assert
            expect( stripped ).toEqual({ a : 1 });
            expect( data.b ).toBeUndefined();
        });
    });

    describe( 'union conversion pass and nested error helpers', () => 
    {
        it( 'should succeed on union pass-2 when from enables coercion', () => 
        {
            // Arrange
            ctx.from = 'query';

            // Act
            const result = validators.union( '9', 'u', ctx, [validators.number]);

            // Assert
            expect( result ).toBe( 9 );
            expect( ctx.success ).toBe( true );
        });

        it( 'should flatten nested union issues in groupErrorsByPath and toZodIssues', () => 
        {
            // Arrange
            const errors = 
            [
                {
                    path   : 'u',
                    error  : 'Type<Union>',
                    value  : false,
                    issues : [
                        { path : 'u', error : 'Type<string>', value : false },
                        { path : 'u', error : 'Type<number>', value : false }
                    ]
                }
            ];

            // Act
            const grouped = groupErrorsByPath( errors );
            const zod = toZodIssues( errors );

            // Assert
            expect( grouped.u.errors ).toEqual([
                'Type<Union>',
                'Type<string>',
                'Type<number>'
            ]);
            expect( zod ).toHaveLength( 3 );
        });
    });

    describe( 'json date helper', () => 
    {
        it( 'should revive ISO strings and leave invalid values unchanged', () => 
        {
            // Arrange
            const iso = '2024-06-01T00:00:00.000Z';

            // Act
            const date = coerceJsonDate( iso );

            // Assert
            expect( date ).toBeInstanceOf( Date );
            expect(( date as Date ).toISOString()).toBe( iso );
            expect( coerceJsonDate( 'nope' )).toBe( 'nope' );
            expect( coerceJsonDate( 123 )).toBe( 123 );
        });
    });

    describe( 'MetadataStore option plumbing', () => 
    {
        it( 'should thread from through validate, assert, and in-place is; reject root rewrite on is', () => 
        {
            // Arrange
            const numberOnly = validators.number;

            // Act / Assert
            expect( MetadataStore.is( numberOnly, '1', { from : 'query' })).toBe( false );
            expect( MetadataStore.validate( numberOnly, '1', { from : 'query' }).data ).toBe( 1 );
            expect( MetadataStore.assert( numberOnly, '1', { from : 'query' })).toBe( 1 );
        });

        it( 'should use errorFactory for assert and assertGuard failures', () => 
        {
            // Arrange
            const factory = vi.fn(() => new Error( 'custom-fail' ));

            // Act / Assert
            expect(() => MetadataStore.assert( validators.string, 1, { errorFactory : factory })).toThrow( 'custom-fail' );
            expect( factory ).toHaveBeenCalled();

            // Arrange
            factory.mockClear();

            // Act / Assert
            expect(() => MetadataStore.assertGuard( validators.string, 1, { errorFactory : factory })).toThrow( 'custom-fail' );
        });
    });
});
