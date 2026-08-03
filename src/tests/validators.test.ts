import { describe, it, expect, beforeEach } from 'vitest';
import { validators, coerceQueryNumber, coerceQueryBoolean, coerceQueryDate, getOrCompileSchema, is, assert, assertGuard, validate } from '../runtime/validators.js';

describe( 'Validators', () => 
{
    let ctx: any;

    beforeEach(() => 
    {
        ctx = { success : true, errors : [], mode : 'strict' };
    });

    describe( 'Query coerce helpers (shared with transform.To*)', () => 
    {
        it( 'coerceQueryNumber matches from:query number acceptance', () => 
        {
            expect( coerceQueryNumber( '42' )).toBe( 42 );
            expect( coerceQueryNumber( ' 3.14 ' )).toBe( 3.14 );
            expect( coerceQueryNumber( '' )).toBe( '' );
            expect( coerceQueryNumber( 'nope' )).toBe( 'nope' );
            expect( coerceQueryNumber( true )).toBe( true );

            ctx.from = 'query';
            expect( validators.number( '42', 'n', ctx )).toBe( 42 );
            expect( assert(
                ( v, path, c ) => validators.number( coerceQueryNumber( v ), path, c ),
                '42'
            )).toBe( 42 );
        });

        it( 'coerceQueryBoolean matches from:query boolean acceptance', () => 
        {
            expect( coerceQueryBoolean( 'true' )).toBe( true );
            expect( coerceQueryBoolean( 'false' )).toBe( false );
            expect( coerceQueryBoolean( 'yes' )).toBe( true );
            expect( coerceQueryBoolean( 'off' )).toBe( false );
            expect( coerceQueryBoolean( 1 )).toBe( true );
            expect( coerceQueryBoolean( 0 )).toBe( false );
            expect( coerceQueryBoolean( 'maybe' )).toBe( 'maybe' );
            expect( coerceQueryBoolean( null )).toBe( null );

            ctx.from = 'query';
            expect( validators.boolean( 'false', 'b', ctx )).toBe( false );
            expect( ctx.success ).toBe( true );

            ctx.success = true;
            ctx.errors = [];
            validators.boolean( 'maybe', 'b', ctx );
            expect( ctx.success ).toBe( false );
        });

        it( 'coerceQueryDate matches from:query date acceptance', () => 
        {
            const iso = '2024-01-15T12:00:00.000Z';
            const fromIso = coerceQueryDate( iso );
            expect( fromIso ).toBeInstanceOf( Date );
            expect( fromIso.toISOString()).toBe( iso );

            const ts = Date.parse( iso );
            const fromTs = coerceQueryDate( ts );
            expect( fromTs ).toBeInstanceOf( Date );
            expect( fromTs.getTime()).toBe( ts );

            expect( coerceQueryDate( 'not-a-date' )).toBe( 'not-a-date' );
            expect( coerceQueryDate({})).toEqual({});
        });
    });

    describe( 'Primitives', () => 
    {
        it( 'should validate strings', () => 
        {
            expect( validators.string( 'hello', 'path', ctx )).toBe( 'hello' );
            expect( ctx.success ).toBe( true );

            validators.string( 123, 'path', ctx );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'path', error : 'Type<string>', value : 123 });
        });

        it( 'should validate numbers (including casting)', () => 
        {
            expect( validators.number( 123, 'path', ctx )).toBe( 123 );
            expect( ctx.success ).toBe( true );

            expect( validators.number( Infinity, 'path', ctx )).toBe( Infinity );
            expect( ctx.success ).toBe( true );

            expect( validators.number( -Infinity, 'path', ctx )).toBe( -Infinity );
            expect( ctx.success ).toBe( true );

            validators.number( NaN, 'path', ctx );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'path', error : 'Type<number>', value : NaN });

            // Without from: 'query', numeric string should fail
            ctx.success = true;
            ctx.errors = [];
            validators.number( '123', 'path', ctx );
            expect( ctx.success ).toBe( false );

            // With from: 'query', numeric string should now pass and return a number
            ctx.success = true;
            ctx.errors = [];
            ctx.from = 'query';
            expect( validators.number( '123', 'path', ctx )).toBe( 123 );
            expect( ctx.success ).toBe( true );

            // from: 'string' shares the same scalar coercions
            ctx.success = true;
            ctx.errors = [];
            ctx.from = 'string';
            expect( validators.number( '456', 'path', ctx )).toBe( 456 );
            expect( ctx.success ).toBe( true );

            ctx.success = true;
            ctx.errors = [];
            validators.number( 'not-a-number', 'path', ctx );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'path', error : 'Type<number>', value : 'not-a-number' });
        });

        it( 'should validate booleans (including casting)', () => 
        {
            expect( validators.boolean( true, 'path', ctx )).toBe( true );
            expect( ctx.success ).toBe( true );

            // Without from: 'query', boolean string should fail
            validators.boolean( 'true', 'path', ctx );
            expect( ctx.success ).toBe( false );

            // With from: 'query', boolean string should pass and cast
            ctx.success = true;
            ctx.errors = [];
            ctx.from = 'query';
            expect( validators.boolean( 'true', 'path', ctx )).toBe( true );
            expect( validators.boolean( 'false', 'path', ctx )).toBe( false );
            expect( ctx.success ).toBe( true );

            ctx.success = true;
            ctx.errors = [];
            validators.boolean( 'not-a-bool', 'path', ctx );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'path', error : 'Type<boolean>', value : 'not-a-bool' });

            // null/undefined must not coerce to false
            ctx.success = true;
            ctx.errors = [];
            validators.boolean( null, 'path', ctx );
            expect( ctx.success ).toBe( false );
            ctx.success = true;
            ctx.errors = [];
            validators.boolean( undefined, 'path', ctx );
            expect( ctx.success ).toBe( false );
        });

        it( 'should validate dates', () => 
        {
            const now = new Date();
            expect( validators.date( now, 'path', ctx )).toBe( now );
            
            // Without from, ISO string must fail
            const iso = now.toISOString();
            validators.date( iso, 'path', ctx );
            expect( ctx.success ).toBe( false );

            // from: 'json' revives ISO strings
            ctx.success = true;
            ctx.errors = [];
            ctx.from = 'json';
            const parsed = validators.date( iso, 'path', ctx );
            expect( parsed ).toBeInstanceOf( Date );
            expect( parsed.getTime()).toBe( now.getTime());
            expect( ctx.success ).toBe( true );

            // Numeric timestamps require from: 'query'
            delete ctx.from;
            ctx.success = true;
            ctx.errors = [];
            validators.date( now.getTime(), 'path', ctx );
            expect( ctx.success ).toBe( false );

            ctx.from = 'json';
            ctx.success = true;
            ctx.errors = [];
            validators.date( now.getTime(), 'path', ctx );
            expect( ctx.success ).toBe( false );

            ctx.from = 'query';
            ctx.success = true;
            ctx.errors = [];
            const fromTs = validators.date( now.getTime(), 'path', ctx );
            expect( fromTs ).toBeInstanceOf( Date );
            expect( fromTs.getTime()).toBe( now.getTime());

            delete ctx.from;
            ctx.success = true;
            ctx.errors = [];
            validators.date( 'invalid', 'path', ctx );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'path', error : 'Type<Date>', value : 'invalid' });
        });

        it( 'should validate functions', () => 
        {
            const fn = () => 1;
            expect( validators.function( fn, 'path', ctx )).toBe( fn );
            expect( ctx.success ).toBe( true );

            validators.function( 'not-a-fn', 'path', ctx );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<function>' );

            ctx.success = true;
            ctx.errors = [];
            ctx.from = () => fn;
            expect( validators.function( 'not-a-fn', 'path', ctx )).toBe( fn );
            expect( ctx.success ).toBe( true );
        });

        it( 'should validate symbols with custom from', () => 
        {
            const sym = Symbol( 'x' );
            expect( validators.symbol( sym, 'path', ctx )).toBe( sym );

            validators.symbol( 'x', 'path', ctx );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            ctx.from = () => sym;
            expect( validators.symbol( 'x', 'path', ctx )).toBe( sym );
            expect( ctx.success ).toBe( true );
        });

        it( 'should not revive Date into Map under from json', () => 
        {
            ctx.from = 'json';
            validators.map( new Date(), 'm', ctx, validators.string, validators.number );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<Map>' );
        });

        it( 'should validate null and undefined', () => 
        {
            expect( validators.null( null, 'path', ctx )).toBe( null );
            expect( validators.undefined( undefined, 'path', ctx )).toBe( undefined );
            
            validators.null( undefined, 'path', ctx );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            validators.undefined( null, 'path', ctx );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'path', error : 'Type<undefined>', value : null });
        });

        it( 'should validate literals', () => 
        {
            expect( validators.literal( 'A', 'path', ctx, 'A' )).toBe( 'A' );
            
            validators.literal( 'A', 'path', ctx, 'B' );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'path', error : "Literal<'B'>", value : 'A' });
        });
    });

    describe( 'Structural', () => 
    {
        it( 'should validate arrays', () => 
        {
            const input = [1, 2, 3];
            const result = validators.array( input, 'arr', ctx, validators.number );
            expect( result ).toEqual( input );
            expect( ctx.success ).toBe( true );

            // Test non-array input
            validators.array( 'not-an-array', 'arr', ctx, validators.number );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'arr', error : 'Type<Array>', value : 'not-an-array' });

            // Test child validator failure
            ctx.success = true;
            ctx.errors = [];
            validators.array([1, 'not-a-number'], 'arr', ctx, validators.number );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'arr[1]', error : 'Type<number>', value : 'not-a-number' });
        });

        it( 'should validate arrays (strip mode)', () => 
        {
            ctx.mode = 'strip';
            const input = [1, 2, 3];
            const result = validators.array( input, 'arr', ctx, validators.number );
            expect( result ).toEqual( input );
            expect( result ).not.toBe( input ); // Should be a copy
        });

        it( 'should validate records', () => 
        {
            const input = { a : 1, b : 2 };
            const result = ( validators as any ).record( input, 'rec', ctx, validators.number );
            expect( result ).toEqual( input );
            expect( ctx.success ).toBe( true );
        });

        it( 'should validate base objects', () => 
        {
            const input = { a : 1 };
            expect( validators.object( input, 'obj', ctx )).toBe( input );
            
            expect( validators.object( null, 'obj', ctx )).toBe( false );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            expect( validators.object( 'not-an-obj', 'obj', ctx )).toBe( false );
            expect( ctx.success ).toBe( false );
        });

        it( 'should revive objects via custom from', () => 
        {
            ctx.from = ( value, c ) => 
            {
                if( c.kind === 'Object' && value instanceof Map )
                {
                    return Object.fromEntries( value );
                }

                return value;
            };

            const revived = validators.object( new Map([['id', 1]]), 'obj', ctx, ['id']);
            expect( revived ).toEqual({ id : 1 });
            expect( ctx.success ).toBe( true );
        });

        it( 'should validate props (strict mode)', () => 
        {
            const input = { id : 1, name : 'Test', extra : 'bad' };
            
            // Check base object first (strict mode should catch 'extra')
            expect( validators.object( input, 'user', ctx, ['id', 'name'])).toBe( input );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'user', error : 'PropertyNotAllowed<extra>', value : 'bad' });

            // Test missing required prop
            ctx.success = true;
            ctx.errors = [];
            validators.props({ id : 1 }, {}, 'user', ctx, [
                ['id', false, validators.number],
                ['name', false, validators.string]
            ]);
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'user.name', error : 'Type<string>', value : undefined });
        });

        it( 'should validate props (optional)', () => 
        {
            const input = { id : 1 };
            const data = {};
            validators.props( input, data, 'user', ctx, [
                ['id', false, validators.number],
                ['email', true, validators.string] // Optional missing
            ]);
            expect( ctx.success ).toBe( true );
        });

        it( 'should not revive success after a required prop failure when a later optional is missing', () => 
        {
            const input = { a : 'bad' };
            const data = {};

            validators.props( input, data, 'obj', ctx, [
                ['a', false, validators.number],
                ['b', true, validators.string]
            ]);

            expect( ctx.success ).toBe( false );
            expect( ctx.errors.some( e => e.path === 'obj.a' )).toBe( true );
        });

        it( 'should reject exotic objects for object and record', () => 
        {
            expect( validators.object( new Date(), 'obj', ctx )).toBe( false );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            expect( validators.object( new Map(), 'obj', ctx )).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            validators.record( new Set(), 'rec', ctx, validators.number );
            expect( ctx.success ).toBe( false );
        });

        it( 'should accept class instances as record-like object inputs', () =>
        {
            class Foo { x = 1 }

            const input = new Foo();
            const result = validators.object( input, 'obj', ctx );

            expect( result ).toBe( input );
            expect( ctx.success ).toBe( true );
        });

        it( 'should accept process.env as an object input', () =>
        {
            process.env.__TC_PLAIN_OBJECT_PROBE = '1';
            ctx.mode = 'strip';

            try
            {
                const result = validators.object( process.env, 'env', ctx );

                expect( result ).toBe( process.env );
                expect( ctx.success ).toBe( true );

                const data: any = {};
                validators.props( process.env, data, 'env', ctx, [
                    ['__TC_PLAIN_OBJECT_PROBE', false, validators.string]
                ]);

                expect( data.__TC_PLAIN_OBJECT_PROBE ).toBe( '1' );
            }
            finally
            {
                delete process.env.__TC_PLAIN_OBJECT_PROBE;
            }
        });

        it( 'should strip own function properties under mode strip', () =>
        {
            ctx.mode = 'strip';
            const input = {
                id   : 1,
                save : () => 'nope'
            };
            const data: any = validators.objectShell( input, ctx, true );

            validators.props( input, data, 'o', ctx, [['id', false, validators.number]]);
            validators.stripExtras( data, ctx, ['id']);

            expect( ctx.success ).toBe( true );
            expect( data ).toEqual({ id : 1 });
            expect( 'save' in data ).toBe( false );
        });

        it( 'should reject own function properties under mode strict', () =>
        {
            ctx.mode = 'strict';
            const input = {
                id   : 1,
                save : () => 'nope'
            };

            validators.object( input, 'o', ctx, ['id']);

            expect( ctx.success ).toBe( false );
            expect( ctx.errors.some( e => e.error === 'PropertyNotAllowed<save>' )).toBe( true );
        });

        it( 'should accept constructor functions in instanceOf', () =>
        {
            class Mailer {}
            const mailer = new Mailer();

            expect( validators.instanceOf( mailer, 'm', ctx, Mailer )).toBe( mailer );
            expect( ctx.success ).toBe( true );

            ctx.success = true;
            ctx.errors = [];
            validators.instanceOf({}, 'm', ctx, Mailer );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]?.error ).toBe( 'Type<Mailer>' );
        });

        it( 'should accept subclasses via instanceOf against the base constructor', () =>
        {
            class Mailer {}
            class SmtpMailer extends Mailer {}

            expect( validators.instanceOf( new SmtpMailer(), 'm', ctx, Mailer )).toBeInstanceOf( SmtpMailer );
            expect( ctx.success ).toBe( true );
        });

        it( 'should validate props (relaxed mode)', () => 
        {
            ctx.mode = 'relaxed';
            const input = { id : 1, name : 'Test', extra : 'ok' };
            
            const isValid = validators.object( input, 'user', ctx, ['id', 'name']);
            expect( isValid ).toBe( input );
            expect( ctx.success ).toBe( true );
        });

        it( 'should validate props (strip mode)', () => 
        {
            ctx.mode = 'strip';
            const input = { id : 1, name : 'Test', extra : 'remove me' };
            const data: any = {};
            
            validators.props( input, data, 'user', ctx, [
                ['id', false, validators.number],
                ['name', false, validators.string]
            ]);

            expect( data ).toEqual({ id : 1, name : 'Test' });
            expect( data.extra ).toBeUndefined();
        });

        it( 'should validate unions', () => 
        {
            const checks = [validators.string, validators.number];
            
            expect( validators.union( 'test', 'u', ctx, checks )).toBe( 'test' );
            expect( validators.union( 123, 'u', ctx, checks )).toBe( 123 );
            
            validators.union( true, 'u', ctx, checks );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors ).toHaveLength( 1 );
            expect( ctx.errors[0].error ).toBe( 'Type<Union>' );
            expect( ctx.errors[0].issues ).toHaveLength( 2 );
        });

        it( 'should not coerce in unions unless from is enabled', () => 
        {
            const checks = [validators.string, validators.number];

            validators.union( '123', 'u', ctx, checks );
            expect( ctx.success ).toBe( true ); // matches string arm

            ctx.success = true;
            ctx.errors = [];
            validators.union( true, 'u', ctx, checks );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            ctx.from = 'query';
            expect( validators.union( '123', 'u', ctx, [validators.number])).toBe( 123 );
            expect( ctx.success ).toBe( true );
        });

        it( 'should validate tuples', () => 
        {
            const checks = [validators.string, validators.number];
            const input = ['id', 1];
            const result = validators.tuple( input, 't', ctx, checks );
            
            expect( result ).toEqual( input );
            expect( result ).not.toBe( input );
            
            // Test wrong length
            validators.tuple(['id'], 't', ctx, checks );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 't', error : 'Tuple<2>', value : ['id'] });

            // Test non-array input
            ctx.success = true;
            ctx.errors = [];
            validators.tuple( 'not-a-tuple', 't', ctx, checks );
            expect( ctx.success ).toBe( false );

            // Test child failure
            ctx.success = true;
            ctx.errors = [];
            validators.tuple(['id', 'not-a-number'], 't', ctx, checks );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 't[1]', error : 'Type<number>', value : 'not-a-number' });
        });

        it( 'should mutate tuples when mutate is true', () => 
        {
            ctx.mutate = true;
            const checks = [validators.string, validators.number];
            const input = ['id', 1];
            const result = validators.tuple( input, 't', ctx, checks );
            expect( result ).toBe( input );
            expect( result ).toEqual(['id', 1]);
        });

        it( 'should validate tuples (strip mode)', () => 
        {
            ctx.mode = 'strip';
            const checks = [validators.string, validators.number];
            const input = ['id', 1];
            const result = validators.tuple( input, 't', ctx, checks );
            expect( result ).toEqual( input );
            expect( result ).not.toBe( input ); // Should be a copy
        });

        it( 'should validate custom validations', () => 
        {
            const isEven = ( val: number ) => val % 2 === 0;
            
            expect( validators.custom( 2, 'val', ctx, isEven )).toBe( 2 );
            expect( ctx.success ).toBe( true );

            validators.custom( 3, 'val', ctx, isEven );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'val', error : 'Custom<isEven>', value : 3 });
        });

        it( 'should validate minLength and maxLength', () => 
        {
            expect( validators.minLength( 'abc', 'path', ctx, 2 )).toBe( 'abc' );
            expect( ctx.success ).toBe( true );

            validators.minLength( 'abc', 'path', ctx, 4 );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'path', error : 'MinLength<4>', value : 'abc' });

            ctx.success = true;
            ctx.errors = [];
            expect( validators.maxLength( 'abc', 'path', ctx, 4 )).toBe( 'abc' );
            expect( ctx.success ).toBe( true );

            validators.maxLength( 'abc', 'path', ctx, 2 );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'path', error : 'MaxLength<2>', value : 'abc' });
        });

        it( 'should validate minimum, maximum, exclusiveMinimum, and exclusiveMaximum', () => 
        {
            // Numbers
            expect( validators.minimum( 10, 'path', ctx, 5 )).toBe( 10 );
            expect( ctx.success ).toBe( true );
            validators.minimum( 10, 'path', ctx, 15 );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            expect( validators.maximum( 10, 'path', ctx, 15 )).toBe( 10 );
            expect( ctx.success ).toBe( true );
            validators.maximum( 10, 'path', ctx, 5 );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            expect( validators.exclusiveMinimum( 10, 'path', ctx, 5 )).toBe( 10 );
            expect( ctx.success ).toBe( true );
            validators.exclusiveMinimum( 10, 'path', ctx, 10 );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            expect( validators.exclusiveMaximum( 10, 'path', ctx, 15 )).toBe( 10 );
            expect( ctx.success ).toBe( true );
            validators.exclusiveMaximum( 10, 'path', ctx, 10 );
            expect( ctx.success ).toBe( false );

            // Bigints
            ctx.success = true;
            expect( validators.minimum( 10n, 'path', ctx, 5n )).toBe( 10n );
            expect( ctx.success ).toBe( true );
            validators.minimum( 10n, 'path', ctx, 15n );
            expect( ctx.success ).toBe( false );
        });

        it( 'should validate multipleOf', () => 
        {
            expect( validators.multipleOf( 10, 'path', ctx, 5 )).toBe( 10 );
            expect( ctx.success ).toBe( true );
            validators.multipleOf( 10, 'path', ctx, 3 );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            expect( validators.multipleOf( 0.3, 'path', ctx, 0.1 )).toBe( 0.3 );
            expect( ctx.success ).toBe( true );

            // Bigints
            ctx.success = true;
            expect( validators.multipleOf( 10n, 'path', ctx, 5n )).toBe( 10n );
            expect( ctx.success ).toBe( true );
            validators.multipleOf( 10n, 'path', ctx, 3n );
            expect( ctx.success ).toBe( false );
        });

        it( 'should validate pattern without sticky lastIndex side effects', () => 
        {
            expect( validators.pattern( 'hello', 'path', ctx, /^h/, 'starts with h' )).toBe( 'hello' );
            expect( ctx.success ).toBe( true );

            validators.pattern( 'hello', 'path', ctx, /^a/, 'starts with a' );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            const re = /a/g;
            expect( validators.pattern( 'a', 'path', ctx, re, 'Pattern<a>' )).toBe( 'a' );
            expect( ctx.success ).toBe( true );
            expect( validators.pattern( 'a', 'path', ctx, re, 'Pattern<a>' )).toBe( 'a' );
            expect( ctx.success ).toBe( true );
        });

        it( 'should validate various formats', () => 
        {
            const formats = [
                { format : 'email', valid : 'test@example.com', invalid : 'invalid-email' },
                { format : 'email', valid : 'user.name+tag@example.co.uk', invalid : 'a@b' },
                { format : 'email', valid : 'a@b.co', invalid : 'a@b.c' },
                { format : 'email', valid : 'test@example.com', invalid : '.test@example.com' },
                { format : 'email', valid : 'test@example.com', invalid : 'test@-example.com' },
                { format : 'uuid', valid : '123e4567-e89b-12d3-a456-426614174000', invalid : 'invalid-uuid' },
                { format : 'uuid', valid : '018f8c7e-3d7a-7e5f-9c3d-2f1a4b6c8d9e', invalid : '123e4567-e89b-92d3-a456-426614174000' },
                { format : 'uuid', valid : '00000000-0000-0000-0000-000000000000', invalid : '123e4567-e89b-12d3-c456-426614174000' },
                { format : 'url', valid : 'https://google.com', invalid : 'google.com' },
                { format : 'ipv4', valid : '192.168.1.1', invalid : '999.999.999.999' },
                { format : 'ipv6', valid : '2001:0db8:85a3:0000:0000:8a2e:0370:7334', invalid : 'invalid-ipv6' },
                { format : 'date', valid : '2026-05-17', invalid : '17-05-2026' },
                { format : 'date-time', valid : '2026-05-17T19:55:00.000Z', invalid : 'invalid-date-time' },
                { format : 'byte', valid : 'Zm9vYmFy', invalid : 'invalid-base64!' },
                { format : 'password', valid : 'anything-goes', invalid : '' }, // Password always passes
                { format : 'regex', valid : '^[a-z]+$', invalid : '[' },
                { format : 'hostname', valid : 'google.com', invalid : '-google.com' },
                { format : 'hostname', valid : 'localhost', invalid : '-localhost' },
                { format : 'hostname', valid : 'LOCALHOST', invalid : 'local_host' },
                { format : 'idn-hostname', valid : 'münchen.de', invalid : '-bad.com' },
                { format : 'idn-email', valid : '用户@例子.广告', invalid : 'a@b' },
                { format : 'uri', valid : 'mailto:test@example.com', invalid : 'test@example.com' },
                { format : 'uri-reference', valid : '/path/to/resource', invalid : 'http://exa mple.com' },
                { format : 'iri', valid : 'https://例え.jp/path', invalid : 'not a iri' },
                { format : 'iri-reference', valid : './相对', invalid : 'has space' },
                { format : 'uri-template', valid : 'https://example.com/users/{userId}', invalid : 'https://example.com/{unclosed' },
                { format : 'time', valid : '19:55:00Z', invalid : '19-55-00' },
                { format : 'time', valid : '23:59:59+01:00', invalid : '99:99:99Z' },
                { format : 'time', valid : '00:00:00.123Z', invalid : '24:00:00Z' },
                { format : 'time', valid : '12:30:45-05:30', invalid : '12:60:00Z' },
                { format : 'duration', valid : 'P3D', invalid : 'invalid-duration' },
                { format : 'objectId', valid : '507f1f77bcf86cd799439011', invalid : 'invalid-object-id' }
            ];

            for( const f of formats ) 
            {
                ctx.success = true;
                ctx.errors = [];
                const result = validators.format( f.valid, 'path', ctx, f.format );
                expect( ctx.success ).toBe( true );
                expect( result ).toBe( f.valid );

                if( f.invalid ) 
                {
                    ctx.success = true;
                    ctx.errors = [];
                    validators.format( f.invalid, 'path', ctx, f.format );
                    expect( ctx.success ).toBe( false );
                }
            }

            ctx.success = true;
            ctx.errors = [];
            expect( validators.format( '2024-02-31', 'path', ctx, 'date' )).toBe( '2024-02-31' );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            ctx.from = 'query';
            const overflow = validators.format( '2024-02-31', 'path', ctx, 'date' );
            expect( ctx.success ).toBe( false );
            expect( overflow ).toBe( '2024-02-31' );
            delete ctx.from;

            ctx.success = true;
            ctx.errors = [];
            validators.format( 'anything', 'path', ctx, 'not-a-real-format' );
            expect( ctx.success ).toBe( false );
        });

        it( 'should validate minItems and maxItems', () => 
        {
            expect( validators.minItems([1, 2], 'path', ctx, 2 )).toEqual([1, 2]);
            expect( ctx.success ).toBe( true );
            validators.minItems([1], 'path', ctx, 2 );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            expect( validators.maxItems([1, 2], 'path', ctx, 2 )).toEqual([1, 2]);
            expect( ctx.success ).toBe( true );
            validators.maxItems([1, 2, 3], 'path', ctx, 2 );
            expect( ctx.success ).toBe( false );
        });

        it( 'should validate uniqueItems', () => 
        {
            expect( validators.uniqueItems([1, 2, 3], 'path', ctx )).toEqual([1, 2, 3]);
            expect( ctx.success ).toBe( true );

            validators.uniqueItems([1, 2, 2], 'path', ctx );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            // Objects uniqueness stringify check
            expect( validators.uniqueItems([{ a : 1 }, { b : 2 }], 'path', ctx )).toEqual([{ a : 1 }, { b : 2 }]);
            expect( ctx.success ).toBe( true );

            validators.uniqueItems([{ a : 1 }, { a : 1 }], 'path', ctx );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            validators.uniqueItems([{ a : 1, b : 2 }, { b : 2, a : 1 }], 'path', ctx );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            ctx.errors = [];
            expect( validators.uniqueItems([0, -0], 'path', ctx )).toEqual([0, -0]);
            expect( ctx.success ).toBe( true );

            ctx.success = true;
            ctx.errors = [];
            validators.uniqueItems([Number.NaN, Number.NaN], 'path', ctx );
            expect( ctx.success ).toBe( false );
        });

        it( 'should support literal casting options', () => 
        {
            // null must not coerce to boolean false
            ctx.from = 'query';
            validators.literal( null, 'path', ctx, false );
            expect( ctx.success ).toBe( false );

            // String to number literal
            ctx.success = true;
            ctx.errors = [];
            expect( validators.literal( '123', 'path', ctx, 123 )).toBe( 123 );
            expect( ctx.success ).toBe( true );

            // String to boolean literal
            expect( validators.literal( 'true', 'path', ctx, true )).toBe( true );
            expect( validators.literal( 'yes', 'path', ctx, true )).toBe( true );
            expect( validators.literal( '0', 'path', ctx, false )).toBe( false );
            expect( ctx.success ).toBe( true );
        });

        it( 'should validate templateLiteral', () => 
        {
            expect( validators.templateLiteral( 'abc', 'path', ctx, /^[a-z]+$/, 'lowercase' )).toBe( 'abc' );
            expect( ctx.success ).toBe( true );

            validators.templateLiteral( '123', 'path', ctx, /^[a-z]+$/, 'lowercase' );
            expect( ctx.success ).toBe( false );

            ctx.success = true;
            validators.templateLiteral( 123, 'path', ctx, /^[a-z]+$/, 'lowercase' );
            expect( ctx.success ).toBe( false );
        });

        it( 'should wrap scalars into arrays under from:query', () => 
        {
            ctx.from = 'query';
            const result = validators.array( 123, 'path', ctx, validators.number );
            expect( result ).toEqual([123]);
            expect( ctx.success ).toBe( true );
        });

        it( 'should validate any validator', () => 
        {
            expect( validators.any( 'anything' )).toBe( 'anything' );
            expect( validators.any( 123 )).toBe( 123 );
        });

        it( 'should validate bigint and from conversions', () => 
        {
            expect( validators.bigint( 123n, 'path', ctx )).toBe( 123n );
            expect( ctx.success ).toBe( true );

            // Without from, numeric string should fail
            validators.bigint( '123', 'path', ctx );
            expect( ctx.success ).toBe( false );

            // from: 'json' revives digit strings
            ctx.success = true;
            ctx.errors = [];
            ctx.from = 'json';
            expect( validators.bigint( '123', 'path', ctx )).toBe( 123n );
            expect( ctx.success ).toBe( true );

            // from: 'json' does not revive numbers
            ctx.success = true;
            ctx.errors = [];
            validators.bigint( 123, 'path', ctx );
            expect( ctx.success ).toBe( false );

            // from: 'query' also revives numbers
            ctx.from = 'query';
            ctx.success = true;
            ctx.errors = [];
            expect( validators.bigint( 123, 'path', ctx )).toBe( 123n );
            expect( ctx.success ).toBe( true );

            // invalid string fails
            ctx.success = true;
            ctx.errors = [];
            validators.bigint( 'invalid-bigint', 'path', ctx );
            expect( ctx.success ).toBe( false );
        });

        it( 'should validate regexp and JSON wire-form conversions', () => 
        {
            const rx = /abc/i;
            expect( validators.regexp( rx, 'path', ctx )).toBe( rx );
            expect( ctx.success ).toBe( true );

            // Without from, wire forms fail
            validators.regexp( '/abc/i', 'path', ctx );
            expect( ctx.success ).toBe( false );

            // from: 'json' revives /pattern/flags and { source, flags }
            ctx.success = true;
            ctx.errors = [];
            ctx.from = 'json';
            const parsed1 = validators.regexp( '/abc/i', 'path', ctx );
            expect( parsed1 ).toBeInstanceOf( RegExp );
            expect( parsed1.source ).toBe( 'abc' );
            expect( parsed1.flags ).toBe( 'i' );
            expect( ctx.success ).toBe( true );

            ctx.success = true;
            ctx.errors = [];
            const parsedObj = validators.regexp({ source : 'abc', flags : 'i' }, 'path', ctx );
            expect( parsedObj ).toBeInstanceOf( RegExp );
            expect( parsedObj.source ).toBe( 'abc' );
            expect( parsedObj.flags ).toBe( 'i' );

            // Plain pattern string requires from: 'query'
            ctx.success = true;
            ctx.errors = [];
            validators.regexp( 'abc', 'path', ctx );
            expect( ctx.success ).toBe( false );

            ctx.from = 'query';
            ctx.success = true;
            ctx.errors = [];
            const parsed2 = validators.regexp( 'abc', 'path', ctx );
            expect( parsed2 ).toBeInstanceOf( RegExp );
            expect( parsed2.source ).toBe( 'abc' );
            expect( ctx.success ).toBe( true );

            ctx.success = true;
            ctx.errors = [];
            validators.regexp( '[', 'path', ctx );
            expect( ctx.success ).toBe( false );
            delete ctx.from;
        });

        it( 'should reject unknown format names', () => 
        {
            validators.format( 'anything', 'path', ctx, 'unknown-format' );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Format<unknown-format>' );
        });
    });

    describe( 'Dynamic Runtime Schema Validation', () => 
    {
        it( 'should compile and validate simple and complex schemas at runtime', () => 
        {
            const schema = {
                type       : 'object',
                properties : {
                    name      : { type : 'string', minLength : 2 },
                    age       : { type : 'number', minimum : 18 },
                    tags      : { type : 'array', items : { type : 'string' }, uniqueItems : true },
                    active    : { type : 'boolean' },
                    nullField : { type : 'null' },
                    kind      : { const : 'member' },
                    role      : { anyOf : [{ const : 'admin' }, { const : 'user' }] }
                },
                required : ['name', 'age']
            };

            const validateFn = getOrCompileSchema( schema );

            // Valid payload
            ctx.success = true;
            ctx.errors = [];
            const validPayload = {
                name      : 'Tom',
                age       : 20,
                tags      : ['web', 'dev'],
                active    : true,
                nullField : null,
                kind      : 'member',
                role      : 'admin'
            };
            const result1 = validateFn( validPayload, 'path', ctx );
            expect( ctx.success ).toBe( true );
            expect( result1.name ).toBe( 'Tom' );

            // Invalid payload
            ctx.success = true;
            ctx.errors = [];
            const invalidPayload = {
                name      : 'T',
                age       : 15,
                tags      : ['web', 'web'],
                active    : 'yes',
                nullField : 123,
                kind      : 'guest',
                role      : 'superadmin'
            };
            validateFn( invalidPayload, 'path', ctx );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors.length ).toBeGreaterThan( 0 );
        });

        it( 'should support dynamic schema validation for circular structures', () => 
        {
            const circularSchema = {
                $defs : {
                    Node : {
                        type       : 'object',
                        properties : {
                            value : { type : 'string' },
                            next  : { $ref : '#/$defs/Node' }
                        },
                        required : ['value']
                    }
                },
                $ref : '#/$defs/Node'
            };

            const validateFn = getOrCompileSchema( circularSchema );

            ctx.success = true;
            ctx.errors = [];
            const circularData = {
                value : 'root',
                next  : {
                    value : 'child',
                    next  : {
                        value : 'grandchild'
                    }
                }
            };
            const result = validateFn( circularData, 'path', ctx );
            expect( ctx.success ).toBe( true );
            expect( result.next.next.value ).toBe( 'grandchild' );
        });

        it( 'should strip additional properties in strip mode', () => 
        {
            const schema = 
            {
                type       : 'object',
                properties : 
                {
                    name : { type : 'string' }
                }
            };

            const validateFn = getOrCompileSchema( schema );

            ctx.mode = 'strip';

            const payload = 
            {
                name  : 'John',
                extra : 'remove me'
            };

            const result = validateFn( payload, 'path', ctx );

            expect( ctx.success ).toBe( true );
            expect( result ).toEqual({ name : 'John' });
            expect( result.extra ).toBeUndefined();
        });

        it( 'should always create a new object by default even in strip mode without extras', () => 
        {
            const schema = 
            {
                type       : 'object',
                properties : 
                {
                    name : { type : 'string' }
                }
            };

            const validateFn = getOrCompileSchema( schema );

            ctx.mode = 'strip';

            const payload = 
            {
                name : 'John'
            };

            const result = validateFn( payload, 'path', ctx );

            expect( ctx.success ).toBe( true );
            expect( result ).toEqual({ name : 'John' });
            expect( result ).not.toBe( payload );
        });

        it( 'should mutate the original object when mutate is true, including strip', () => 
        {
            const schema = 
            {
                type       : 'object',
                properties : 
                {
                    name : { type : 'string' }
                }
            };

            const validateFn = getOrCompileSchema( schema );

            ctx.mode = 'strip';
            ctx.mutate = true;

            const payload: any = 
            {
                name  : 'John',
                extra : 'remove me'
            };

            const result = validateFn( payload, 'path', ctx );

            expect( ctx.success ).toBe( true );
            expect( result ).toBe( payload );
            expect( result ).toEqual({ name : 'John' });
            expect( payload.extra ).toBeUndefined();
        });

        it( 'should support dynamic schema validation for tuples', () => 
        {
            const schema = 
            {
                type  : 'array',
                items : 
                [
                    { type : 'string' },
                    { type : 'number' }
                ]
            };

            const validateFn = getOrCompileSchema( schema );

            // Valid tuple
            ctx.success = true;
            ctx.errors = [];
            const result1 = validateFn(['hello', 123], 'path', ctx );

            expect( ctx.success ).toBe( true );
            expect( result1 ).toEqual(['hello', 123]);

            // Invalid tuple
            ctx.success = true;
            ctx.errors = [];
            validateFn([123, 'hello'], 'path', ctx );

            expect( ctx.success ).toBe( false );
        });

        it( 'should strip additional properties in strip mode when keys length is equal but different keys are present', () => 
        {
            const schema = 
            {
                type       : 'object',
                properties : 
                {
                    name : { type : 'string' }
                }
            };

            const validateFn = getOrCompileSchema( schema );

            ctx.mode = 'strip';

            const payload = 
            {
                extra : 'remove me'
            };

            const result = validateFn( payload, 'path', ctx );

            expect( ctx.success ).toBe( true );
            expect( result ).toEqual({});
            expect( result.extra ).toBeUndefined();
        });

        it( 'should treat an empty schema as accepting any value', () =>
        {
            const schema = {};
            const validateFn = getOrCompileSchema( schema );

            const result = validateFn( 'anything goes', 'path', ctx );

            expect( ctx.success ).toBe( true );
            expect( result ).toBe( 'anything goes' );
            expect(() => getOrCompileSchema({ type : 'unknown' })).toThrow(
                'Unsupported JSON Schema type: unknown'
            );
        });

        it( 'should reject malformed non-object subschemas', () =>
        {
            const schema = 
            {
                type       : 'object',
                properties : 
                {
                    name : 'not-an-object' as any
                }
            };

            expect(() => getOrCompileSchema( schema )).toThrow(
                'Invalid JSON Schema: subschemas must be objects or booleans'
            );
        });

        it( 'should throw when ref targets a non-existent definition', () => 
        {
            const schema = 
            {
                $ref : '#/$defs/NonExistent'
            };

            expect(() => getOrCompileSchema( schema )).toThrow( 'Schema reference not found: #/$defs/NonExistent' );
        });

        it( 'should validate integer type and reject float values', () => 
        {
            const schema = 
            {
                type : 'integer'
            };

            const validateFn = getOrCompileSchema( schema );

            ctx.success = true;
            ctx.errors = [];
            validateFn( 1.5, 'path', ctx );

            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0].error ).toBe( 'Type<integer>' );
        });

        it( 'should return cached compiled schema on subsequent calls', () => 
        {
            const schema = 
            {
                type : 'string'
            };

            const fn1 = getOrCompileSchema( schema );
            const fn2 = getOrCompileSchema( schema );

            expect( fn1 ).toBe( fn2 );
        });
    });

    describe( 'Set and Map validations', () => 
    {
        it( 'should validate Set objects', () => 
        {
            const s = new Set([1, 2, 3]);
            const cloned = validators.set( s, 's', ctx, validators.number );
            expect( cloned ).not.toBe( s );
            expect( Array.from( cloned )).toEqual([1, 2, 3]);
            expect( ctx.success ).toBe( true );

            ctx.mutate = true;
            expect( validators.set( s, 's', ctx, validators.number )).toBe( s );

            // conversion from array (json or query)
            ctx.mutate = false;
            ctx.from = 'json';
            const converted = validators.set([1, 2, 3], 's', ctx, validators.number );
            expect( converted ).toBeInstanceOf( Set );
            expect( Array.from( converted )).toEqual([1, 2, 3]);

            // conversion from single value requires query
            ctx.from = 'json';
            ctx.success = true;
            ctx.errors = [];
            validators.set( 42, 's', ctx, validators.number );
            expect( ctx.success ).toBe( false );

            ctx.from = 'query';
            ctx.success = true;
            ctx.errors = [];
            const convertedSingle = validators.set( 42, 's', ctx, validators.number );
            expect( convertedSingle ).toBeInstanceOf( Set );
            expect( Array.from( convertedSingle )).toEqual([42]);

            // fail invalid
            delete ctx.from;
            validators.set( 'not-a-set', 's', ctx, validators.number );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 's', error : 'Type<Set>', value : 'not-a-set' });
        });

        it( 'should validate Set objects (strip mode)', () => 
        {
            ctx.mode = 'strip';
            const s = new Set([1, 2, 3]);
            const res = validators.set( s, 's', ctx, validators.number );
            expect( res ).not.toBe( s );
            expect( Array.from( res )).toEqual([1, 2, 3]);
        });

        it( 'should validate Map objects', () => 
        {
            const m = new Map([['a', 1], ['b', 2]]);
            const cloned = validators.map( m, 'm', ctx, validators.string, validators.number );
            expect( cloned ).not.toBe( m );
            expect( Array.from( cloned.entries())).toEqual([['a', 1], ['b', 2]]);
            expect( ctx.success ).toBe( true );

            ctx.mutate = true;
            expect( validators.map( m, 'm', ctx, validators.string, validators.number )).toBe( m );

            // conversion from object
            ctx.mutate = false;
            ctx.from = 'json';
            const converted = validators.map({ a : 1, b : 2 }, 'm', ctx, validators.string, validators.number );
            expect( converted ).toBeInstanceOf( Map );
            expect( Array.from( converted.entries())).toEqual([['a', 1], ['b', 2]]);

            // fail invalid
            delete ctx.from;
            validators.map( 'not-a-map', 'm', ctx, validators.string, validators.number );
            expect( ctx.success ).toBe( false );
            expect( ctx.errors[0]).toEqual({ path : 'm', error : 'Type<Map>', value : 'not-a-map' });
        });

        it( 'should validate Map objects (strip mode)', () => 
        {
            ctx.mode = 'strip';
            const m = new Map([['a', 1], ['b', 2]]);
            const res = validators.map( m, 'm', ctx, validators.string, validators.number );
            expect( res ).not.toBe( m );
            expect( Array.from( res.entries())).toEqual([['a', 1], ['b', 2]]);
        });
    });

    describe( 'Validator exception customization', () => 
    {
        it( 'should throw custom error using errorFactory', () => 
        {
            const customVal = ( v: any, path: string, subCtx: any ) => 
            {
                subCtx.success = false;
                subCtx.errors.push({ path, error : 'custom_fail', value : v });

                return v;
            };
            class CustomValidationError extends Error 
            {
                constructor( public errors: any[]) 
                {
                    super( 'My Custom Error' );
                }
            }

            expect(() => 
            {
                assert( customVal, 'test', {
                    errorFactory : ( errors ) => new CustomValidationError( errors )
                });
            }).toThrow( CustomValidationError );
        });

        it( 'should validate and return status object', () => 
        {
            const dummyVal = ( v: any, path: string, subCtx: any ) => 
            {
                if( v !== 'hello' ) 
                {
                    subCtx.success = false;
                    subCtx.errors.push({ path, error : 'not_hello', value : v });
                }

                return v;
            };

            // Success case
            const resSuccess = validate( dummyVal, 'hello' );

            expect( resSuccess.success ).toBe( true );
            expect( resSuccess.data ).toBe( 'hello' );
            expect( resSuccess.errors ).toEqual([]);

            // Failure case with options object
            const resFail = validate( dummyVal, 'world', { mode : 'strict', from : 'query' } );

            expect( resFail.success ).toBe( false );
            expect( resFail.data ).toBeUndefined();
            expect( resFail.errors ).toHaveLength( 1 );
            expect( resFail.errors[0]).toEqual({ path : '', error : 'not_hello', value : 'world' });
        });

        it( 'should check validity using is method', () => 
        {
            const dummyVal = ( v: any, path: string, subCtx: any ) => 
            {
                if( v !== 'hello' ) 
                {
                    subCtx.success = false;
                }

                return v;
            };

            expect( is( dummyVal, 'hello' )).toBe( true );
            expect( is( dummyVal, 'world' )).toBe( false );
        });

        it( 'should reject root-level coercion on is and assertGuard; allow in-place object from', () => 
        {
            expect( is( validators.number, '42', { from : 'query' })).toBe( false );
            expect(() => assertGuard( validators.number, '42', { from : 'query' })).toThrow( /Type<number>/ );
            expect( assert( validators.number, '42', { from : 'query' })).toBe( 42 );

            const schema = 
            {
                type       : 'object',
                properties : { age : { type : 'number' }}
            };
            const fn = getOrCompileSchema( schema );
            const data = { age : '20' };

            expect( is( fn, data, { from : 'query' })).toBe( true );
            expect( data.age ).toBe( 20 );
        });

        it( 'should always mutate in place for is and assertGuard strip', () => 
        {
            const schema = 
            {
                type       : 'object',
                properties : { name : { type : 'string' }}
            };
            const fn = getOrCompileSchema( schema );
            const a = { name : 'A', extra : 1 };
            const b = { name : 'B', extra : 2 };

            expect( is( fn, a, 'strip' )).toBe( true );
            expect( a ).toEqual({ name : 'A' });
            expect( a ).not.toHaveProperty( 'extra' );

            assertGuard( fn, b, 'strip' );
            expect( b ).toEqual({ name : 'B' });
            expect( b ).not.toHaveProperty( 'extra' );
        });

        it( 'should revive via custom from on type mismatch only', () => 
        {
            const calls: any[] = [];
            const from = ( value: any, c: { key : string, kind : string, path : string, root : any }) => 
            {
                calls.push({ key : c.key, value, kind : c.kind, path : c.path, root : c.root });

                if( c.kind === 'Date' && value && typeof value === 'object' && typeof value.$date === 'string' )
                {
                    return new Date( value.$date );
                }

                return value;
            };

            const iso = '2024-01-15T12:00:00.000Z';
            const revived = assert( validators.date, { $date : iso }, { from });
            expect( revived ).toBeInstanceOf( Date );
            expect( revived.toISOString()).toBe( iso );
            expect( calls ).toEqual([{
                key   : '',
                value : { $date : iso },
                kind  : 'Date',
                path  : '',
                root  : { $date : iso }
            }]);

            calls.length = 0;
            const already = new Date( iso );
            expect( assert( validators.date, already, { from })).toBe( already );
            expect( calls ).toEqual([]);
        });

        it( 'should throw default validation error when assert fails without errorFactory', () => 
        {
            const dummyVal = ( v: any, path: string, subCtx: any ) => 
            {
                subCtx.success = false;
                subCtx.errors.push({ path : 'some.path', error : 'some_error', value : v });

                return v;
            };

            expect(() => assert( dummyVal, 'value' )).toThrow( 'Validation Error: some.path: some_error' );
        });

        it( 'should enforce exclusiveMinimum and exclusiveMaximum in compileSchema', () => 
        {
            const validateFn = getOrCompileSchema({
                type             : 'number',
                exclusiveMinimum : 0,
                exclusiveMaximum : 10
            });

            const okCtx = { success : true, errors : [], mode : 'strict' as const };
            expect( validateFn( 5, '', okCtx )).toBe( 5 );
            expect( okCtx.success ).toBe( true );

            const lowCtx = { success : true, errors : [], mode : 'strict' as const };
            validateFn( 0, '', lowCtx );
            expect( lowCtx.success ).toBe( false );

            const highCtx = { success : true, errors : [], mode : 'strict' as const };
            validateFn( 10, '', highCtx );
            expect( highCtx.success ).toBe( false );
        });

        it( 'should compile Date and RegExp x-typescript-type schemas', () => 
        {
            const dateFn = getOrCompileSchema({ 'x-typescript-type' : 'Date' });
            const dateCtx = { success : true, errors : [], mode : 'strict' as const };
            const now = new Date();
            expect( dateFn( now, '', dateCtx )).toBe( now );
            expect( dateCtx.success ).toBe( true );

            const isoCtx = { success : true, errors : [], mode : 'strict' as const, from : 'json' as const };
            const fromIso = dateFn( now.toISOString(), '', isoCtx );
            expect( fromIso ).toBeInstanceOf( Date );
            expect( isoCtx.success ).toBe( true );

            const strictIsoCtx = { success : true, errors : [], mode : 'strict' as const };
            dateFn( now.toISOString(), '', strictIsoCtx );
            expect( strictIsoCtx.success ).toBe( false );

            const reFn = getOrCompileSchema({ 'x-typescript-type' : 'RegExp' });
            const reCtx = { success : true, errors : [], mode : 'strict' as const };
            const re = /abc/;
            expect( reFn( re, '', reCtx )).toBe( re );
            expect( reCtx.success ).toBe( true );

            const reStrCtx = { success : true, errors : [], mode : 'strict' as const, from : 'json' as const };
            const fromStr = reFn( '/abc/i', '', reStrCtx );
            expect( fromStr ).toBeInstanceOf( RegExp );
            expect( fromStr.flags ).toBe( 'i' );
            expect( reStrCtx.success ).toBe( true );
        });

        it( 'should compile bigint, undefined, Set, Map via x-typescript-type', () => 
        {
            const bigFn = getOrCompileSchema({ 'x-typescript-type' : 'bigint' });
            const bigCtx = { success : true, errors : [], mode : 'strict' as const, from : 'json' as const };
            expect( bigFn( '42', '', bigCtx )).toBe( 42n );
            expect( bigCtx.success ).toBe( true );

            const undefFn = getOrCompileSchema({ 'x-typescript-type' : 'undefined' });
            const undefCtx = { success : true, errors : [], mode : 'strict' as const };
            expect( undefFn( undefined, '', undefCtx )).toBeUndefined();
            expect( undefCtx.success ).toBe( true );
            undefFn( null, '', undefCtx );
            expect( undefCtx.success ).toBe( false );

            const setFn = getOrCompileSchema({
                'x-typescript-type' : 'Set',
                items               : { type : 'number' }
            });
            const setCtx = { success : true, errors : [], mode : 'strict' as const, from : 'json' as const };
            const setRes = setFn([1, 2], '', setCtx );
            expect( setRes ).toBeInstanceOf( Set );
            expect( Array.from( setRes )).toEqual([1, 2]);

            const mapFn = getOrCompileSchema({
                'x-typescript-type' : 'Map',
                key                 : { type : 'string' },
                value               : { type : 'number' }
            });
            const mapCtx = { success : true, errors : [], mode : 'strict' as const, from : 'json' as const };
            const mapRes = mapFn({ a : 1 }, '', mapCtx );
            expect( mapRes ).toBeInstanceOf( Map );
            expect( mapRes.get( 'a' )).toBe( 1 );
        });

        it( 'should honor additionalProperties schemas for Record-like objects', () => 
        {
            const validateFn = getOrCompileSchema({
                type                 : 'object',
                additionalProperties : { type : 'number' }
            });

            const okCtx = { success : true, errors : [], mode : 'strict' as const };
            expect( validateFn({ a : 1, b : 2 }, '', okCtx )).toEqual({ a : 1, b : 2 });
            expect( okCtx.success ).toBe( true );

            const badCtx = { success : true, errors : [], mode : 'strict' as const };
            validateFn({ a : 'x' }, '', badCtx );
            expect( badCtx.success ).toBe( false );
        });

        it( 'should merge allOf object schemas', () => 
        {
            const validateFn = getOrCompileSchema({
                allOf : [
                    { type : 'object', properties : { a : { type : 'string' } }, required : ['a'], additionalProperties : false },
                    { type : 'object', properties : { b : { type : 'number' } }, required : ['b'], additionalProperties : false }
                ]
            });

            const okCtx = { success : true, errors : [], mode : 'strict' as const };
            expect( validateFn({ a : 'x', b : 1 }, '', okCtx )).toEqual({ a : 'x', b : 1 });
            expect( okCtx.success ).toBe( true );
        });
    });
});

