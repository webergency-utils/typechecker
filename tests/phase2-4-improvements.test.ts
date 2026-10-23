import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import {
    parser as rawParserMacro,
    safeParse as rawSafeParseMacro,
    compileSchema
} from '../src/index.js';
import type {
    IValidation,
    CompiledSchema,
    ResolveDefaults,
    ConvertPropertyCasing,
    tag
} from '../src/index.js';
import { validators } from '../src/runtime/validators.js';
import * as runtimeBarrel from '../src/runtime/index.js';
import type { ValidationContext } from '../src/runtime/validators.js';
import {
    safeParse as runtimeSafeParse,
    coerceBuffer,
    ParseError
} from '../src/runtime/parse-runtime.js';
import {
    serializeRegExp,
    serializeBuffer,
    SerializationError
} from '../src/runtime/serializer-runtime.js';
import { getCachedPattern } from '../src/runtime/regex.js';
import { compileAndTransform, emitAndImport } from './helpers/compile.js';

function makeCtx( root: unknown = {}): ValidationContext
{
    return {
        errors    : [],
        mode      : 'strict',
        mutate    : false,
        from      : undefined,
        transform : undefined,
        root,
        success   : true
    };
}

describe( 'Phase 2-4 Engine, Parity, and API Improvements', () =>
{
    it( 'throws transformer missing error when parser() or safeParse() macro stubs are invoked directly', () =>
    {
        expect(() => rawParserMacro()).toThrow( 'Typechecker transformer was not applied' );
        expect(() => rawSafeParseMacro( '{}' )).toThrow( 'Typechecker transformer was not applied' );
        expect( runtimeBarrel.validators ).toBe( validators );
        expect( runtimeBarrel.safeParse ).toBe( runtimeSafeParse );
    });

    it( 'handles runtimeSafeParse success, ParseError failure, and rethrows unexpected errors', () =>
    {
        const okRes = runtimeSafeParse(( x: unknown ) => Number( x ), '42' );
        expect( okRes ).toEqual({ success : true, data : 42 });

        const failRes = runtimeSafeParse(() =>
        {
            throw new ParseError( 'age', 'Type<number>' );
        }, 'bad' );
        expect( failRes.success ).toBe( false );

        if( !failRes.success )
        {
            expect( failRes.error ).toBeInstanceOf( ParseError );
            expect( failRes.error.path ).toBe( 'age' );
        }

        expect(() => runtimeSafeParse(() =>
        {
            throw new TypeError( 'boom' );
        }, 'bad' )).toThrow( TypeError );
    });

    it( 'validates optional and rest elements in validators.tuple across immutable and mutate modes', () =>
    {
        const els = [ validators.string, validators.number ];
        const ctx1 = makeCtx();
        const res1 = validators.tuple([ 'a' ], '', ctx1, els, 1, validators.boolean );
        expect( ctx1.success ).toBe( true );
        expect( res1 ).toEqual([ 'a' ]);

        const ctx2 = makeCtx();
        const res2 = validators.tuple([ 'a', 2, true, false ], '', ctx2, els, 1, validators.boolean );
        expect( ctx2.success ).toBe( true );
        expect( res2 ).toEqual([ 'a', 2, true, false ]);

        const ctxTooShort = makeCtx();
        validators.tuple([], '', ctxTooShort, els, 1 );
        expect( ctxTooShort.success ).toBe( false );
        expect( ctxTooShort.errors[0].error ).toBe( 'Tuple<1>' );

        const ctxRestBad = makeCtx();
        validators.tuple([ 'a', 2, 'not-bool' ], 'tup', ctxRestBad, els, 1, validators.boolean );
        expect( ctxRestBad.success ).toBe( false );
        expect( ctxRestBad.errors[0].path ).toBe( 'tup[2]' );

        const mutArr: any[] = [ 'a', '2', 'true' ];
        const ctxMut: ValidationContext = { ...makeCtx( mutArr ), mutate : true, from : 'query' };
        const resMut = validators.tuple( mutArr, '', ctxMut, els, 1, validators.boolean );
        expect( ctxMut.success ).toBe( true );
        expect( resMut ).toBe( mutArr );
        expect( mutArr ).toEqual([ 'a', 2, true ]);

        const frozenArr = Object.freeze([ 'a', 2, true ]);
        const ctxFrozen: ValidationContext = { ...makeCtx( frozenArr ), mutate : true };
        const resFrozen = validators.tuple( frozenArr, '', ctxFrozen, els, 1, validators.boolean );
        expect( ctxFrozen.success ).toBe( true );
        expect( resFrozen ).toBe( frozenArr );

        const undefOpt = [ 'a', undefined ];
        const ctxOpt = makeCtx( undefOpt );
        expect( validators.tuple( undefOpt, '', ctxOpt, els, 1 )).toEqual([ 'a', undefined ]);

        const undefOptMut = [ 'a', undefined ];
        const ctxOptMut: ValidationContext = { ...makeCtx( undefOptMut ), mutate : true };
        expect( validators.tuple( undefOptMut, '', ctxOptMut, els, 1 )).toBe( undefOptMut );
    });

    it( 'serializes RegExp and all ArrayBufferView typed arrays via serializeRegExp and serializeBuffer', () =>
    {
        expect( serializeRegExp( /^abc$/gi, 're' )).toBe( '"^abc$"' );
        expect(() => serializeRegExp( 'not-re' as unknown as RegExp, 're' )).toThrow( SerializationError );

        const int32 = new Int32Array([ 1, 2 ]);
        const b64 = serializeBuffer( int32, 'buf' );
        expect( typeof b64 ).toBe( 'string' );
        expect( b64.length ).toBeGreaterThan( 0 );

        const origBuffer = globalThis.Buffer;

        try
        {
            ( globalThis as any ).Buffer = undefined;

            const u8 = new Uint8Array([ 72, 105 ]);
            const btoaOut = serializeBuffer( u8, 'b' );
            expect( btoaOut ).toBe( '"SGk="' );

            const atobRes = coerceBuffer( 'SGk=', 'b' );
            expect( atobRes ).toBeInstanceOf( Uint8Array );
            expect( Array.from( atobRes )).toEqual([ 72, 105 ]);

            expect( coerceBuffer( u8, 'b' )).toBeInstanceOf( Uint8Array );
            expect( coerceBuffer( u8.buffer, 'b' )).toBeInstanceOf( Uint8Array );
        }
        finally
        {
            globalThis.Buffer = origBuffer;
        }

        for( let i = 0; i <= 1025; i++ )
        {
            expect( getCachedPattern( `^pat_${i}$` )).toBeInstanceOf( RegExp );
        }
    });

    it( 'supports Uint8ClampedArray, BigInt64Array, and BigUint64Array in compileSchema x-typescript-type', () =>
    {
        const clampedSchema = compileSchema({ 'x-typescript-type' : 'Uint8ClampedArray' });
        const i64Schema = compileSchema({ 'x-typescript-type' : 'BigInt64Array' });
        const u64Schema = compileSchema({ 'x-typescript-type' : 'BigUint64Array' });

        const c1 = makeCtx();
        clampedSchema( new Uint8ClampedArray([ 1, 2 ]), '', c1 );
        expect( c1.success ).toBe( true );

        const c1Fail = makeCtx();
        clampedSchema( new Uint8Array([ 1 ]), '', c1Fail );
        expect( c1Fail.success ).toBe( false );

        const c2 = makeCtx();
        i64Schema( new BigInt64Array([ 1n ]), '', c2 );
        expect( c2.success ).toBe( true );

        const c2Fail = makeCtx();
        i64Schema( new Uint8Array([ 1 ]), '', c2Fail );
        expect( c2Fail.success ).toBe( false );

        const c3 = makeCtx();
        u64Schema( new BigUint64Array([ 1n ]), '', c3 );
        expect( c3.success ).toBe( true );

        const c3Fail = makeCtx();
        u64Schema( new Uint8Array([ 1 ]), '', c3Fail );
        expect( c3Fail.success ).toBe( false );
    });

    it( 'resolves mutually recursive types and unions of recursive types without TDZ ReferenceError', async() =>
    {
        const mod = await emitAndImport<{
            checkUnion : ( v: unknown ) => boolean
            checkNodeA : ( v: unknown ) => boolean
        }>( `
            import { is } from '../src/index.js';

            interface NodeA {
                kind: 'a';
                next?: NodeB;
            }
            interface NodeB {
                kind: 'b';
                prev?: NodeA;
                items?: TreeItem[];
            }
            type TreeItem = NodeA | NodeB;

            export const checkUnion = ( v: unknown ) => is<TreeItem>( v );
            export const checkNodeA = ( v: unknown ) => is<NodeA>( v );
        `, 'temp_phase2_recursive_tdz' );

        expect( mod.checkUnion({
            kind  : 'b',
            prev  : { kind : 'a', next : { kind : 'b' } },
            items : [{ kind : 'a' }, { kind : 'b' }]
        })).toBe( true );

        expect( mod.checkUnion({
            kind : 'b',
            prev : { kind : 'invalid' }
        })).toBe( false );

        expect( mod.checkNodeA({
            kind : 'a',
            next : { kind : 'b', prev : { kind : 'a' } }
        })).toBe( true );
    });

    it( 'invokes transform option exactly once on constrained template literal types', async() =>
    {
        const mod = await emitAndImport<{
            validateSlug : ( v: unknown, fn: any ) => any
        }>( `
            import { validate, constraint } from '../src/index.js';
            type Slug = \`item-\${number}\` & constraint.MinLength<6>;
            export const validateSlug = ( v: unknown, fn: any ) => validate<Slug>( v, { transform: fn } );
        `, 'temp_phase2_template_literal_transform' );

        const spy = vi.fn(( val: unknown ) => val );
        const res = mod.validateSlug( 'item-42', spy );

        expect( res.success ).toBe( true );
        expect( spy ).toHaveBeenCalledTimes( 1 );
    });

    it( 'serializes recursive types with format: "query" without ReferenceError on params', async() =>
    {
        const mod = await emitAndImport<{
            toQuery : ( v: any ) => string
        }>( `
            import { stringify } from '../src/index.js';
            interface Category {
                name: string;
                sub?: Category;
            }
            export const toQuery = ( v: Category ) => stringify<Category>( v, { format: 'query' } );
        `, 'temp_phase2_recursive_query_ser' );

        const qs = mod.toQuery({ name : 'root', sub : { name : 'child', sub : { name : 'leaf' } } });
        expect( qs ).toBe( 'name=root&sub%5Bname%5D=child&sub%5Bsub%5D%5Bname%5D=leaf' );
    });

    it( 'generates accurate jsonSchema for recursive unions, recursive tuples, brand-only intersections, template literals, never, and collapsed booleans', async() =>
    {
        const mod = await emitAndImport<{
            recursiveUnionSchema : any
            brandedStringSchema  : any
            templateConstraint   : any
            neverPropSchema      : any
            boolUnionSchema      : any
            ifaceConstraint      : any
        }>( `
            import { jsonSchema, constraint } from '../src/index.js';

            interface Branch {
                type: 'branch';
                children: Tree[];
                pair?: [string, Tree];
            }
            interface Leaf {
                type: 'leaf';
                value: number;
            }
            type Tree = Branch | Leaf;

            type BrandedId = string & { readonly __brand: unique symbol };
            type ConstrainedTpl = \`user_\${number}\` & constraint.MinLength<6>;
            interface WithNever {
                ok?: string;
                impossible: never;
            }
            type BoolOrStr = boolean | string;

            interface BoundedObj extends constraint.MinProperties<1>, constraint.MaxProperties<5> {
                a?: string;
            }

            export const recursiveUnionSchema = jsonSchema<Tree>();
            export const brandedStringSchema = jsonSchema<BrandedId>();
            export const templateConstraint = jsonSchema<ConstrainedTpl>();
            export const neverPropSchema = jsonSchema<WithNever>();
            export const boolUnionSchema = jsonSchema<BoolOrStr>();
            export const ifaceConstraint = jsonSchema<BoundedObj>();
        `, 'temp_phase2_json_schema' );

        expect( mod.recursiveUnionSchema.$defs ).toBeDefined();
        expect( mod.brandedStringSchema ).toEqual({ type : 'string' });
        expect( mod.templateConstraint.type ).toBe( 'string' );
        expect( mod.templateConstraint.pattern ).toBe( '^user_[+-]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$' );
        expect( mod.templateConstraint.minLength ).toBe( 6 );
        expect( mod.neverPropSchema.properties.impossible ).toEqual({ not : {} });
        expect( mod.neverPropSchema.properties.ok ).toEqual({ type : 'string' });
        expect( mod.boolUnionSchema.anyOf ).toEqual([{ type : 'string' }, { type : 'boolean' }]);
        expect( mod.ifaceConstraint.minProperties ).toBe( 1 );
        expect( mod.ifaceConstraint.maxProperties ).toBe( 5 );
    });

    it( 'supports ReadonlySet, ReadonlyMap, tuple optional/rest elements, void, never, RegExp, and typed arrays across engines', async() =>
    {
        const mod = await emitAndImport<{
            validateContainer  : ( v: unknown ) => any
            parseContainer     : ( s: string ) => any
            serializeContainer : ( v: any ) => string
            serializeQuery     : ( v: any ) => string
            validateVoid       : ( v: unknown ) => boolean
            parseVoid          : ( s: string ) => any
            serializeVoid      : ( v: any ) => string
            validateNever      : ( v: unknown ) => boolean
            parseNever         : ( s: string ) => any
            serializeNever     : ( v: any ) => string
        }>( `
            import { validate, parse, stringify, is, constraint } from '../src/index.js';

            interface Container extends constraint.MinProperties<2> {
                tags: ReadonlySet<string>;
                meta: ReadonlyMap<string, number>;
                tuple: [string, number?, ...boolean[]];
                pattern?: RegExp;
                bytes?: Uint8ClampedArray;
            }

            export const validateContainer = ( v: unknown ) => validate<Container>( v );
            export const parseContainer = ( s: string ) => parse<Container>( s );
            export const serializeContainer = ( v: Container ) => stringify<Container>( v );
            export const serializeQuery = ( v: { buf: Int32Array; re: RegExp; tup: [string, number?] } ) =>
                stringify<{ buf: Int32Array; re: RegExp; tup: [string, number?] }>( v, { format: 'query' } );

            export const validateVoid = ( v: unknown ) => is<void>( v );
            export const parseVoid = ( s: string ) => parse<{ v: void }>( s );
            export const serializeVoid = ( v: { v: void } ) => stringify<{ v: void }>( v );

            export const validateNever = ( v: unknown ) => is<never>( v );
            export const parseNever = ( s: string ) => parse<never>( s );
            export const serializeNever = ( v: never ) => stringify<never>( v );
        `, 'temp_phase3_parity_matrix' );

        const validInput = {
            tags    : new Set([ 'a', 'b' ]),
            meta    : new Map([[ 'k', 1 ]]),
            tuple   : [ 'hello', 42, true, false ] as [string, number?, ...boolean[]],
            pattern : /^test$/i,
            bytes   : new Uint8ClampedArray([ 10, 20 ])
        };

        const vRes = mod.validateContainer( validInput );
        expect( vRes.success ).toBe( true );

        const vShortTuple = mod.validateContainer({
            tags  : new Set([ 'a' ]),
            meta  : new Map([[ 'k', 1 ]]),
            tuple : [ 'only-str' ]
        });
        expect( vShortTuple.success ).toBe( true );

        const parsed = mod.parseContainer( JSON.stringify({
            tags  : [ 'x', 'y' ],
            meta  : { a : 10 },
            tuple : [ 'hi' ]
        }));
        expect( parsed.tags ).toBeInstanceOf( Set );
        expect( parsed.meta ).toBeInstanceOf( Map );
        expect( parsed.tuple ).toEqual([ 'hi' ]);

        const serialized = mod.serializeContainer({
            tags    : new Set([ 'a' ]),
            meta    : new Map([[ 'k', 2 ]]),
            tuple   : [ 's', 1, true ],
            pattern : /abc/g
        });
        expect( JSON.parse( serialized )).toEqual({
            tags    : [ 'a' ],
            meta    : { k : 2 },
            tuple   : [ 's', 1, true ],
            pattern : 'abc'
        });

        const qStr = mod.serializeQuery({
            buf : new Int32Array([ 1 ]),
            re  : /xyz/,
            tup : [ 'a' ]
        });
        expect( qStr ).toContain( 're=%2Fxyz%2F' );
        expect( qStr ).toContain( 'tup%5B0%5D=a' );

        expect( mod.validateVoid( undefined )).toBe( true );
        expect( mod.validateVoid( null )).toBe( false );
        expect( mod.parseVoid( '{}' )).toEqual({ v : undefined });
        expect( mod.serializeVoid({ v : undefined })).toBe( '{"v":null}' );

        expect( mod.validateNever( 'anything' )).toBe( false );
        expect(() => mod.parseNever( '"anything"' )).toThrow( 'Type<never>' );
        expect(() => ( mod.serializeNever as any )( 'anything' )).toThrow( 'Type<never>' );
    });

    it( 'handles numeric/boolean/mixed tagged unions in parse with from: "query"', async() =>
    {
        const mod = await emitAndImport<{
            parseNumericTag : ( qs: string ) => any
            parseMixedTag   : ( qs: string ) => any
        }>( `
            import { parse } from '../src/index.js';

            type NumTagged =
                | { code: 1; label: string }
                | { code: 2; count: number };

            type MixedTagged =
                | { kind: 'text'; value: string }
                | { kind: 100; flag: boolean };

            export const parseNumericTag = ( qs: string ) => parse<NumTagged>( qs, { from: 'query' } );
            export const parseMixedTag = ( qs: string ) => parse<MixedTagged>( qs, { from: 'query' } );
        `, 'temp_phase3_query_tagged_unions' );

        expect( mod.parseNumericTag( 'code=1&label=hello' )).toEqual({ code : 1, label : 'hello' });
        expect( mod.parseNumericTag( 'code=2&count=42' )).toEqual({ code : 2, count : 42 });
        expect(() => mod.parseNumericTag( 'code=999&label=no' )).toThrow();

        expect( mod.parseMixedTag( 'kind=text&value=abc' )).toEqual({ kind : 'text', value : 'abc' });
        expect( mod.parseMixedTag( 'kind=100&flag=true' )).toEqual({ kind : 100, flag : true });
    });

    it( 'supports parser<T>(), safeParse<T>(), and options passed via const identifier or as const', async() =>
    {
        const mod = await emitAndImport<{
            parseUser      : ( s: string ) => any
            parseQueryUser : ( s: string ) => any
            safeParseUser  : ( s: string ) => any
            safeParseQuery : ( s: string ) => any
        }>( `
            import { parser, safeParse, tag } from '../src/index.js';

            interface User {
                name: string;
                port?: number & tag.Default<8080>;
            }

            const queryOpts = { from: 'query', mode: 'strip' } as const;

            export const parseUser = parser<User>();
            export const parseQueryUser = parser<User>( queryOpts );
            export const safeParseUser = ( s: string ) => safeParse<User>( s );
            export const safeParseQuery = ( s: string ) => safeParse<User>( s, queryOpts );
        `, 'temp_phase4_parser_safeparse' );

        expect( mod.parseUser( '{"name":"Alice"}' )).toEqual({ name : 'Alice', port : 8080 });
        expect( mod.parseQueryUser( 'name=Bob&extra=1' )).toEqual({ name : 'Bob', port : 8080 });

        const ok = mod.safeParseUser( '{"name":"Carol","port":3000}' );
        expect( ok ).toEqual({ success : true, data : { name : 'Carol', port : 3000 } });

        const fail = mod.safeParseUser( '{"name":123}' );
        expect( fail.success ).toBe( false );
        expect( fail.error.name ).toBe( 'ParseError' );
        expect( fail.error.path ).toBe( 'name' );

        const okQuery = mod.safeParseQuery( 'name=Dave&port=9000&ignored=yes' );
        expect( okQuery ).toEqual({ success : true, data : { name : 'Dave', port : 9000 } });
    });

    it( 'preserves tuples and readonly arrays in ResolveDefaults and ConvertPropertyCasing type utilities', () =>
    {
        interface Config
        {
            coords : [number, number]
            roList : readonly string[]
            port?  : number & tag.Default<3000>
        }

        type Resolved = ResolveDefaults<Config>;
        expectTypeOf<Resolved['coords']>().toEqualTypeOf<[number, number]>();
        expectTypeOf<Resolved['roList']>().toEqualTypeOf<readonly string[]>();
        expectTypeOf<Resolved['port']>().toMatchTypeOf<number>();
        expectTypeOf<{ port? : number }>().not.toMatchTypeOf<Pick<Resolved, 'port'>>();

        interface SnakeShape
        {
            item_pair : [ { first_name : string }, number ]
            ro_items  : readonly { user_id : number }[]
        }

        type CamelShape = ConvertPropertyCasing<SnakeShape, 'camelCase'>;
        expectTypeOf<CamelShape['itemPair']>().toEqualTypeOf<[ { firstName : string }, number ]>();
        expectTypeOf<CamelShape['roItems']>().toEqualTypeOf<readonly { userId : number }[]>();
    });

    it( 'narrows IValidation<T> as a discriminated union and types CompiledSchema<T> with StandardSchemaV1', () =>
    {
        const res = { success : true, data : { id : 1 }, errors : [] } as IValidation<{ id : number }>;

        if( res.success )
        {
            expectTypeOf( res.data ).toEqualTypeOf<{ id : number }>();
        }
        else
        {
            expectTypeOf<typeof res.data>().toEqualTypeOf<{ id : number } | undefined>();
        }

        const compiled = compileSchema<{ id : number }>({
            type       : 'object',
            properties : { id : { type : 'number' } },
            required   : [ 'id' ]
        });
        expectTypeOf<typeof compiled>().toEqualTypeOf<CompiledSchema<{ id : number }>>();
        expect( compiled['~standard'].version ).toBe( 1 );
    });

    it( 'deduplicates identical structural object shapes across different aliases in codegen', () =>
    {
        const code = compileAndTransform( `
            import { is } from '../src/index.js';
            interface Alpha { id: string; count: number }
            interface Beta { id: string; count: number }
            export const a = ( x: unknown ) => is<Alpha>( x );
            export const b = ( x: unknown ) => is<Beta>( x );
        `, 'temp_phase4_dedupe_aliases.ts' );

        const callMatches = [ ...code.matchAll( /__tcRuntime\.is\((__val_[a-z0-9]+),/g ) ].map( m => m[1]);
        expect( callMatches.length ).toBe( 2 );
        expect( callMatches[0]).toBe( callMatches[1]);
    });
});
