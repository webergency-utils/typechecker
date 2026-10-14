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

    it( 'parses a recursive linked list type correctly', async() =>
    {
        const mod = await emitAndImport<{
            parseList : ( json: string ) => any
        }>( `
            import { parse } from '../src/index.js';
            interface LinkedListNode {
                val: number;
                next?: LinkedListNode;
            }
            export const parseList = ( json: string ) => parse<LinkedListNode>( json );
        `, 'temp_parse_recursive_success' );

        const list = mod.parseList( '{"val": 1, "next": {"val": 2, "next": {"val": 3}}}' );
        expect( list ).toEqual({
            val  : 1,
            next : {
                val  : 2,
                next : {
                    val : 3
                }
            }
        });
    });

    it( 'enforces BigIntLiteral equality including negative literals and unions in JSON and query modes', async() =>
    {
        const mod = await emitAndImport<{
            parseTen   : ( json: string ) => bigint
            parseTenQ  : ( qs: string ) => { n : bigint }
            parseNeg   : ( json: string ) => bigint
            parseUnion : ( json: string ) => bigint
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
        expect( mod.parseNeg( '-42' )).toBe( -42n );
        expect(() => mod.parseNeg( '"42"' )).toThrow( /Literal<-42n>/ );

        expect( mod.parseUnion( '"1"' )).toBe( 1n );
        expect( mod.parseUnion( '"2"' )).toBe( 2n );
        expect(() => mod.parseUnion( '"3"' )).toThrow( /Type<|Literal</ );
    });

    it( 'preserves all arms and invokes tag/constraint/transform hooks on multi-arm tagged object intersections', async() =>
    {
        const mod = await emitAndImport<{
            parseTwoJson   : ( json: string, transform?: any ) => any
            parseTwoQuery  : ( qs: string, transform?: any ) => any
            parseThreeJson : ( json: string, transform?: any ) => any
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

    it( 'matches assert on MultipleOf floats/zero, bigint constraints, relative/root Requires, and order-independent UniqueItems', async() =>
    {
        const mod = await emitAndImport<{
            parseFloatMult : ( json: string ) => number
            parseZeroMult  : ( json: string ) => number
            parseBigCon    : ( json: string ) => bigint
            parseRelReq    : ( json: string ) => any
            assertRelReq   : ( val: unknown ) => any
            parseRootReq   : ( json: string ) => any
            assertRootReq  : ( val: unknown ) => any
            parseUniqueObj : ( json: string ) => any[]
        }>( `
            import { parse, assert, constraint } from '../src/index.js';
            type BigCon = bigint
                & constraint.Minimum<10n>
                & constraint.Maximum<100n>
                & constraint.ExclusiveMinimum<5n>
                & constraint.ExclusiveMaximum<105n>
                & constraint.MultipleOf<5n>;
            interface RelReqDoc {
                sibling?: string;
                nested: { val: number } & constraint.Requires<'.sibling'>;
            }
            interface RootReqDoc {
                top?: { flag?: boolean };
                deep: { item: { id: string } & constraint.Requires<'top.flag'> };
            }
            export const parseFloatMult = ( json: string ) => parse<number & constraint.MultipleOf<0.1>>( json );
            export const parseZeroMult = ( json: string ) => parse<number & constraint.MultipleOf<0>>( json );
            export const parseBigCon = ( json: string ) => parse<BigCon>( json );
            export const parseRelReq = ( json: string ) => parse<RelReqDoc>( json );
            export const assertRelReq = ( val: unknown ) => assert<RelReqDoc>( val );
            export const parseRootReq = ( json: string ) => parse<RootReqDoc>( json );
            export const assertRootReq = ( val: unknown ) => assert<RootReqDoc>( val );
            export const parseUniqueObj = ( json: string ) => parse<Array<{ a: number; b: number }> & constraint.UniqueItems>( json );
        `, 'temp_parse_constraints_parity' );

        // Floating-point MultipleOf<0.1> on 0.3
        expect( mod.parseFloatMult( '0.3' )).toBe( 0.3 );
        expect(() => mod.parseFloatMult( '0.35' )).toThrow( /MultipleOf<0\.1>/ );

        // MultipleOf<0> rejects
        expect(() => mod.parseZeroMult( '5' )).toThrow( /MultipleOf<0>/ );

        // BigInt constraints
        expect( mod.parseBigCon( '"15"' )).toBe( 15n );
        expect(() => mod.parseBigCon( '"5"' )).toThrow( /Minimum<10>/ );
        expect(() => mod.parseBigCon( '"105"' )).toThrow( /Maximum<100>/ );
        expect(() => mod.parseBigCon( '"12"' )).toThrow( /MultipleOf<5>/ );

        // Relative and root Requires (matching assert)
        expect( mod.parseRelReq( '{"sibling":"ok","nested":{"val":1}}' )).toEqual({ sibling : 'ok', nested : { val : 1 } });
        expect( mod.assertRelReq({ sibling : 'ok', nested : { val : 1 } })).toEqual({ sibling : 'ok', nested : { val : 1 } });
        expect(() => mod.parseRelReq( '{"nested":{"val":1}}' )).toThrow( /Requires<\.sibling>/ );
        expect(() => mod.assertRelReq({ nested : { val : 1 } })).toThrow( /Requires<\.sibling>/ );

        expect( mod.parseRootReq( '{"top":{"flag":true},"deep":{"item":{"id":"x"}}}' )).toEqual({
            top  : { flag : true },
            deep : { item : { id : 'x' } }
        });
        expect( mod.assertRootReq({ top : { flag : true }, deep : { item : { id : 'x' } } })).toEqual({
            top  : { flag : true },
            deep : { item : { id : 'x' } }
        });
        expect(() => mod.parseRootReq( '{"top":{},"deep":{"item":{"id":"x"}}}' )).toThrow( /Requires<top\.flag>/ );
        expect(() => mod.assertRootReq({ top : {}, deep : { item : { id : 'x' } } })).toThrow( /Requires<top\.flag>/ );

        // Order-independent UniqueItems on objects
        expect( mod.parseUniqueObj( '[{"a":1,"b":2},{"a":1,"b":3}]' )).toHaveLength( 2 );
        expect(() => mod.parseUniqueObj( '[{"a":1,"b":2},{"b":2,"a":1}]' )).toThrow( /UniqueItems/ );
    });

    it( 'validates template literals with negative/scientific numbers and finite literal union slots in parse and assert', async() =>
    {
        const mod = await emitAndImport<{
            parseNumTpl   : ( json: string ) => string
            assertNumTpl  : ( val: unknown ) => string
            parseSlotTpl  : ( json: string ) => string
            assertSlotTpl : ( val: unknown ) => string
        }>( `
            import { parse, assert } from '../src/index.js';
            type NumTpl = \`val_\${number}\`;
            type SlotTpl = \`prefix_\${'a' | 'b'}_\${1 | 2}\`;
            export const parseNumTpl = ( json: string ) => parse<NumTpl>( json );
            export const assertNumTpl = ( val: unknown ) => assert<NumTpl>( val );
            export const parseSlotTpl = ( json: string ) => parse<SlotTpl>( json );
            export const assertSlotTpl = ( val: unknown ) => assert<SlotTpl>( val );
        `, 'temp_parse_template_literal_parity' );

        expect( mod.parseNumTpl( '"val_-1.5e2"' )).toBe( 'val_-1.5e2' );
        expect( mod.assertNumTpl( 'val_-1.5e2' )).toBe( 'val_-1.5e2' );
        expect( mod.parseNumTpl( '"val_42"' )).toBe( 'val_42' );
        expect(() => mod.parseNumTpl( '"val_abc"' )).toThrow( /val_\$\{number\}/ );
        expect(() => mod.assertNumTpl( 'val_abc' )).toThrow( /val_\$\{number\}/ );

        expect( mod.parseSlotTpl( '"prefix_a_1"' )).toBe( 'prefix_a_1' );
        expect( mod.parseSlotTpl( '"prefix_b_2"' )).toBe( 'prefix_b_2' );
        expect( mod.assertSlotTpl( 'prefix_a_2' )).toBe( 'prefix_a_2' );
        expect(() => mod.parseSlotTpl( '"prefix_c_1"' )).toThrow( /prefix_/ );
        expect(() => mod.parseSlotTpl( '"prefix_a_3"' )).toThrow( /prefix_/ );
        expect(() => mod.assertSlotTpl( 'prefix_c_1' )).toThrow( /prefix_/ );
        expect(() => mod.assertSlotTpl( 'prefix_a_3' )).toThrow( /prefix_/ );
    });

    it( 'supports Default<bigint> (positive and negative) and custom non-__brand phantom intersections across assert, validate, and parse', async() =>
    {
        const mod = await emitAndImport<{
            assertBigDef  : ( val: unknown ) => { pos : bigint, neg : bigint }
            valBigDef     : ( val: unknown ) => any
            parseBigDef   : ( json: string ) => { pos : bigint, neg : bigint }
            assertCustom  : ( val: unknown ) => string
            parseCustom   : ( json: string ) => string
            parseSetBrand : ( json: string ) => Set<string>
        }>( `
            import { assert, validate, parse, constraint, tag } from '../src/index.js';
            interface WithBigDefaults {
                pos?: bigint & tag.Default<10n>;
                neg?: bigint & tag.Default<-5n>;
            }
            type CustomBrandedStr = string & { readonly __customBrand?: unique symbol } & constraint.MinLength<3>;
            type CustomBrandedSet = Set<string> & { readonly __customBrand?: unique symbol } & constraint.MinItems<1>;
            export const assertBigDef = ( val: unknown ) => assert<WithBigDefaults>( val ) as { pos: bigint; neg: bigint };
            export const valBigDef = ( val: unknown ) => validate<WithBigDefaults>( val );
            export const parseBigDef = ( json: string ) => parse<WithBigDefaults>( json ) as { pos: bigint; neg: bigint };
            export const assertCustom = ( val: unknown ) => assert<CustomBrandedStr>( val );
            export const parseCustom = ( json: string ) => parse<CustomBrandedStr>( json );
            export const parseSetBrand = ( json: string ) => parse<CustomBrandedSet>( json );
        `, 'temp_parse_bigint_defaults_and_custom_brand' );

        expect( mod.assertBigDef({})).toEqual({ pos : 10n, neg : -5n });
        expect( mod.valBigDef({}).data ).toEqual({ pos : 10n, neg : -5n });
        expect( mod.parseBigDef( '{}' )).toEqual({ pos : 10n, neg : -5n });

        expect( mod.assertCustom( 'abc' )).toBe( 'abc' );
        expect( mod.parseCustom( '"abc"' )).toBe( 'abc' );
        expect(() => mod.assertCustom( 'ab' )).toThrow( /MinLength<3>/ );
        expect(() => mod.parseCustom( '"ab"' )).toThrow( /MinLength<3>/ );

        expect( mod.parseSetBrand( '["item"]' )).toEqual( new Set([ 'item' ]));
        expect(() => mod.parseSetBrand( '[]' )).toThrow( /MinItems<1>/ );
    });
});


