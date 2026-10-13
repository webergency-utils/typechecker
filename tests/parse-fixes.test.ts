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
});

