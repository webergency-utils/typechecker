import { describe, it, expect } from 'vitest';
import { SerializationError } from '../src/runtime/serializer-runtime.js';
import { compileAndTransform, emitAndImport } from './helpers/compile.js';

describe( 'Serializer Fixes & Regressions', () =>
{
    it( 'rolls back dirty query parameters when an earlier union arm fails', async() =>
    {
        const mod = await emitAndImport<{
            toQuery : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            interface ArmA { kind: 'a'; firstField: string; sharedNum: number }
            interface ArmB { kind: 'b'; secondField: string; sharedNum: number }
            type UnionType = ArmA | ArmB;
            export const toQuery = ( v: UnionType ) => stringify<UnionType>( v, { format: 'query' } );
        `, 'temp_ser_union_rollback' );

        const result = mod.toQuery({
            kind        : 'b',
            secondField : 'hello',
            sharedNum   : 42
        });

        const params = new URLSearchParams( result );
        expect( params.get( 'kind' )).toBe( 'b' );
        expect( params.get( 'secondField' )).toBe( 'hello' );
        expect( params.get( 'sharedNum' )).toBe( '42' );
        expect( params.has( 'firstField' )).toBe( false );
    });

    it( 'validates query primitives and throws SerializationError on invalid values', async() =>
    {
        const mod = await emitAndImport<{
            toQuery : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            interface QueryData {
                num: number;
                flag: boolean;
                big: bigint;
                date: Date;
            }
            export const toQuery = ( v: QueryData ) => stringify<QueryData>( v, { format: 'query' } );
        `, 'temp_ser_primitive_validation' );

        // Valid query serialization
        const valid = mod.toQuery({
            num  : 123,
            flag : true,
            big  : 9007199254740991n,
            date : new Date( '2026-01-01T00:00:00.000Z' )
        });
        const params = new URLSearchParams( valid );
        expect( params.get( 'num' )).toBe( '123' );
        expect( params.get( 'flag' )).toBe( 'true' );
        expect( params.get( 'big' )).toBe( '9007199254740991' );
        expect( params.get( 'date' )).toBe( '2026-01-01T00:00:00.000Z' );

        // Invalid number (NaN and string)
        expect(() => mod.toQuery({ num : NaN, flag : true, big : 1n, date : new Date() }))
            .toThrow( /Type<number>/ );
        expect(() => mod.toQuery({ num : '123' as any, flag : true, big : 1n, date : new Date() }))
            .toThrow( /Type<number>/ );

        // Invalid boolean
        expect(() => mod.toQuery({ num : 1, flag : 'true' as any, big : 1n, date : new Date() }))
            .toThrow( /Type<boolean>/ );

        // Invalid Date
        expect(() => mod.toQuery({ num : 1, flag : true, big : 1n, date : new Date( 'invalid' )}))
            .toThrow( /Type<Date>/ );
    });

    it( 'compiles multiple required nested query objects in strict and relaxed mode without __keys collision', async() =>
    {
        const mod = await emitAndImport<{
            toStrict  : ( v: any ) => string
            toRelaxed : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            interface DbConfig { host: string; port: number }
            interface RedisConfig { host: string; port: number }
            interface AppConfig {
                db: DbConfig;
                redis: RedisConfig;
            }
            export const toStrict = ( v: AppConfig ) => stringify<AppConfig>( v, { format: 'query', mode: 'strict' } );
            export const toRelaxed = ( v: AppConfig ) => stringify<AppConfig>( v, { format: 'query', mode: 'relaxed' } );
        `, 'temp_ser_nested_query_keys' );

        const input = {
            db    : { host : 'localhost', port : 5432 },
            redis : { host : '127.0.0.1', port : 6379 }
        };

        const strictQs = mod.toStrict( input );
        const strictParams = new URLSearchParams( strictQs );
        expect( strictParams.get( 'db[host]' )).toBe( 'localhost' );
        expect( strictParams.get( 'db[port]' )).toBe( '5432' );
        expect( strictParams.get( 'redis[host]' )).toBe( '127.0.0.1' );
        expect( strictParams.get( 'redis[port]' )).toBe( '6379' );

        const relaxedQs = mod.toRelaxed( input );
        const relaxedParams = new URLSearchParams( relaxedQs );
        expect( relaxedParams.get( 'db[host]' )).toBe( 'localhost' );
        expect( relaxedParams.get( 'redis[port]' )).toBe( '6379' );
    });

    it( 'safely handles null and undefined when serializing tagged unions', async() =>
    {
        const mod = await emitAndImport<{
            toJson  : ( v: any ) => string
            toQuery : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            type Tagged = { kind: 'circle'; radius: number } | { kind: 'square'; side: number };
            export const toJson = ( v: Tagged ) => stringify<Tagged>( v );
            export const toQuery = ( v: Tagged ) => stringify<Tagged>( v, { format: 'query' } );
        `, 'temp_ser_tagged_null' );

        expect(() => mod.toJson( null as any )).toThrow( /Type<Tagged>/ );
        expect(() => mod.toJson( undefined as any )).toThrow( /Type<Tagged>/ );
        expect(() => mod.toQuery( null as any )).toThrow( /Type<Tagged>/ );
        expect(() => mod.toQuery( undefined as any )).toThrow( /Type<Tagged>/ );
    });

    it( 'includes exact array element index in serialization error paths', async() =>
    {
        const mod = await emitAndImport<{
            toJson : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            interface Member { name: string; age: number }
            interface Group { members: Member[] }
            export const toJson = ( v: Group ) => stringify<Group>( v );
        `, 'temp_ser_array_error_index' );

        const badGroup = {
            members : [
                { name : 'Alice', age : 25 },
                { name : 'Bob', age : 30 },
                { name : 'Charlie', age : 'not-a-number' as any }
            ]
        };

        expect(() => mod.toJson( badGroup )).toThrow( /members\[2\]\.age/ );
    });

    it( 'provides index to TransformContext during array element serialization transform', async() =>
    {
        const mod = await emitAndImport<{
            dump : ( v: any, transform: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            interface ListWrapper { items: string[] }
            export const dump = ( v: ListWrapper, transform: any ) => stringify<ListWrapper>( v, { transform } );
        `, 'temp_ser_array_transform_ctx' );

        const indices: number[] = [];
        const paths: string[] = [];

        mod.dump(
            { items : [ 'first', 'second', 'third' ] },
            ( val: any, ctx: any ) =>
            {
                if( typeof ctx.index === 'number' )
                {
                    indices.push( ctx.index );
                }

                if( typeof ctx.path === 'string' )
                {
                    paths.push( ctx.path );
                }

                return val;
            }
        );

        expect( indices ).toEqual([ 0, 1, 2 ]);
        expect( paths ).toContain( 'items[0]' );
        expect( paths ).toContain( 'items[1]' );
        expect( paths ).toContain( 'items[2]' );
    });

    it( 'throws a compile-time error when passing a recursive type to serializer or stringify', () =>
    {
        expect(() => compileAndTransform( `
            import { serializer } from '../src/index.js';
            interface TreeNode {
                value: number;
                children?: TreeNode[];
            }
            export const ser = serializer<TreeNode>();
        `, 'temp_ser_recursive_error' )).toThrow( /Recursive\/cyclic type .* is not supported by ahead-of-time serializer codegen/ );
    });

    it( 'evaluates more specific object shapes before empty {} in strip mode union serialization', async() =>
    {
        const mod = await emitAndImport<{
            dump : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            type UnionType = {} | { foo: string };
            export const dump = ( v: UnionType ) => stringify<UnionType>( v, { mode: 'strip' } );
        `, 'temp_ser_union_specificity_basic' );

        expect( mod.dump({ foo : 'bar' })).toBe( '{"foo":"bar"}' );
        expect( mod.dump({})).toBe( '{}' );
    });

    it( 'preserves all properties when serializing multi-property shapes in strip mode union', async() =>
    {
        const mod = await emitAndImport<{
            dump : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            type UnionType = {} | { foo: string } | { foo: string; bar: number };
            export const dump = ( v: UnionType ) => stringify<UnionType>( v, { mode: 'strip' } );
        `, 'temp_ser_union_specificity_multi' );

        expect( mod.dump({ foo : 'bar', bar : 42 })).toBe( '{"foo":"bar","bar":42}' );
        expect( mod.dump({ foo : 'bar' })).toBe( '{"foo":"bar"}' );
        expect( mod.dump({})).toBe( '{}' );
    });

    it( 'prioritizes declared property objects over index signatures and empty objects in union serializer', async() =>
    {
        const mod = await emitAndImport<{
            dump : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            type UnionType = {} | Record<string, number> | { foo: number; bar: number };
            export const dump = ( v: UnionType ) => stringify<UnionType>( v, { mode: 'strip' } );
        `, 'temp_ser_union_specificity_record' );

        expect( mod.dump({ foo : 1, bar : 2 })).toBe( '{"foo":1,"bar":2}' );
        expect( mod.dump({ other : 99 })).toBe( '{"other":99}' );
        expect( mod.dump({})).toBe( '{}' );
    });

    it( 'preserves more specific object shapes in query union serializer', async() =>
    {
        const mod = await emitAndImport<{
            toQuery : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            type UnionType = {} | { foo: string } | { foo: string; bar: number };
            export const toQuery = ( v: UnionType ) => stringify<UnionType>( v, { format: 'query', mode: 'strip' } );
        `, 'temp_ser_query_union_specificity' );

        const resMulti = mod.toQuery({ foo : 'hello', bar : 42 });
        const paramsMulti = new URLSearchParams( resMulti );
        expect( paramsMulti.get( 'foo' )).toBe( 'hello' );
        expect( paramsMulti.get( 'bar' )).toBe( '42' );

        const resSingle = mod.toQuery({ foo : 'hello' });
        const paramsSingle = new URLSearchParams( resSingle );
        expect( paramsSingle.get( 'foo' )).toBe( 'hello' );
        expect( paramsSingle.has( 'bar' )).toBe( false );

        expect( mod.toQuery({})).toBe( '' );
    });

    it( 'orders deeply nested unions with 1-property weight differences across 3 levels', async() =>
    {
        const mod = await emitAndImport<{
            dump : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';

            type Level3 =
                | {}
                | { p: boolean }
                | { p: boolean; q: boolean }
                | { p: boolean; q: boolean; r: boolean };

            type Level2 =
                | {}
                | { x: number }
                | { x: number; deep: Level3 }
                | { x: number; y: number; deep: Level3 };

            type Level1 =
                | {}
                | { a: string }
                | { a: string; inner: Level2 }
                | { a: string; b: string; inner: Level2 }
                | { a: string; b: string; c: string; inner: Level2 };

            export const dump = ( v: Level1 ) => stringify<Level1>( v, { mode: 'strip' } );
        `, 'temp_ser_deep_nested_weight_diff' );

        // 1. Full 10-property object across 3 levels (1004 -> 1003 -> 1003)
        const full = {
            a     : 'valA',
            b     : 'valB',
            c     : 'valC',
            inner : {
                x    : 1,
                y    : 2,
                deep : { p : true, q : false, r : true }
            }
        };
        expect( JSON.parse( mod.dump( full ))).toEqual( full );

        // 2. Intermediate weights at each level: Level1 (1003), Level2 (1002), Level3 (1002)
        const mid = {
            a     : 'valA',
            b     : 'valB',
            inner : {
                x    : 10,
                deep : { p : true, q : true }
            }
        };
        expect( JSON.parse( mod.dump( mid ))).toEqual( mid );

        // 3. Minimal weights at each level: Level1 (1002), Level2 (1001), Level3 (1001)
        const minimalInner = {
            a     : 'valA',
            inner : {
                x    : 42,
                deep : { p : false }
            }
        };
        expect( JSON.parse( mod.dump( minimalInner ))).toEqual( minimalInner );

        // 4. Level1 single property (1001)
        expect( JSON.parse( mod.dump({ a : 'onlyA' }))).toEqual({ a : 'onlyA' });

        // 5. Level1 empty object (0)
        expect( mod.dump({})).toBe( '{}' );
    });

    it( 'orders union arms with fine-grained 1-property weight increments in reverse declaration order', async() =>
    {
        const mod = await emitAndImport<{
            dump : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';

            type Shape0 = {};
            type Shape1 = { a: string };
            type Shape2 = { a: string; b: string };
            type Shape3 = { a: string; b: string; c: string };
            type Shape4 = { a: string; b: string; c: string; d: string };

            // Declared from least specific (0) to most specific (1004)
            type UnionAscending = Shape0 | Shape1 | Shape2 | Shape3 | Shape4;

            export const dump = ( v: UnionAscending ) => stringify<UnionAscending>( v, { mode: 'strip' } );
        `, 'temp_ser_ascending_weight_diff' );

        expect( JSON.parse( mod.dump({ a : '1', b : '2', c : '3', d : '4' }))).toEqual({ a : '1', b : '2', c : '3', d : '4' });
        expect( JSON.parse( mod.dump({ a : '1', b : '2', c : '3' }))).toEqual({ a : '1', b : '2', c : '3' });
        expect( JSON.parse( mod.dump({ a : '1', b : '2' }))).toEqual({ a : '1', b : '2' });
        expect( JSON.parse( mod.dump({ a : '1' }))).toEqual({ a : '1' });
        expect( mod.dump({})).toBe( '{}' );
    });

    it( 'correctly serializes arrays of objects with varying union specificity weights', async() =>
    {
        const mod = await emitAndImport<{
            dump : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';

            type ItemUnion =
                | {}
                | { id: string }
                | { id: string; name: string }
                | { id: string; name: string; extra: string };

            interface Container {
                items: ItemUnion[];
            }

            export const dump = ( v: Container ) => stringify<Container>( v, { mode: 'strip' } );
        `, 'temp_ser_array_nested_union_weights' );

        const input = {
            items : [
                { id : '1', name : 'A', extra : 'X' },
                { id : '2', name : 'B' },
                { id : '3' },
                {}
            ]
        };

        const result = JSON.parse( mod.dump( input ));
        expect( result ).toEqual( input );
    });

    it( 'handles nested query unions with fine-grained weight differences without key collision or parameter leakage', async() =>
    {
        const mod = await emitAndImport<{
            toQuery : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';

            type SubFilter =
                | {}
                | { tag: string }
                | { tag: string; priority: number };

            type QueryPayload =
                | {}
                | { status: string }
                | { status: string; sub: SubFilter }
                | { status: string; sub: SubFilter; limit: number };

            export const toQuery = ( v: QueryPayload ) => stringify<QueryPayload>( v, { format: 'query', mode: 'strip' } );
        `, 'temp_ser_query_deep_nested_weights' );

        // 1. Full payload (1003 -> 1002)
        const qFull = mod.toQuery({
            status : 'active',
            sub    : { tag : 'critical', priority : 1 },
            limit  : 50
        });
        const pFull = new URLSearchParams( qFull );
        expect( pFull.get( 'status' )).toBe( 'active' );
        expect( pFull.get( 'sub[tag]' )).toBe( 'critical' );
        expect( pFull.get( 'sub[priority]' )).toBe( '1' );
        expect( pFull.get( 'limit' )).toBe( '50' );

        // 2. Partial payload: 2 outer props (1002), 1 inner prop (1001)
        const qMid = mod.toQuery({
            status : 'active',
            sub    : { tag : 'normal' }
        });
        const pMid = new URLSearchParams( qMid );
        expect( pMid.get( 'status' )).toBe( 'active' );
        expect( pMid.get( 'sub[tag]' )).toBe( 'normal' );
        expect( pMid.has( 'sub[priority]' )).toBe( false );
        expect( pMid.has( 'limit' )).toBe( false );

        // 3. Single outer prop (1001)
        const qSingle = mod.toQuery({ status : 'pending' });
        const pSingle = new URLSearchParams( qSingle );
        expect( pSingle.get( 'status' )).toBe( 'pending' );
        expect( pSingle.has( 'sub' )).toBe( false );
        expect( pSingle.has( 'limit' )).toBe( false );

        // 4. Empty outer (0)
        expect( mod.toQuery({})).toBe( '' );
    });

    it( 'differentiates between index signatures and declared property counts in nested structures', async() =>
    {
        const mod = await emitAndImport<{
            dump : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';

            type NestedPayload =
                | {}
                | Record<string, string>
                | { fixed: string }
                | { fixed: string; second: string };

            interface Wrapper {
                config: NestedPayload;
            }

            export const dump = ( v: Wrapper ) => stringify<Wrapper>( v, { mode: 'strip' } );
        `, 'temp_ser_nested_index_vs_props' );

        // 1002: fixed + second
        expect( JSON.parse( mod.dump({ config : { fixed : 'a', second : 'b' }}))).toEqual({
            config : { fixed : 'a', second : 'b' }
        });

        // 1001: fixed
        expect( JSON.parse( mod.dump({ config : { fixed : 'a' }}))).toEqual({
            config : { fixed : 'a' }
        });

        // 500: arbitrary index properties
        expect( JSON.parse( mod.dump({ config : { customKey1 : 'v1', customKey2 : 'v2' }}))).toEqual({
            config : { customKey1 : 'v1', customKey2 : 'v2' }
        });

        // 0: empty
        expect( JSON.parse( mod.dump({ config : {}}))).toEqual({
            config : {}
        });
    });
});
