import { describe, expect, it } from 'vitest';
import { validators, type ValidationContext, getOrCompileSchema, validate } from '../src/runtime/validators.js';

function context( root?: any ): ValidationContext
{
    return { success : true, errors : [], mode : 'strict', root };
}

describe( 'Security and correctness regressions', () =>
{
    it( 'preserves __proto__ as an own record key without changing the output prototype', () =>
    {
        const input = JSON.parse( '{"__proto__":{"isAdmin":true},"safe":"value"}' );
        const ctx = context( input );
        const result = validators.record( input, '', ctx, validators.any );

        expect( ctx.success ).toBe( true );
        expect( Object.getPrototypeOf( result )).toBe( Object.prototype );
        expect( Object.hasOwn( result, '__proto__' )).toBe( true );
        expect( result.isAdmin ).toBeUndefined();
        expect( result.__proto__ ).toEqual({ isAdmin : true });
    });

    it( 'validates allOf transactionally and applies strict or strip to combined keys', () =>
    {
        const schema =
        {
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
        };
        const validator = getOrCompileSchema( schema );
        const strictInput = { a : 'x', b : 1, extra : true };
        const strict = validate( validator, strictInput );

        expect( strict.success ).toBe( false );
        expect( strictInput ).toEqual({ a : 'x', b : 1, extra : true });

        const stripInput = { a : 'x', b : 1, extra : true };
        const stripped = validate( validator, stripInput, { mode : 'strip', mutate : true });

        expect( stripped.success ).toBe( true );
        expect( stripped.data ).toBe( stripInput );
        expect( stripInput ).toEqual({ a : 'x', b : 1 });
    });

    it( 'does not modify input when allOf validation fails', () =>
    {
        const validator = getOrCompileSchema({
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
        const input: any = { a : 'x', b : 'invalid' };
        const result = validate( validator, input, { mode : 'strip', mutate : true });

        expect( result.success ).toBe( false );
        expect( result.data ).toBeUndefined();
        expect( input ).toEqual({ a : 'x', b : 'invalid' });
    });

    it( 'does not overwrite an earlier allOf coercion with an unvalidated extra from a later member', () =>
    {
        const validator = getOrCompileSchema({
            allOf :
            [
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
        const result = validate( validator, { a : '1', b : 2 }, { from : 'query' });

        expect( result.success ).toBe( true );
        expect( result.data ).toEqual({ a : 1, b : 2 });
    });

    it( 'rejects unknown x-typescript-type values and accepts newly supported keywords', () =>
    {
        expect(() => getOrCompileSchema({ 'x-typescript-type' : 'UnknownType' })).toThrow( /Unsupported x-typescript-type/ );
        expect(() => getOrCompileSchema({
            type        : 'array',
            contains    : { type : 'string' },
            prefixItems : [ { type : 'string' } ]
        })).not.toThrow();
        expect(() => getOrCompileSchema({})).not.toThrow();
        expect( validate( getOrCompileSchema({ enum : ['a', 'b'] }), 'a' ).success ).toBe( true );
        expect( validate( getOrCompileSchema({ oneOf : [{ type : 'string' }, { type : 'number' }] }), 1 ).success ).toBe( true );
        expect( validate( getOrCompileSchema({ type : [ 'string', 'number' ] }), 2 ).success ).toBe( true );
    });

    it( 'implements boolean JSON Schemas instead of treating false as an empty schema', () =>
    {
        const allow = validate( getOrCompileSchema( true ), 'value' );
        const deny = validate( getOrCompileSchema( false ), 'value' );

        expect( allow.success ).toBe( true );
        expect( deny.success ).toBe( false );
        expect( deny.data ).toBeUndefined();
    });

    it( 'enforces const on typed literal schemas emitted by jsonSchema', () =>
    {
        const ok = validate( getOrCompileSchema({ type : 'string', const : 'folder' }), 'folder' );
        const bad = validate( getOrCompileSchema({
            anyOf : [
                { type : 'string', const : 'folder' },
                { type : 'string', const : 'file' }
            ]
        }), 'other' );

        expect( ok.success ).toBe( true );
        expect( bad.success ).toBe( false );
    });

    it( 'rejects array values as schemas', () =>
    {
        expect(() => getOrCompileSchema([] as never )).toThrow( /Invalid JSON Schema/ );
    });

    it( 'resolves nested $ref pointers instead of only the last path segment', () =>
    {
        const ok = validate( getOrCompileSchema({
            $defs : {
                Foo   : { type : 'array', items : { type : 'string' } },
                items : { type : 'number' }
            },
            $ref : '#/$defs/Foo/items'
        }), 'text' );
        const bad = validate( getOrCompileSchema({
            $defs : {
                Foo   : { type : 'array', items : { type : 'string' } },
                items : { type : 'number' }
            },
            $ref : '#/$defs/Foo/items'
        }), 1 );

        expect( ok.success ).toBe( true );
        expect( bad.success ).toBe( false );
    });

    it( 'rejects unsafe schema patterns before validation', () =>
    {
        expect(() => getOrCompileSchema({
            type    : 'string',
            pattern : '(a+)+$'
        })).toThrow( /Unsafe regular expression/ );
    });

    it( 'only coerces complete finite query numbers', () =>
    {
        expect( validators.coerceQueryNumber( '12.5' )).toBe( 12.5 );
        expect( validators.coerceQueryNumber( '12abc' )).toBe( '12abc' );
        expect( validators.coerceQueryNumber( '1e309' )).toBe( '1e309' );
        expect( validators.coerceQueryNumber( '0x10' )).toBe( '0x10' );
    });

    it( 'compares unique items without serialization collisions or BigInt crashes', () =>
    {
        const distinctCtx = context();

        expect(() => validators.uniqueItems(
            [{ a : undefined }, { a : '[Circular]' }, { a : 1n }],
            'items',
            distinctCtx
        )).not.toThrow();
        expect( distinctCtx.success ).toBe( true );

        const duplicateCtx = context();
        validators.uniqueItems([{ a : 1n }, { a : 1n }], 'items', duplicateCtx );
        expect( duplicateCtx.success ).toBe( false );
    });

    it( 'rejects invalid RFC 3339 calendar dates and date-only date-times', () =>
    {
        const invalidDate = context();
        validators.format( '2024-02-30', 'date', invalidDate, 'date' );
        expect( invalidDate.success ).toBe( false );

        const invalidDateTime = context();
        validators.format( '2024-01-01', 'dateTime', invalidDateTime, 'date-time' );
        expect( invalidDateTime.success ).toBe( false );
    });

    it( 'reports invalid BigInt multipleOf values instead of throwing', () =>
    {
        const ctx = context();

        expect(() => validators.multipleOf( 'invalid' as any, 'value', ctx, 2n )).not.toThrow();
        expect( ctx.success ).toBe( false );
    });

    it( 'mutates containers in place when mutate is true, including after child failure', () =>
    {
        const array = ['1', 'invalid'];
        const arrayCtx = { ...context( array ), mutate : true, from : 'query' as const };
        validators.array( array, 'array', arrayCtx, validators.number );
        expect( array ).toEqual([1, 'invalid']);
        expect( arrayCtx.success ).toBe( false );

        const set = new Set<any>(['1', 'invalid']);
        const setCtx = { ...context( set ), mutate : true, from : 'query' as const };
        validators.set( set, 'set', setCtx, validators.number );
        expect([ ...set ]).toEqual([1, 'invalid']);
        expect( setCtx.success ).toBe( false );

        const map = new Map<any, any>([['a', '1'], ['b', 'invalid']]);
        const mapCtx = { ...context( map ), mutate : true, from : 'query' as const };
        validators.map( map, 'map', mapCtx, validators.string, validators.number );
        expect([ ...map.entries() ]).toEqual([['a', 1], ['b', 'invalid']]);
        expect( mapCtx.success ).toBe( false );
    });

    it( 'does not let a failed union arm mutate the input when outer mutate is true', () =>
    {
        const armTrue = ( v: any, path: string, ctx: ValidationContext ) =>
        {
            const obj = validators.object( v, path, ctx );
            const data = validators.objectShell( obj, ctx );
            validators.props( obj, data, path, ctx, [
                ['n', false, validators.number],
                ['ok', false, ( val: any, p: string, c: ValidationContext ) => validators.literal( val, p, c, true )]
            ]);

            return data;
        };
        const armFalse = ( v: any, path: string, ctx: ValidationContext ) =>
        {
            const obj = validators.object( v, path, ctx );
            const data = validators.objectShell( obj, ctx );
            validators.props( obj, data, path, ctx, [
                ['n', false, validators.number],
                ['ok', false, ( val: any, p: string, c: ValidationContext ) => validators.literal( val, p, c, false )]
            ]);

            return data;
        };

        const input = { n : '5', ok : false };
        const ctx = { ...context( input ), mutate : true, from : 'query' as const, mode : 'relaxed' as const };
        const result = validators.union( input, '', ctx, [armTrue, armFalse]);

        expect( ctx.success ).toBe( true );
        expect( result ).toBe( input );
        expect( input ).toEqual({ n : 5, ok : false });
    });

    it( 'preserves __proto__ as an own property without mutating prototype in parse relaxed mode and index signatures', async() =>
    {
        const { emitAndImport } = await import( './helpers/compile.js' );
        const mod = await emitAndImport<{
            parseRelaxed : ( json: string ) => any
            parseRecord  : ( json: string ) => any
        }>( `
            import { parse } from '../src/index.js';
            interface Basic { name: string }
            export const parseRelaxed = ( json: string ) => parse<Basic>( json, { mode: 'relaxed' } );
            export const parseRecord = ( json: string ) => parse<Record<string, any>>( json );
        `, 'temp_parse_proto_safety' );

        const resRelaxed = mod.parseRelaxed( '{"name":"alice","__proto__":{"polluted":true}}' );
        expect( Object.getPrototypeOf( resRelaxed )).toBe( Object.prototype );
        expect( Object.hasOwn( resRelaxed, '__proto__' )).toBe( true );
        expect(( resRelaxed as any ).polluted ).toBeUndefined();
        expect(({} as any ).polluted ).toBeUndefined();

        const resRecord = mod.parseRecord( '{"safe":1,"__proto__":{"polluted":true},"constructor":"ctorVal","prototype":"protoVal"}' );
        expect( Object.getPrototypeOf( resRecord )).toBe( Object.prototype );
        expect( Object.hasOwn( resRecord, '__proto__' )).toBe( true );
        expect( Object.hasOwn( resRecord, 'constructor' )).toBe( true );
        expect( Object.hasOwn( resRecord, 'prototype' )).toBe( true );
        expect( resRecord.constructor ).toBe( 'ctorVal' );
        expect( resRecord.prototype ).toBe( 'protoVal' );
        expect(( resRecord as any ).polluted ).toBeUndefined();
    });

    it( 'does not satisfy Requires constraint via inherited Object.prototype properties like toString', () =>
    {
        const root = { child : { a : 1 } };
        const ctx = context( root );
        validators.requires( root.child, 'child', ctx, [ 'toString' ]);

        expect( ctx.success ).toBe( false );
        expect( ctx.errors[0].error ).toBe( 'Requires<toString>' );
    });

    it( 'prevents sparse-array OOM DoS in parseQueryString on huge bracket indices', async() =>
    {
        const { parseQueryString } = await import( '../src/runtime/parse-runtime.js' );

        const parsed = parseQueryString( 'items[999999999]=x&nested[0][999999999]=y' );

        expect( Array.isArray( parsed.items )).toBe( false );
        expect( parsed.items['999999999']).toBe( 'x' );
        expect( Array.isArray( parsed.nested )).toBe( true );
        expect( Array.isArray( parsed.nested[0])).toBe( false );
        expect( parsed.nested[0]['999999999']).toBe( 'y' );
    });

    it( 'validates frozen objects, arrays, tuples, Sets, and Maps with mutate:true without throwing TypeError', async() =>
    {
        const { is, assertGuard } = await import( '../src/runtime/validators.js' );

        const checkObj = ( v: any, path: string, ctx: ValidationContext ) =>
        {
            const obj = validators.object( v, path, ctx );

            if( !obj ){ return v }

            const data = validators.objectShell( obj, ctx );
            validators.props( obj, data, path, ctx, [
                [ 'name', false, validators.string ],
                [ 'tags', false, ( x: any, p: string, c: ValidationContext ) => validators.array( x, p, c, validators.string ) ],
                [ 'pair', false, ( x: any, p: string, c: ValidationContext ) => validators.tuple( x, p, c, [ validators.string, validators.number ]) ]
            ]);

            return data;
        };

        const frozen = Object.freeze({
            name : 'Alice',
            tags : Object.freeze([ 'a', 'b' ]),
            pair : Object.freeze([ 'k', 1 ])
        });

        expect( is( checkObj, frozen )).toBe( true );
        expect(() => assertGuard( checkObj, frozen )).not.toThrow();

        const s = new Set([ 'a', 'b' ]);
        const m = new Map([[ 'k', 1 ]]);
        expect( is(( v: any, p: string, c: ValidationContext ) => validators.set( v, p, c, validators.string ), s )).toBe( true );
        expect( is(( v: any, p: string, c: ValidationContext ) => validators.map( v, p, c, validators.string, validators.number ), m )).toBe( true );
    });

    it( 'rejects async Custom validators returning a Promise instead of treating Promise as truthy', () =>
    {
        const ctx = context( 'bad' );
        const asyncCheck = async() => false;

        validators.custom( 'bad', 'field', ctx, asyncCheck );

        expect( ctx.success ).toBe( false );
        expect( ctx.errors[0].error ).toBe( 'AsyncCustomNotSupported<asyncCheck>' );
    });

    it( 'rejects unsafe float integers in BigInt coercion and accepts disjoint literal alternations in safeRegExp', async() =>
    {
        const { coerceBigInt } = await import( '../src/runtime/parse-runtime.js' );
        const ctx = { ...context(), from : 'query' as const };

        validators.bigint( 1e25, 'big', ctx );
        expect( ctx.success ).toBe( false );
        expect(() => coerceBigInt( 1e25, 'big' )).toThrow( /Type<bigint>/ );

        expect(() => validators.safeRegExp( '^(?:foo|bar)+$' )).not.toThrow();
        expect(() => validators.safeRegExp( '^(?:foo|far)+$' )).toThrow( /Unsafe regular expression/ );
    });
});
