import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validators, coerceQueryBoolean, coerceQueryDate, coerceJsonDate, type ValidationContext, is, assert, assertGuard, validate } from '../src/runtime/validators.js';

describe( 'validators coverage edges', () => 
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

    describe( 'coerce helpers early returns', () => 
    {
        it( 'should pass through booleans and valid Date instances', () => 
        {
            // Arrange
            const date = new Date( '2024-01-01T00:00:00.000Z' );

            // Act / Assert
            expect( coerceQueryBoolean( true )).toBe( true );
            expect( coerceQueryBoolean( false )).toBe( false );
            expect( coerceJsonDate( date )).toBe( date );
            expect( coerceQueryDate( date )).toBe( date );
        });
    });

    describe( 'email and idn-email rejection branches', () => 
    {
        it( 'should reject emails over 254 characters', () => 
        {
            // Arrange
            const overlong = `${'a'.repeat( 64 )}@${'b'.repeat( 190 )}.com`;

            // Act
            validators.format( overlong, 'e', ctx, 'email' );

            // Assert
            expect( overlong.length ).toBeGreaterThan( 254 );
            expect( ctx.success ).toBe( false );
        });

        it( 'should reject local parts longer than 64 and invalid local chars', () => 
        {
            // Arrange
            const longLocal = `${'a'.repeat( 65 )}@example.com`;

            // Act
            validators.format( longLocal, 'e', ctx, 'email' );

            // Assert
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            validators.format( 'bad space@example.com', 'e', ctx, 'email' );

            // Assert
            expect( ctx.success ).toBe( false );
        });

        it( 'should reject idn-email length and structure failures', () => 
        {
            // Arrange
            const overlong = `${'用'.repeat( 250 )}@例子.广告`;
            const badAt = '@例子.广告';
            const longLocal = `${'用'.repeat( 65 )}@例子.广告`;
            const dotted = '.用户@例子.广告';
            const badChar = '用户(x)@例子.广告';

            // Act / Assert
            expect( overlong.length ).toBeGreaterThan( 254 );
            validators.format( overlong, 'e', ctx, 'idn-email' );
            expect( ctx.success ).toBe( false );

            ctx = { success : true, errors : [], mode : 'strict' };
            validators.format( badAt, 'e', ctx, 'idn-email' );
            expect( ctx.success ).toBe( false );

            ctx = { success : true, errors : [], mode : 'strict' };
            validators.format( longLocal, 'e', ctx, 'idn-email' );
            expect( ctx.success ).toBe( false );

            ctx = { success : true, errors : [], mode : 'strict' };
            validators.format( dotted, 'e', ctx, 'idn-email' );
            expect( ctx.success ).toBe( false );

            ctx = { success : true, errors : [], mode : 'strict' };
            validators.format( badChar, 'e', ctx, 'idn-email' );
            expect( ctx.success ).toBe( false );
        });
    });

    describe( 'uri / iri / template format branches', () => 
    {
        it( 'should accept empty uri-reference and iri-reference', () => 
        {
            // Act
            expect( validators.format( '', 'u', ctx, 'uri-reference' )).toBe( '' );
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            expect( validators.format( '', 'i', ctx, 'iri-reference' )).toBe( '' );
            expect( ctx.success ).toBe( true );
        });

        it( 'should accept urn-style uris that URL constructor rejects', () => 
        {
            // Arrange — matches URI_RE but throws in URL(); fallback regex accepts
            const opaque = 'http://';

            // Act
            const result = validators.format( opaque, 'u', ctx, 'uri' );

            // Assert
            expect( result ).toBe( opaque );
            expect( ctx.success ).toBe( true );
        });

        it( 'should accept absolute uris and iris as references', () => 
        {
            // Act
            expect( validators.format( 'https://example.com/a', 'u', ctx, 'uri-reference' )).toBe( 'https://example.com/a' );
            expect( ctx.success ).toBe( true );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            expect( validators.format( 'https://例え.jp/path', 'i', ctx, 'iri-reference' )).toBe( 'https://例え.jp/path' );
            expect( ctx.success ).toBe( true );
        });

        it( 'should reject uri-reference values that neither parse as URI nor relative URL', () => 
        {
            // Arrange
            const bad = '//[';

            // Act
            validators.format( bad, 'u', ctx, 'uri-reference' );

            // Assert
            expect( ctx.success ).toBe( false );
        });

        it( 'should accept iri schemes that URL constructor rejects via fallback', () => 
        {
            // Arrange
            const iri = 'http://';

            // Act
            const result = validators.format( iri, 'i', ctx, 'iri' );

            // Assert
            expect( result ).toBe( iri );
            expect( ctx.success ).toBe( true );
        });

        it( 'should reject iri values containing control characters', () => 
        {
            // Arrange
            const withNull = 'https://example.com/\u0000path';

            // Act
            validators.format( withNull, 'i', ctx, 'iri' );

            // Assert
            expect( ctx.success ).toBe( false );
        });

        it( 'should reject invalid calendar dates that match YYYY-MM-DD shape', () => 
        {
            // Arrange
            const invalid = '2024-13-01';

            // Act
            validators.format( invalid, 'd', ctx, 'date' );

            // Assert
            expect( ctx.success ).toBe( false );
        });

        it( 'should accept iri-reference fallbacks when relative URL parsing throws', () => 
        {
            // Arrange
            const value = '//[';

            // Act
            const result = validators.format( value, 'i', ctx, 'iri-reference' );

            // Assert
            expect( result ).toBe( value );
            expect( ctx.success ).toBe( true );
        });

        it( 'should reject uri-template with unmatched closing brace', () => 
        {
            // Arrange
            const bad = 'https://example.com/users}/id';

            // Act
            validators.format( bad, 't', ctx, 'uri-template' );

            // Assert
            expect( ctx.success ).toBe( false );
        });

        it( 'should reject empty and whitespace uri-template values', () => 
        {
            // Act
            validators.format( '', 't', ctx, 'uri-template' );

            // Assert
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict' };

            // Act
            validators.format( 'has space', 't', ctx, 'uri-template' );

            // Assert
            expect( ctx.success ).toBe( false );
        });

        it( 'should coerce date and date-time formats under from:query', () => 
        {
            // Arrange
            ctx.from = 'query';

            // Act
            const date = validators.format( '2024-06-01', 'd', ctx, 'date' );
            const dateTime = validators.format( '2024-06-01T12:00:00.000Z', 'dt', ctx, 'date-time' );

            // Assert
            expect( date ).toBeInstanceOf( Date );
            expect( dateTime ).toBeInstanceOf( Date );
            expect( ctx.success ).toBe( true );
        });
    });

    describe( 'custom from for remaining primitives', () => 
    {
        it( 'should revive number bigint boolean regexp null undefined and literal', () => 
        {
            // Arrange
            ctx.from = ( _value, c ) => 
            {
                if( c.kind === 'number' ){ return 7 }

                if( c.kind === 'bigint' ){ return 9n }

                if( c.kind === 'boolean' ){ return true }

                if( c.kind === 'RegExp' ){ return /ok/ }

                if( c.kind === 'null' ){ return null }

                if( c.kind === 'undefined' ){ return undefined }

                if( c.kind === 'literal' ){ return 'fixed' }

                return _value;
            };

            // Act / Assert
            expect( validators.number( 'x', 'n', ctx )).toBe( 7 );
            expect( ctx.success ).toBe( true );

            ctx = { success : true, errors : [], mode : 'strict', from : ctx.from };
            expect( validators.bigint( 'x', 'b', ctx )).toBe( 9n );

            ctx = { success : true, errors : [], mode : 'strict', from : ctx.from };
            expect( validators.boolean( 'x', 'bo', ctx )).toBe( true );

            ctx = { success : true, errors : [], mode : 'strict', from : ctx.from };
            expect( validators.regexp( 'x', 'r', ctx )).toEqual( /ok/ );

            ctx = { success : true, errors : [], mode : 'strict', from : ctx.from };
            expect( validators.null( 'x', 'nl', ctx )).toBeNull();

            ctx = { success : true, errors : [], mode : 'strict', from : ctx.from };
            expect( validators.undefined( 'x', 'u', ctx )).toBeUndefined();

            ctx = { success : true, errors : [], mode : 'strict', from : ctx.from };
            expect( validators.literal( 'x', 'l', ctx, 'fixed' )).toBe( 'fixed' );
        });

        it( 'should report when custom from returns wrong types for containers', () => 
        {
            // Arrange
            ctx.from = () => 'nope';

            // Act
            expect( validators.object( 1, 'o', ctx )).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<Object>' );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict', from : () => 'nope' };

            // Act
            expect( validators.record( 1, 'r', ctx, validators.number )).toBe( 1 );
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict', from : () => 'nope' };

            // Act
            expect( validators.set( 1, 's', ctx, validators.number )).toBe( 1 );
            expect( ctx.success ).toBe( false );

            // Arrange
            ctx = { success : true, errors : [], mode : 'strict', from : () => 'nope' };

            // Act
            expect( validators.map( 1, 'm', ctx, validators.string, validators.number )).toBe( 1 );
            expect( ctx.success ).toBe( false );
        });
    });

    describe( 'instanceOf and uniqueItems array circularity', () => 
    {
        it( 'should accept native Date instances via instanceOf', () => 
        {
            // Arrange
            const date = new Date();

            // Act
            const result = validators.instanceOf( date, 'd', ctx, 'Date' );

            // Assert
            expect( result ).toBe( date );
            expect( ctx.success ).toBe( true );
        });

        it( 'should stringify nested circular arrays in uniqueItems', () => 
        {
            // Arrange
            const a: unknown[] = [];
            a.push( a );
            const b: unknown[] = [];
            b.push( b );

            // Act
            validators.uniqueItems([a, b], 'u', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'UniqueItems' );
        });
    });

    describe( 'requires and custom path tokenization edges', () => 
    {
        it( 'should resolve relative requires and empty/unclosed path segments', () => 
        {
            // Arrange
            const root = { profile : { name : 'tom', password : 'secret' } };
            ctx.root = root;

            // Act
            validators.requires( root.profile.name, 'profile.name', ctx, ['.password']);

            // Assert
            expect( ctx.success ).toBe( true );

            // Arrange — `..` with empty remainder returns the ancestor object
            ctx = {
                success : true,
                errors  : [],
                mode    : 'strict',
                root    : { nested : { value : 1 } }
            };

            // Act
            validators.requires( 1, 'nested.value', ctx, ['..']);

            // Assert
            expect( ctx.success ).toBe( true );

            // Arrange — path starting with '.' is still normalized by tokenizePath (relative-path syntax)
            ctx = { success : true, errors : [], mode : 'strict', root : { items : [1] } };
            const probe = vi.fn(() => true );

            // Act
            validators.custom( 1, '.items[0]', ctx, probe );

            // Assert
            expect( probe ).toHaveBeenCalled();
            expect( ctx.success ).toBe( true );

            // Arrange — unclosed bracket is kept as a raw segment
            ctx = { success : true, errors : [], mode : 'strict', root : { items : [1] } };
            probe.mockClear();

            // Act
            validators.custom( 1, 'items[unclosed', ctx, probe );

            // Assert
            expect( probe ).toHaveBeenCalled();
            expect( ctx.success ).toBe( true );
        });

        it( 'should fail requires when intermediate path value is null', () => 
        {
            // Arrange
            ctx.root = { profile : null };

            // Act
            validators.requires( 'x', 'leaf', ctx, ['profile.name']);

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Requires<profile.name>' );
        });
    });

    describe( 'union pass-2 failure aggregation', () => 
    {
        it( 'should aggregate pass-2 arm errors when from is set but conversion fails', () => 
        {
            // Arrange
            ctx.from = 'json';

            // Act
            validators.union( true, 'u', ctx, [validators.string, validators.number]);

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors ).toHaveLength( 1 );
            expect( ctx.errors[0].issues?.length ).toBeGreaterThan( 0 );
        });
    });

    describe( 'mutate shells, anonymous custom, and validator modes', () => 
    {
        it( 'should mutate arrays and records in place when mutate is true', () => 
        {
            // Arrange
            ctx.mutate = true;
            const rows = [1, 2];
            const record = { a : 1 };

            // Act
            const arr = validators.array( rows, 'rows', ctx, validators.number );
            const rec = validators.record( record, 'rec', ctx, validators.number );

            // Assert
            expect( arr ).toBe( rows );
            expect( rec ).toBe( record );
            expect( ctx.success ).toBe( true );
        });

        it( 'should report anonymous custom failures as Custom', () => 
        {
            // Arrange
            const anon = function () 
            {
                return false;
            };
            Object.defineProperty( anon, 'name', { value : '' });

            // Act
            validators.custom( 1, 'c', ctx, anon );

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Custom' );
        });

        it( 'should emit union errors without issues when no arms are provided', () => 
        {
            // Act
            validators.union( 1, 'u', ctx, []);

            // Assert
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].issues ).toBeUndefined();
        });

        it( 'should revive regexp objects with non-string flags under json from', () => 
        {
            // Arrange
            ctx.from = 'json';

            // Act
            const result = validators.regexp({ source : 'ab', flags : 1 }, 'r', ctx );

            // Assert
            expect( result ).toEqual( /ab/ );
            expect( ctx.success ).toBe( true );
        });

        it( 'should accept string ValidationMode on validator entrypoints', () => 
        {
            // Arrange
            const input = { a : 1, extra : true };
            const fn = ( v: unknown, path: string, c: ValidationContext ) => validators.object( v, path, c, ['a']);

            // Act / Assert
            expect( is( fn, input, 'relaxed' )).toBe( true );
            expect( validate( fn, input, 'relaxed' ).success ).toBe( true );
            expect( assert( fn, input, 'relaxed' )).toEqual( input );
            expect(() => assertGuard( fn, input, 'relaxed' )).not.toThrow();
        });

        it( 'should format assert errors without a path prefix when path is empty', () => 
        {
            // Act / Assert
            expect(() => assert( validators.string, 1 )).toThrow( /Validation Error: Type<string>/ );
            expect(() => assertGuard( validators.string, 1 )).toThrow( /Validation Error: Type<string>/ );
        });

        it( 'should stringify nested arrays in uniqueItems', () => 
        {
            // Arrange
            const left = [1, { a : 1 }];
            const right = [1, { a : 1 }];

            // Act
            validators.uniqueItems([left, right], 'u', ctx );

            // Assert
            expect( ctx.success ).toBe( false );
        });

        it( 'should no-op when additionalProps receives a non-plain value', () => 
        {
            // Arrange
            const data: Record<string, unknown> = {};

            // Act
            validators.additionalProps( null, data, 'row', ctx, [], validators.string );

            // Assert
            expect( data ).toEqual({});
            expect( ctx.success ).toBe( true );
        });

        it( 'should include path prefixes in assertGuard default errors', () => 
        {
            // Arrange
            const fn = ( v: unknown, path: string, c: ValidationContext ) => validators.string( v, 'user.name', c );

            // Act / Assert
            expect(() => assertGuard( fn, 1 )).toThrow( /user\.name: Type<string>/ );
        });
    });
});
