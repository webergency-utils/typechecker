import { describe, it, expect } from 'vitest';
import { parseQueryString } from '../src/runtime/parse-runtime.js';
import { compileAndTransform, emitAndImport } from './helpers/compile.js';

describe( 'Parse Fixes & Regressions', () =>
{
    it( 'omits absent optional properties so they are not present as undefined on the result', async() =>
    {
        const mod = await emitAndImport<{
            parseJson  : ( json: string ) => any
            parseQuery : ( qs: string ) => any
        }>( `
            import { parse } from '../src/index.js';
            interface Profile {
                id: string;
                bio?: string;
                age?: number;
            }
            export const parseJson = ( json: string ) => parse<Profile>( json );
            export const parseQuery = ( qs: string ) => parse<Profile>( qs, { from: 'query' } );
        `, 'temp_parse_absent_optionals' );

        // JSON parsing
        const jsonResult = mod.parseJson( '{"id":"usr_1"}' );
        expect( jsonResult ).toEqual({ id : 'usr_1' });
        expect( 'bio' in jsonResult ).toBe( false );
        expect( 'age' in jsonResult ).toBe( false );
        expect( Object.keys( jsonResult )).toEqual([ 'id' ]);

        const jsonWithOpt = mod.parseJson( '{"id":"usr_2","bio":"hello"}' );
        expect( jsonWithOpt ).toEqual({ id : 'usr_2', bio : 'hello' });
        expect( 'bio' in jsonWithOpt ).toBe( true );
        expect( 'age' in jsonWithOpt ).toBe( false );
        expect( Object.keys( jsonWithOpt )).toEqual([ 'id', 'bio' ]);

        // Query parsing
        const queryResult = mod.parseQuery( 'id=usr_3' );
        expect( queryResult ).toEqual({ id : 'usr_3' });
        expect( 'bio' in queryResult ).toBe( false );
        expect( 'age' in queryResult ).toBe( false );
        expect( Object.keys( queryResult )).toEqual([ 'id' ]);

        const queryWithOpt = mod.parseQuery( 'id=usr_4&age=28' );
        expect( queryWithOpt ).toEqual({ id : 'usr_4', age : 28 });
        expect( 'age' in queryWithOpt ).toBe( true );
        expect( 'bio' in queryWithOpt ).toBe( false );
    });

    it( 'parses query strings with large numeric index sets without call stack overflow', () =>
    {
        // Construct query string with 150,000 array indices
        const parts: string[] = [];
        const count = 150000;

        for( let i = 0; i < 20; i++ )
        {
            parts.push( `arr[${i}]=${i}` );
        }
        parts.push( `arr[${count}]=last` );

        const qs = parts.join( '&' );
        const result: any = parseQueryString( qs );

        expect( Array.isArray( result.arr )).toBe( true );
        expect( result.arr[0]).toBe( '0' );
        expect( result.arr[count]).toBe( 'last' );
    });

    it( 'supports string literal keys and shorthand property assignments in transformer options', async() =>
    {
        const mod = await emitAndImport<{
            parseWithQuotedKeys     : ( qs: string ) => any
            parseWithShorthand      : ( qs: string ) => any
            serializeWithQuotedKeys : ( v: any ) => string
        }>( `
            import { parse, stringify } from '../src/index.js';
            interface SearchReq {
                query: string;
                limit: number;
            }
            const mode = 'strict' as const;
            const from = 'query' as const;
            export const parseWithQuotedKeys = ( qs: string ) =>
                parse<SearchReq>( qs, { "from": "query", "mode": "strict" } );
            export const parseWithShorthand = ( qs: string ) =>
                parse<SearchReq>( qs, { mode, from } );
            export const serializeWithQuotedKeys = ( v: SearchReq ) =>
                stringify<SearchReq>( v, { "format": "query", "mode": "strict" } );
        `, 'temp_parse_options_keys' );

        const parsed1 = mod.parseWithQuotedKeys( 'query=shoes&limit=10' );
        expect( parsed1 ).toEqual({ query : 'shoes', limit : 10 });
        expect(() => mod.parseWithQuotedKeys( 'query=shoes&limit=10&extra=bad' ))
            .toThrow( /PropertyNotAllowed<extra>/ );

        const parsed2 = mod.parseWithShorthand( 'query=boots&limit=25' );
        expect( parsed2 ).toEqual({ query : 'boots', limit : 25 });
        expect(() => mod.parseWithShorthand( 'query=boots&limit=25&rogue=bad' ))
            .toThrow( /PropertyNotAllowed<rogue>/ );

        const serialized = mod.serializeWithQuotedKeys({ query : 'hats', limit : 5 });
        const params = new URLSearchParams( serialized );
        expect( params.get( 'query' )).toBe( 'hats' );
        expect( params.get( 'limit' )).toBe( '5' );
    });

    it( 'throws a compile-time error when passing a recursive type to parse', () =>
    {
        expect(() => compileAndTransform( `
            import { parse } from '../src/index.js';
            interface LinkedListNode {
                val: number;
                next?: LinkedListNode;
            }
            export const run = ( json: string ) => parse<LinkedListNode>( json );
        `, 'temp_parse_recursive_error' )).toThrow( /Recursive\/cyclic type .* is not supported by ahead-of-time parser codegen/ );
    });

    it( 'enforces BigIntLiteral equality including negative literals and unions in JSON and query modes', async() =>
    {
        const mod = await emitAndImport<{
            parseTen     : ( json: string ) => bigint
            parseTenQ    : ( qs: string ) => { n : bigint }
            parseNeg     : ( json: string ) => bigint
            parseUnion   : ( json: string ) => bigint
        }>( `
            import { parse } from '../src/index.js';
            export const parseTen = ( json: string ) => parse<10n>( json );
            export const parseTenQ = ( qs: string ) => parse<{ n: 10n }>( qs, { from: 'query' } );
            export const parseNeg = ( json: string ) => parse<-42n>( json );
            export const parseUnion = ( json: string ) => parse<1n | 2n>( json );
        `, 'temp_parse_bigint_literal' );

        expect( mod.parseTen( '"10"' )).toBe( 10n );
        expect( mod.parseTen( '10' )).toBe( 10n );
        expect(() => mod.parseTen( '"11"' )).toThrow( /Literal<10n>/ );
        expect(() => mod.parseTen( '11' )).toThrow( /Literal<10n>/ );

        expect( mod.parseTenQ( 'n=10' )).toEqual({ n : 10n });
        expect(() => mod.parseTenQ( 'n=11' )).toThrow( /Literal<10n>/ );

        expect( mod.parseNeg( '"-42"' )).toBe( -42n );
        expect(() => mod.parseNeg( '"42"' )).toThrow( /Literal<-42n>/ );

        expect( mod.parseUnion( '"1"' )).toBe( 1n );
        expect( mod.parseUnion( '"2"' )).toBe( 2n );
        expect(() => mod.parseUnion( '"3"' )).toThrow();
    });

    it( 'preserves all arms and invokes tag/constraint/transform hooks on multi-arm tagged object intersections', async() =>
    {
        const mod = await emitAndImport<{
            parseTwoJson    : ( json: string, transform?: any ) => any
            parseTwoQuery   : ( qs: string, transform?: any ) => any
            parseThreeJson  : ( json: string, transform?: any ) => any
        }>( `
            import { parse, tag, constraint, transform } from '../src/index.js';
            interface A { a: string }
            interface B { b: number }
            interface C { c: boolean }
            function checkSum( v: A & B ): boolean { return v.a.length + v.b > 2; }
            function enrichA( v: A & B ): A & B { return { ...v, a: v.a.trim() }; }
            type MergedTwo = A & B & tag<'audit'> & constraint.Custom<typeof checkSum> & transform.Custom<typeof enrichA>;
            type MergedThree = A & B & C & tag<'tri'>;
            export const parseTwoJson = ( json: string, tf?: any ) => parse<MergedTwo>( json, { transform: tf } );
            export const parseTwoQuery = ( qs: string, tf?: any ) => parse<MergedTwo>( qs, { from: 'query', transform: tf } );
            export const parseThreeJson = ( json: string, tf?: any ) => parse<MergedThree>( json, { transform: tf } );
        `, 'temp_parse_multi_arm_tagged_intersection' );

        const seenTags: string[][] = [];
        const resJson = mod.parseTwoJson( '{"a":"  hi  ","b":5}', ( val: any, ctx: any ) =>
        {
            if( ctx.tags.length > 0 ){ seenTags.push( ctx.tags ) }

            return val;
        });
        expect( resJson ).toEqual({ a : 'hi', b : 5 });
        expect( seenTags ).toContainEqual([ 'audit' ]);

        const resQuery = mod.parseTwoQuery( 'a=%20ok%20&b=3', ( val: any, ctx: any ) =>
        {
            if( ctx.tags.length > 0 ){ seenTags.push( ctx.tags ) }

            return val;
        });
        expect( resQuery ).toEqual({ a : 'ok', b : 3 });

        expect(() => mod.parseTwoJson( '{"a":"x","b":1}' )).toThrow( /Custom/ );

        const seenThree: string[][] = [];
        const resThree = mod.parseThreeJson( '{"a":"x","b":2,"c":true}', ( val: any, ctx: any ) =>
        {
            if( ctx.tags.length > 0 ){ seenThree.push( ctx.tags ) }

            return val;
        });
        expect( resThree ).toEqual({ a : 'x', b : 2, c : true });
        expect( seenThree ).toContainEqual([ 'tri' ]);
    });

    it( 'parses Set<T> and Map<K, V> in JSON and query modes with constraints, tags, and exact error paths', async() =>
    {
        const mod = await emitAndImport<{
            parseSetStr       : ( json: string ) => Set<string>
            parseSetCon       : ( json: string ) => Set<number>
            parseSetQuery     : ( qs: string ) => { tags : Set<string> }
            parseMapStrNum    : ( json: string ) => Map<string, number>
            parseMapNumBool   : ( json: string ) => Map<number, boolean>
            parseMapLit       : ( json: string ) => Map<'a' | 'b', string>
            parseNested       : ( json: string ) => Map<string, Set<number>>
            parseRootMapQuery : ( qs: string ) => Map<string, string>
            parseTaggedSet    : ( json: string, tf?: any ) => Set<string>
            parseTaggedMap    : ( json: string, tf?: any ) => Map<string, number>
        }>( `
            import { parse, constraint, tag } from '../src/index.js';
            type ConstrainedSet = Set<number & constraint.Minimum<0>> & constraint.MinItems<1>;
            export const parseSetStr = ( json: string ) => parse<Set<string>>( json );
            export const parseSetCon = ( json: string ) => parse<ConstrainedSet>( json );
            export const parseSetQuery = ( qs: string ) => parse<{ tags: Set<string> }>( qs, { from: 'query' } );
            export const parseMapStrNum = ( json: string ) => parse<Map<string, number>>( json );
            export const parseMapNumBool = ( json: string ) => parse<Map<number, boolean>>( json );
            export const parseMapLit = ( json: string ) => parse<Map<'a' | 'b', string>>( json );
            export const parseNested = ( json: string ) => parse<Map<string, Set<number>>>( json );
            export const parseRootMapQuery = ( qs: string ) => parse<Map<string, string>>( qs, { from: 'query' } );
            export const parseTaggedSet = ( json: string, tf?: any ) =>
                parse<Set<string> & tag<'mySet'>>( json, { transform: tf } );
            export const parseTaggedMap = ( json: string, tf?: any ) =>
                parse<Map<string, number> & tag<'myMap'>>( json, { transform: tf } );
        `, 'temp_parse_set_map' );

        // Set<string> & empty Set
        expect( mod.parseSetStr( '["a","b","a"]' )).toEqual( new Set([ 'a', 'b' ]));
        expect( mod.parseSetStr( '[]' )).toEqual( new Set());
        expect(() => mod.parseSetStr( '{}' )).toThrow( /Type<Set>/ );
        expect(() => mod.parseSetStr( '["ok", 123]' )).toThrow( /"\[1\]".*Type<string>/ );

        // Constrained Set<number & Minimum<0>> & MinItems<1>
        expect( mod.parseSetCon( '[0, 5, 10]' )).toEqual( new Set([ 0, 5, 10 ]));
        expect(() => mod.parseSetCon( '[]' )).toThrow( /MinItems<1>/ );
        expect(() => mod.parseSetCon( '[1, -2]' )).toThrow( /"\[1\]".*Minimum<0>/ );

        // Set in query mode
        expect( mod.parseSetQuery( 'tags[]=x&tags[]=y' ).tags ).toEqual( new Set([ 'x', 'y' ]));
        expect( mod.parseSetQuery( 'tags=single' ).tags ).toEqual( new Set([ 'single' ]));
        expect( mod.parseSetQuery( '' ).tags ).toEqual( new Set());

        // Map<string, number> & empty Map
        expect( mod.parseMapStrNum( '{"a":1,"b":2}' )).toEqual( new Map([[ 'a', 1 ], [ 'b', 2 ]]));
        expect( mod.parseMapStrNum( '{}' )).toEqual( new Map());
        expect(() => mod.parseMapStrNum( '[1, 2]' )).toThrow( /Type<Map>/ );
        expect(() => mod.parseMapStrNum( '123' )).toThrow( /Type<Map>/ );
        expect(() => mod.parseMapStrNum( '{"a":"bad"}' )).toThrow( /"\[a\]".*Type<number>/ );

        // Map<number, boolean>
        expect( mod.parseMapNumBool( '{"1":true,"2":false}' )).toEqual( new Map([[ 1, true ], [ 2, false ]]));
        expect(() => mod.parseMapNumBool( '{"notNum":true}' )).toThrow( /\.key\(notNum\).*Type<number>/ );

        // Map<'a' | 'b', string>
        expect( mod.parseMapLit( '{"a":"alpha","b":"beta"}' )).toEqual( new Map([[ 'a', 'alpha' ], [ 'b', 'beta' ]]));
        expect(() => mod.parseMapLit( '{"c":"gamma"}' )).toThrow( /\.key\(c\)/ );

        // Nested Map<string, Set<number>>
        const nested = mod.parseNested( '{"group1":[1,2],"group2":[]}' );
        expect( nested.get( 'group1' )).toEqual( new Set([ 1, 2 ]));
        expect( nested.get( 'group2' )).toEqual( new Set());

        // Root Map<string, string> in query mode
        expect( mod.parseRootMapQuery( 'k1=v1&k2=v2' )).toEqual( new Map([[ 'k1', 'v1' ], [ 'k2', 'v2' ]]));
        expect( mod.parseRootMapQuery( '' )).toEqual( new Map());

        // Tagged Set / Map hooks
        const seenKinds: Array<{ type : string, tags : string[] }> = [];
        const tsRes = mod.parseTaggedSet( '["x"]', ( val: any, ctx: any ) =>
        {
            if( ctx.tags.length > 0 ){ seenKinds.push({ type : ctx.type, tags : ctx.tags }) }

            return val;
        });
        expect( tsRes ).toEqual( new Set([ 'x' ]));

        const tmRes = mod.parseTaggedMap( '{"k":1}', ( val: any, ctx: any ) =>
        {
            if( ctx.tags.length > 0 ){ seenKinds.push({ type : ctx.type, tags : ctx.tags }) }

            return val;
        });
        expect( tmRes ).toEqual( new Map([[ 'k', 1 ]]));
        expect( seenKinds ).toEqual([
            { type : 'Set', tags : [ 'mySet' ] },
            { type : 'Map', tags : [ 'myMap' ] }
        ]);
    });

    it( 'throws a compile-time error when Map has a non-primitive key type in parse', () =>
    {
        expect(() => compileAndTransform( `
            import { parse } from '../src/index.js';
            interface ObjKey { id: number }
            export const run = ( json: string ) => parse<Map<ObjKey, string>>( json );
        `, 'temp_parse_invalid_map_key' )).toThrow( /Map key type .* is not supported/ );
    });
});


