import { describe, it, expect } from 'vitest';
import
{
    serializeString,
    serializeDate,
    serializeBuffer,
    serializeArray,
    SerializationError
}
from '../runtime/serializer-runtime.js';
import { generateSerializerCode } from '../engine/serializer-generator.js';
import { compileAndTransform, emitAndImport } from './helpers/compile.js';
import { serializer, stringify } from '../index.js';
import { buildSerializer } from '../transformer.js';
import ts from 'typescript';

describe( 'Serializer & Stringify', () =>
{
    const compile = ( code: string ) => compileAndTransform( code, 'temp_serializer_test' );

    describe( 'Untransformed stubs', () =>
    {
        it( 'throws when transformer was not applied', () =>
        {
            expect( () => serializer()).toThrow( 'Typechecker transformer was not applied' );
            expect( () => stringify( {} )).toThrow( 'Typechecker transformer was not applied' );
        });
    });

    describe( 'Runtime helpers', () =>
    {
        describe( 'serializeString', () =>
        {
            it( 'serializes strings with JSON escaping', () =>
            {
                expect( serializeString( 'hello' )).toBe( '"hello"' );
                expect( serializeString( 'hello "world"' )).toBe( '"hello \\"world\\""' );
                expect( serializeString( 'line1\nline2\ttab' )).toBe( '"line1\\nline2\\ttab"' );
            });

            it( 'throws SerializationError with path for non-strings', () =>
            {
                expect( () => serializeString( 123 as any, 'user.name' )).toThrow( SerializationError );
                expect( () => serializeString( 123 as any, 'user.name' )).toThrow( 'Serialization error at "user.name": Type<string>' );
            });
        });

        describe( 'serializeDate', () =>
        {
            it( 'serializes Date, ISO string, and epoch number', () =>
            {
                const d = new Date( '2026-07-30T10:00:00.000Z' );

                expect( serializeDate( d )).toBe( '"2026-07-30T10:00:00.000Z"' );
                expect( serializeDate( '2026-07-30T10:00:00.000Z' )).toBe( '"2026-07-30T10:00:00.000Z"' );
                expect( serializeDate( d.getTime())).toBe( '"2026-07-30T10:00:00.000Z"' );
                expect( serializeDate( '2026-07-30' )).toBe( '"2026-07-30T00:00:00.000Z"' );
            });

            it( 'throws for invalid Date values', () =>
            {
                expect( () => serializeDate( new Date( NaN ), 'createdAt' )).toThrow( 'Serialization error at "createdAt": Type<Date>' );
                expect( () => serializeDate( 'invalid-date' )).toThrow( SerializationError );
                expect( () => serializeDate( {} as any )).toThrow( SerializationError );
            });
        });

        describe( 'serializeBuffer', () =>
        {
            it( 'serializes Buffer / Uint8Array / ArrayBuffer to base64 JSON', () =>
            {
                expect( serializeBuffer( Buffer.from( 'hello' ))).toBe( '"aGVsbG8="' );
                expect( serializeBuffer( Uint8Array.from([ 104, 101, 108, 108, 111 ]))).toBe( '"aGVsbG8="' );
                expect( serializeBuffer( Uint8Array.from([ 104, 101, 108, 108, 111 ]).buffer )).toBe( '"aGVsbG8="' );
            });

            it( 'throws for invalid buffer input', () =>
            {
                expect( () => serializeBuffer( 'not-a-buffer' as any, 'blob' )).toThrow( 'Serialization error at "blob"' );
            });
        });

        describe( 'serializeArray', () =>
        {
            it( 'maps elements and joins as JSON array', () =>
            {
                expect( serializeArray([ 1, 2, 3 ], n => String( n ))).toBe( '[1,2,3]' );
            });

            it( 'throws for non-array input', () =>
            {
                expect( () => serializeArray( 'nope' as any, v => v, 'items' )).toThrow( 'Serialization error at "items": Type<Array>' );
            });
        });

        describe( 'SerializationError', () =>
        {
            it( 'preserves path and formats message', () =>
            {
                const withPath = new SerializationError( 'user.email', 'Invalid format' );
                expect( withPath.path ).toBe( 'user.email' );
                expect( withPath.message ).toBe( 'Serialization error at "user.email": Invalid format' );

                const root = new SerializationError( '', 'Type<Object>' );
                expect( root.path ).toBe( '' );
                expect( root.message ).toBe( 'Type<Object>' );
            });
        });
    });

    describe( 'Generator (dummy checker)', () =>
    {
        function createDummyTypeChecker( typeFlags: ts.TypeFlags, isArray = false, isUnion = false, isObject = false )
        {
            const dummyType: any =
            {
                getFlags      : () => typeFlags,
                isUnion       : () => isUnion,
                getProperties : () => isObject
                    ? [
                        { getName : () => 'id', flags : 0 },
                        { getName : () => 'name', flags : 0 }
                    ]
                    : []
            };

            const checker: any =
            {
                isArrayType       : () => isArray,
                getTypeArguments  : () => [{ getFlags : () => ts.TypeFlags.Number, isUnion : () => false }],
                getPropertyOfType : () => ({ flags : 0 })
            };

            return { dummyType, checker };
        }

        it( 'emits string / number / array serializers', () =>
        {
            expect( generateSerializerCode( createDummyTypeChecker( ts.TypeFlags.String ).dummyType, createDummyTypeChecker( ts.TypeFlags.String ).checker ))
                .toContain( '__tcRuntime.serializeString' );

            const { dummyType : numType, checker : numChecker } = createDummyTypeChecker( ts.TypeFlags.Number );
            expect( generateSerializerCode( numType, numChecker )).toContain( "typeof input === 'number'" );

            const { dummyType : arrType, checker : arrChecker } = createDummyTypeChecker( ts.TypeFlags.Object, true );
            expect( generateSerializerCode( arrType, arrChecker )).toContain( '__tcRuntime.serializeArray' );
        });

        it( 'emits strict and relaxed extra-property handling', () =>
        {
            const { dummyType, checker } = createDummyTypeChecker( ts.TypeFlags.Object, false, false, true );

            expect( generateSerializerCode( dummyType, checker, { mode : 'strict' }))
                .toContain( 'PropertyNotAllowed<' );
            expect( generateSerializerCode( dummyType, checker, { mode : 'relaxed' }))
                .toContain( 'JSON.stringify( obj[k] )' );
        });

        it( 'buildSerializer caches by type + mode + format', () =>
        {
            const dummyType: any = { getFlags : () => ts.TypeFlags.String };
            const map = new Map<string, ts.Expression>();
            const ref = buildSerializer( dummyType, {} as any, map, 'hash_ser', { mode : 'strip', format : 'json' });

            expect( ref ).toBeDefined();
            expect( map.has( 'hash_ser_strip_json' )).toBe( true );
            expect( ts.isIdentifier( ref ) && ref.text ).toBe( '__ser_hash_ser_strip_json' );
        });
    });

    describe( 'Transform (AST)', () =>
    {
        it( 'hoists runtime import and serializer local for serializer-only files', () =>
        {
            const code = compile( `
                import { serializer } from './src/index.js';
                interface User { id: string; name: string; email?: string }
                export const ser = serializer<User>();
            ` );

            expect( code ).toContain( '@webergency-utils/typechecker/runtime' );
            expect( code ).toContain( '__ser_' );
            expect( code ).toContain( '__tcRuntime.serializeString' );
            expect( code ).toContain( 'Type<Object>' );
        });

        it( 'compiles strict / strip / relaxed JSON modes', () =>
        {
            const strict = compile( `
                import { stringify } from './src/index.js';
                interface Target { key: string }
                export function run( val: Target ) { return stringify<Target>( val, { mode: 'strict' } ); }
            ` );
            expect( strict ).toContain( 'PropertyNotAllowed<' );

            const strip = compile( `
                import { stringify } from './src/index.js';
                interface Target { key: string }
                export function run( val: Target ) { return stringify<Target>( val, 'strip' ); }
            ` );
            expect( strip ).not.toContain( 'PropertyNotAllowed<' );

            const relaxed = compile( `
                import { stringify } from './src/index.js';
                interface Target { key: string }
                export function run( val: Target ) { return stringify<Target>( val, { mode: 'relaxed' } ); }
            ` );
            expect( relaxed ).toContain( 'JSON.stringify' );
            expect( relaxed ).toContain( '__keys.has' );
        });

        it( 'compiles nested arrays, unions, Buffer, and Date', () =>
        {
            const nested = compile( `
                import { stringify } from './src/index.js';
                interface Item { name: string }
                interface Cart { items: Item[]; createdAt: Date; blob: Buffer }
                export function run( c: Cart ) { return stringify<Cart>( c ); }
            ` );
            expect( nested ).toContain( '__tcRuntime.serializeArray' );
            expect( nested ).toContain( '__tcRuntime.serializeDate' );
            expect( nested ).toContain( '__tcRuntime.serializeBuffer' );

            const union = compile( `
                import { stringify } from './src/index.js';
                type Value = string | number;
                export function run( v: Value ) { return stringify<Value>( v ); }
            ` );
            expect( union ).toContain( 'serializeUnion' );
            expect( union ).toMatch( /Type<(Value|Union)>/ );
        });

        it( 'compiles query serializers for format/to aliases and modes', () =>
        {
            const query = compile( `
                import { stringify } from './src/index.js';
                interface Search { q: string; page: number; tags: string[] }
                export function run( s: Search ) { return stringify<Search>( s, { format: 'query' } ); }
            ` );
            expect( query ).toContain( 'encodeURIComponent' );
            expect( query ).toContain( 'params.join' );

            const toAlias = compile( `
                import { serializer } from './src/index.js';
                interface QueryData { id: number }
                export const ser = serializer<QueryData>({ to: 'query', mode: 'strict' });
            ` );
            expect( toAlias ).toContain( 'PropertyNotAllowed<' );

            const relaxed = compile( `
                import { stringify } from './src/index.js';
                interface BaseQuery { page: number }
                export function run( q: BaseQuery ) { return stringify<BaseQuery>( q, { format: 'query', mode: 'relaxed' } ); }
            ` );
            expect( relaxed ).toContain( 'encodeURIComponent' );
            expect( relaxed ).toContain( '__keys.has' );
        });
        it( 'compiles namespace imports and bare mode string options', () =>
        {
            const ns = compile( `
                import * as tc from './src/index.js';
                interface Row { id: string }
                export const ser = tc.serializer<Row>( 'relaxed' );
                export function run( v: Row ) { return tc.stringify<Row>( v, 'strict' ); }
            ` );
            expect( ns ).toContain( '__ser_' );
            expect( ns ).toContain( 'PropertyNotAllowed<' );

            const both = compile( `
                import { stringify } from './src/index.js';
                interface Row { id: string }
                export function run( v: Row ) { return stringify<Row>( v, { mode: 'strip', format: 'json', to: 'json' } ); }
            ` );
            expect( both ).toContain( '__ser_' );
        });
    });

    describe( 'E2E emitAndImport', () =>
    {
        it( 'round-trips JSON objects with modes, optionals, and nested arrays', async() =>
        {
            const mod = await emitAndImport<{
                dump     : ( v: any ) => string
                dumpStrict : ( v: any ) => string
                dumpRelaxed : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                interface User { id: string; age: number; active: boolean; email?: string }
                interface Cart { items: { name: string }[] }
                export const dump = ( v: User ) => stringify<User>( v );
                export const dumpStrict = ( v: User ) => stringify<User>( v, { mode: 'strict' } );
                export const dumpRelaxed = ( v: User & { extra?: number } ) => stringify<User>( v as User, { mode: 'relaxed' } );
            `, 'temp_ser_e2e_json' );

            expect( JSON.parse( mod.dump({ id : '1', age : 30, active : true }))).toEqual({
                id : '1', age : 30, active : true
            });
            expect( JSON.parse( mod.dump({ id : '1', age : 30, active : false, email : 'a@b.c' }))).toEqual({
                id : '1', age : 30, active : false, email : 'a@b.c'
            });
            expect( mod.dump({ id : '1', age : 30, active : true, email : undefined } as any )).not.toContain( 'email' );

            expect( () => mod.dumpStrict({ id : '1', age : 30, active : true, rogue : true } as any ))
                .toThrow( /PropertyNotAllowed<rogue>/ );

            const relaxed = JSON.parse( mod.dumpRelaxed({ id : '1', age : 30, active : true, extra : 9 } as any ));
            expect( relaxed.extra ).toBe( 9 );
        });

        it( 'serializes Date, Buffer, unions, and missing required fields', async() =>
        {
            const mod = await emitAndImport<{
                dumpPayload : ( v: any ) => string
                dumpUnion   : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                interface Payload { createdAt: Date; blob: Buffer; label: string }
                type Value = string | number;
                export const dumpPayload = ( v: Payload ) => stringify<Payload>( v );
                export const dumpUnion = ( v: Value ) => stringify<Value>( v );
            `, 'temp_ser_e2e_exotic' );

            const json = JSON.parse( mod.dumpPayload({
                createdAt : new Date( '2026-01-01T00:00:00.000Z' ),
                blob      : Buffer.from( 'hello' ),
                label     : 'x'
            }));
            expect( json ).toEqual({
                createdAt : '2026-01-01T00:00:00.000Z',
                blob      : 'aGVsbG8=',
                label     : 'x'
            });

            expect( mod.dumpUnion( 'hi' )).toBe( '"hi"' );
            expect( mod.dumpUnion( 42 )).toBe( '42' );
            expect( () => mod.dumpUnion( true as any )).toThrow( /Type<(Value|Union)>/ );
            expect( () => mod.dumpPayload({ blob : Buffer.from( 'x' ), label : 'y' } as any ))
                .toThrow( /Type<Date>/ );
        });

        it( 'serializes query strings with arrays, nested keys, and Date ISO', async() =>
        {
            const mod = await emitAndImport<{
                toQuery : ( v: any ) => string
                ser     : ( v: any ) => string
            }>( `
                import { stringify, serializer } from '../src/index.js';
                interface Search {
                    q: string;
                    page: number;
                    tags: string[];
                    filter?: { category: string };
                    since?: Date;
                }
                export const toQuery = ( v: Search ) => stringify<Search>( v, { format: 'query' } );
                export const ser = serializer<Search>({ to: 'query', mode: 'strict' });
            `, 'temp_ser_e2e_query' );

            const qs = mod.toQuery({
                q      : 'hello world',
                page   : 2,
                tags   : [ 'a', 'b' ],
                filter : { category : 'books' },
                since  : new Date( '2026-06-01T00:00:00.000Z' )
            });
            const params = new URLSearchParams( qs );
            expect( params.get( 'q' )).toBe( 'hello world' );
            expect( params.get( 'page' )).toBe( '2' );
            expect( params.getAll( 'tags[]' )).toEqual([ 'a', 'b' ]);
            expect( params.get( 'filter[category]' )).toBe( 'books' );
            expect( params.get( 'since' )).toBe( '2026-06-01T00:00:00.000Z' );

            expect( () => mod.ser({ q : 'x', page : 1, tags : [], rogue : 1 } as any ))
                .toThrow( /PropertyNotAllowed<rogue>/ );
        });

        it( 'reuses serializer factory from serializer<T>()', async() =>
        {
            const mod = await emitAndImport<{
                ser : ( v: { id: string } ) => string
            }>( `
                import { serializer } from '../src/index.js';
                interface Row { id: string }
                export const ser = serializer<Row>();
            `, 'temp_ser_e2e_factory' );

            expect( mod.ser({ id : 'abc' })).toBe( '{"id":"abc"}' );
        });

        it( 'serializes literals, tuples, and tagged unions', async() =>
        {
            const mod = await emitAndImport<{
                dumpLit : ( v: any ) => string
                dumpTup : ( v: any ) => string
                dumpTag : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                type Status = 'on' | 'off';
                type Pair = [string, number];
                type Shape =
                    | { kind: 'circle'; r: number }
                    | { kind: 'square'; s: number };
                export const dumpLit = ( v: Status ) => stringify<Status>( v );
                export const dumpTup = ( v: Pair ) => stringify<Pair>( v );
                export const dumpTag = ( v: Shape ) => stringify<Shape>( v );
            `, 'temp_ser_e2e_parity' );

            expect( mod.dumpLit( 'on' )).toBe( '"on"' );
            expect( () => mod.dumpLit( 'maybe' as any )).toThrow( /Type<(Status|Union|'on'|'off'|Literal)/ );
            expect( mod.dumpTup([ 'a', 1 ])).toBe( '["a",1]' );
            expect( () => mod.dumpTup([ 'a' ] as any )).toThrow( /Tuple<2>/ );
            expect( JSON.parse( mod.dumpTag({ kind : 'circle', r : 2 }))).toEqual({ kind : 'circle', r : 2 });
            expect( () => mod.dumpTag({ kind : 'triangle', r : 1 } as any )).toThrow( /Type<(Shape|Union)>/ );
        });

        it( 'serializes Record and branded strings', async() =>
        {
            const mod = await emitAndImport<{
                dumpRec   : ( v: any ) => string
                dumpBrand : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                type Scores = Record<string, number>;
                type UserId = string & { __brand: 'UserId' };
                export const dumpRec = ( v: Scores ) => stringify<Scores>( v );
                export const dumpBrand = ( v: UserId ) => stringify<UserId>( v );
            `, 'temp_ser_e2e_record' );

            expect( JSON.parse( mod.dumpRec({ a : 1, b : 2 }))).toEqual({ a : 1, b : 2 });
            expect( mod.dumpBrand( 'uid-1' as any )).toBe( '"uid-1"' );
        });

        it( 'serializes deep query nests and rejects NaN', async() =>
        {
            const mod = await emitAndImport<{
                dumpDeep : ( v: any ) => string
                dumpNum  : ( v: any ) => string
            }>( `
                import { stringify } from '../src/index.js';
                interface Cart { items: { name: string; qty: number }[] }
                export const dumpDeep = ( v: Cart ) => stringify<Cart>( v, { format: 'query' } );
                export const dumpNum = ( v: number ) => stringify<number>( v );
            `, 'temp_ser_e2e_deep' );

            const qs = mod.dumpDeep({ items : [{ name : 'a', qty : 2 }, { name : 'b', qty : 3 }] });
            expect( qs ).toContain( 'items' );
            expect( qs ).toContain( 'name' );
            expect( qs ).toContain( 'qty' );
            expect( mod.dumpNum( Infinity )).toBe( 'Infinity' );
            expect( () => mod.dumpNum( NaN )).toThrow( /Type<number>/ );
        });
    });
});
