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
});
