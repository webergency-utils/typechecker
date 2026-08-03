import { describe, it, expect } from 'vitest';
import
{
    parseQueryString,
    coerceNumber,
    coerceBoolean,
    coerceDate,
    coerceArray,
    coerceBuffer,
    coerceBigInt,
    applyParseConstraints,
    expectString,
    expectNumber,
    expectBoolean,
    expectObject,
    expectArray,
    parseUnion,
    ParseError
}
from '../runtime/parse-runtime.js';
import { getCachedPattern, createSafeRegex, testRegex, isRegexSafe } from '../runtime/regex.js';
import { childPath, indexPath } from '../runtime/path.js';
import { generateParseCode } from '../engine/parse-generator.js';
import { compileAndTransform, emitAndImport } from './helpers/compile.js';
import { parse, serializer, stringify } from '../index.js';
import { buildParser } from '../transformer.js';
import ts from 'typescript';

describe( 'Parse', () =>
{
    const compile = ( code: string ) => compileAndTransform( code, 'temp_parse_test' );

    describe( 'expect helpers & parseUnion', () =>
    {
        it( 'accepts matching primitives and rejects mismatches', () =>
        {
            expect( expectString( 'x', 'n' )).toBe( 'x' );
            expect( () => expectString( 1, 'n' )).toThrow( /Type<string>/ );
            expect( expectNumber( 3, 'n' )).toBe( 3 );
            expect( () => expectNumber( NaN, 'n' )).toThrow( /Type<number>/ );
            expect( () => expectNumber( '1', 'n' )).toThrow( /Type<number>/ );
            expect( expectBoolean( false, 'n' )).toBe( false );
            expect( () => expectBoolean( 'false', 'n' )).toThrow( /Type<boolean>/ );
            expect( expectObject({ a : 1 }, 'n' )).toEqual({ a : 1 });
            expect( () => expectObject( null, 'n' )).toThrow( /Type<Object>/ );
            expect( () => expectObject([], 'n' )).toThrow( /Type<Object>/ );
            expect( expectArray([ 1 ], 'n' )).toEqual([ 1 ]);
            expect( () => expectArray( {}, 'n' )).toThrow( /Type<Array>/ );
        });

        it( 'parseUnion returns the first matching arm', () =>
        {
            expect( parseUnion( 'a', 'u', 'Type<Union>', [
                ( v ) => expectString( v, 'u' ),
                () => { throw new ParseError( 'u', 'Type<number>' ) }
            ])).toBe( 'a' );
        });

        it( 'parseUnion rethrows the last ParseError when its code matches expected', () =>
        {
            expect( () => parseUnion( true, 'u', 'Type<string>', [
                () => { throw new ParseError( 'u', 'Type<string>' ) }
            ])).toThrow( 'Parse error at "u": Type<string>' );
        });

        it( 'parseUnion throws expected when no arm matches with that code', () =>
        {
            expect( () => parseUnion( true, 'u', 'Type<Union>', [
                () => { throw new ParseError( 'u', 'Type<string>' ) },
                () => { throw new ParseError( 'u', 'Type<number>' ) }
            ])).toThrow( 'Parse error at "u": Type<Union>' );
        });

        it( 'parseUnion rethrows non-ParseError failures', () =>
        {
            expect( () => parseUnion( 1, 'u', 'Type<Union>', [
                () => { throw new TypeError( 'boom' ) }
            ])).toThrow( TypeError );
        });

        it( 'parseUnion falls through when ParseError message is rewritten', () =>
        {
            expect( () => parseUnion( 1, 'u', 'Type<Union>', [
                () =>
                {
                    const err = new ParseError( 'u', 'Type<string>' );
                    Object.defineProperty( err, 'message', { value : 'rewritten' });
                    throw err;
                }
            ])).toThrow( 'Parse error at "u": Type<Union>' );
        });
    });

    describe( 'path & regex helpers', () =>
    {
        it( 'joins child and index paths without a leading dot', () =>
        {
            expect( childPath( '', 'name' )).toBe( 'name' );
            expect( childPath( 'user', 'name' )).toBe( 'user.name' );
            expect( indexPath( 'items', 0 )).toBe( 'items[0]' );
            expect( indexPath( '', 2 )).toBe( '[2]' );
        });

        it( 'caches safe patterns and rejects unsafe sources', () =>
        {
            const a = getCachedPattern( '^abc$' );
            const b = getCachedPattern( '^abc$' );
            expect( a ).toBeInstanceOf( RegExp );
            expect( b ).toBe( a );
            expect( getCachedPattern( 'a'.repeat( 1025 ))).toBeUndefined();
            expect( createSafeRegex( 'ok', 'i' ).flags ).toContain( 'i' );
            expect( () => createSafeRegex( 'a'.repeat( 1025 ))).toThrow( /Unsafe regular expression/ );
            expect( testRegex( /x/g, 'x' )).toBe( true );
            expect( isRegexSafe( /ok/ )).toBe( true );
        });
    });

    describe( 'Untransformed stubs', () =>
    {
        it( 'throws when transformer was not applied', () =>
        {
            expect( () => parse( '{}' )).toThrow( 'Typechecker transformer was not applied' );
        });
    });

    describe( 'parseQueryString', () =>
    {
        it( 'parses simple pairs, flags, and empty input', () =>
        {
            expect( parseQueryString( 'id=123&name=Alice' )).toEqual({ id : '123', name : 'Alice' });
            expect( parseQueryString( 'active&debug=true' )).toEqual({ active : true, debug : 'true' });
            expect( parseQueryString( '' )).toEqual({});
            expect( parseQueryString( '&&&a=1&&b=&c&&' )).toEqual({ a : '1', b : '', c : true });
        });

        it( 'covers ParseError root path formatting', () =>
        {
            const err = new ParseError( '', 'boom' );
            expect( err.message ).toBe( 'Parse error: boom' );
            expect( err.path ).toBe( '' );
        });

        it( 'assigns into existing nested objects and empty-bracket growth', () =>
        {
            // leaf assign onto an object-valued key appends a numeric slot
            expect( parseQueryString( 'filter[category]=books&filter=extra' )).toEqual({
                filter : { category : 'books', 0 : 'extra' }
            });

            // empty brackets on a fresh key and then another empty bracket grows the array
            expect( parseQueryString( 'items[]=a&items[]=b&items[]=c' )).toEqual({
                items : [ 'a', 'b', 'c' ]
            });

            // convert array to object when a string key appears after numeric entries
            expect( parseQueryString( 'mix[0]=a&mix[name]=b' )).toEqual({
                mix : { 0 : 'a', name : 'b' }
            });
        });

        it( 'parses nested brackets, arrays, and duplicates', () =>
        {
            expect( parseQueryString( 'user[name]=Alice&user[age]=30&tags[]=a&tags[]=b&items[0]=x&items[1]=y' )).toEqual({
                user  : { name : 'Alice', age : '30' },
                tags  : [ 'a', 'b' ],
                items : [ 'x', 'y' ]
            });
            expect( parseQueryString( 'tag=a&tag=b' )).toEqual({ tag : [ 'a', 'b' ] });
            expect( parseQueryString( 'tags[]=a&tags=b' )).toEqual({ tags : [ 'a', 'b' ] });
            expect( parseQueryString( 'category=electronics&category=gadgets&category=mobile' )).toEqual({
                category : [ 'electronics', 'gadgets', 'mobile' ]
            });
        });

        it( 'parses deep nests and empty-bracket object arrays', () =>
        {
            expect( parseQueryString(
                'user[profile][addresses][0][street]=Main+St&user[profile][addresses][0][zip]=12345&user[profile][addresses][1][street]=Broad+St'
            )).toEqual({
                user : {
                    profile : {
                        addresses : [
                            { street : 'Main St', zip : '12345' },
                            { street : 'Broad St' }
                        ]
                    }
                }
            });

            expect( parseQueryString( 'a[][name]=Alice&a[][role]=admin&a[][name]=Bob&a[][role]=editor' )).toEqual({
                a : [
                    { name : 'Alice', role : 'admin' },
                    { name : 'Bob', role : 'editor' }
                ]
            });

            expect( parseQueryString( 'user[0][name]=Alice&user[][name]=Bob&user[][role]=admin' )).toBeDefined();
            expect( parseQueryString( '&&user[0]=a&user[foo]=b' )).toBeDefined();
            expect( parseQueryString( 'user[name]=Alice&user=Bob' )).toBeDefined();
            expect( parseQueryString( 'user[a]=1&user[b]=2' )).toEqual({ user : { a : '1', b : '2' } });
            // Empty brackets on an existing object hit the numeric-key scan over Object.keys.
            expect( parseQueryString( 'user[name]=Alice&user[]=extra' )).toEqual({
                user : { name : 'Alice', 0 : 'extra' }
            });
        });

        it( 'decodes percent-encoding and plus spaces', () =>
        {
            expect( parseQueryString( 'search%20term=hello+world&filter%5Bcategory%5D=books%20%26%20magazines' )).toEqual({
                'search term' : 'hello world',
                filter        : { category : 'books & magazines' }
            });
        });

        it( 'tolerates malformed percent-encoding without throwing', () =>
        {
            expect( parseQueryString( '%E0%A4%A' )).toEqual({ '%E0%A4%A' : true });
            expect( parseQueryString( 'a=%ZZ&b=ok' )).toEqual({ a : '%ZZ', b : 'ok' });
            expect( parseQueryString( 'jpUllytbmQ=' )).toBeDefined();
        });

        it( 'blocks prototype pollution patterns', () =>
        {
            const polluted = parseQueryString( '__proto__[polluted]=true&constructor[prototype][bad]=true&prototype[danger]=true&safe=ok' );
            expect( ( polluted as any ).polluted ).toBeUndefined();
            expect( ( Object.prototype as any ).polluted ).toBeUndefined();
            expect( ( Object.prototype as any ).bad ).toBeUndefined();
            expect( ( Object.prototype as any ).danger ).toBeUndefined();
            expect( polluted ).toEqual({ safe : 'ok' });

            expect( parseQueryString( 'constructor=bad&prototype=bad' )).toEqual({});
            expect( parseQueryString( 'user[__proto__]=1&user[constructor]=2&user[prototype]=3' )).toBeDefined();
        });
    });

    describe( 'Coercers', () =>
    {
        it( 'coerceNumber accepts numbers and numeric strings', () =>
        {
            expect( coerceNumber( 0, 'val' )).toBe( 0 );
            expect( coerceNumber( -42.5, 'val' )).toBe( -42.5 );
            expect( coerceNumber( '100', 'val' )).toBe( 100 );
            expect( coerceNumber( '   3.14159   ', 'val' )).toBe( 3.14159 );
        });

        it( 'coerceNumber throws with path for invalid input', () =>
        {
            expect( () => coerceNumber( 'not-a-number', 'user.age' ))
                .toThrow( 'Parse error at "user.age": Type<number>' );
            expect( () => coerceNumber( NaN, 'user.age' )).toThrow( ParseError );
            expect( () => coerceNumber( {}, 'user.age' )).toThrow( /Type<number>/ );
            expect( () => coerceNumber( '', 'user.age' )).toThrow( ParseError );
        });

        it( 'coerceBoolean accepts query-style truthy/falsy forms', () =>
        {
            expect( coerceBoolean( true, 'flag' )).toBe( true );
            expect( coerceBoolean( 'true', 'flag' )).toBe( true );
            expect( coerceBoolean( '1', 'flag' )).toBe( true );
            expect( coerceBoolean( 1, 'flag' )).toBe( true );
            expect( coerceBoolean( 'yes', 'flag' )).toBe( true );
            expect( coerceBoolean( 'on', 'flag' )).toBe( true );
            expect( coerceBoolean( '', 'flag' )).toBe( true );
            expect( coerceBoolean( false, 'flag' )).toBe( false );
            expect( coerceBoolean( 'false', 'flag' )).toBe( false );
            expect( coerceBoolean( '0', 'flag' )).toBe( false );
            expect( coerceBoolean( 0, 'flag' )).toBe( false );
            expect( coerceBoolean( 'no', 'flag' )).toBe( false );
            expect( coerceBoolean( 'off', 'flag' )).toBe( false );

            expect( () => coerceBoolean( 2, 'user.active' )).toThrow( ParseError );
            expect( () => coerceBoolean( {}, 'active' )).toThrow( ParseError );
            expect( () => coerceBoolean( 'maybe', 'active' )).toThrow( ParseError );
        });

        it( 'coerceDate accepts Date, ISO, and epoch', () =>
        {
            const d = new Date( '2026-06-15T12:34:56.789Z' );

            expect( coerceDate( d, 'createdAt' )).toEqual( d );
            expect( coerceDate( '2026-06-15T12:34:56.789Z', 'createdAt' )).toEqual( d );
            expect( coerceDate( d.getTime(), 'createdAt' )).toEqual( d );
            expect( () => coerceDate( 'invalid-date-string', 'event.date' )).toThrow( /Type<Date>/ );
            expect( () => coerceDate( new Date( NaN ), 'event.date' )).toThrow( ParseError );
            expect( () => coerceDate( {}, 'date' )).toThrow( ParseError );
        });

        it( 'coerceArray wraps scalars and maps arrays', () =>
        {
            expect( coerceArray( 'single', 'items', item => item.toUpperCase())).toEqual([ 'SINGLE' ]);
            expect( coerceArray([ 'a', 'b' ], 'items', item => item.toUpperCase())).toEqual([ 'A', 'B' ]);
            expect( coerceArray( null, 'items', item => item )).toEqual([]);
            expect( coerceArray( undefined, 'items', item => item )).toEqual([]);
        });

        it( 'coerceBuffer accepts Buffer, typed arrays, ArrayBuffer, and base64', () =>
        {
            expect( coerceBuffer( Buffer.from( 'hello' ), 'blob' ).toString()).toBe( 'hello' );
            expect( coerceBuffer( Uint8Array.from([ 104, 101, 108, 108, 111 ]), 'blob' ).toString()).toBe( 'hello' );
            expect( coerceBuffer( Uint8Array.from([ 104, 101, 108, 108, 111 ]).buffer, 'blob' ).toString()).toBe( 'hello' );
            expect( coerceBuffer( 'aGVsbG8=', 'blob' ).toString()).toBe( 'hello' );
            expect( () => coerceBuffer( 123 as any, 'blob' )).toThrow( ParseError );
        });

        it( 'coerceBigInt accepts bigint, numeric strings, and integers', () =>
        {
            expect( coerceBigInt( 10n, 'v' )).toBe( 10n );
            expect( coerceBigInt( '99', 'v' )).toBe( 99n );
            expect( coerceBigInt( 7, 'v' )).toBe( 7n );
            expect( () => coerceBigInt( 'nope', 'v' )).toThrow( ParseError );
            expect( () => coerceBigInt( 1.5, 'v' )).toThrow( ParseError );
            expect( () => coerceBigInt( '', 'v' )).toThrow( ParseError );
        });

        it( 'applyParseConstraints fills defaults, transforms, and checks', () =>
        {
            expect( applyParseConstraints( undefined, 'r', [{ type : 'default', value : 'guest' }])).toBe( 'guest' );
            expect( applyParseConstraints( '  Hi  ', 'n', [
                { type : 'transform', value : 'trim' },
                { type : 'transform', value : 'lowercase' },
                { type : 'minLength', value : 2 }
            ])).toBe( 'hi' );
            expect( applyParseConstraints( 'HI', 'n', [{ type : 'transform', value : 'uppercase' }])).toBe( 'HI' );
            expect( applyParseConstraints( 'hello', 'n', [{ type : 'transform', value : 'capitalize' }])).toBe( 'Hello' );
            expect( () => applyParseConstraints( 'x', 'n', [{ type : 'minLength', value : 2 }])).toThrow( /MinLength/ );
            expect( () => applyParseConstraints( 'abcdef', 'n', [{ type : 'maxLength', value : 3 }])).toThrow( /MaxLength/ );
            expect( () => applyParseConstraints( 5, 'n', [{ type : 'minimum', value : 10 }])).toThrow( /Minimum/ );
            expect( () => applyParseConstraints( 50, 'n', [{ type : 'maximum', value : 10 }])).toThrow( /Maximum/ );
            expect( () => applyParseConstraints( 10, 'n', [{ type : 'exclusiveMinimum', value : 10 }])).toThrow( /ExclusiveMinimum/ );
            expect( () => applyParseConstraints( 10, 'n', [{ type : 'exclusiveMaximum', value : 10 }])).toThrow( /ExclusiveMaximum/ );
            expect( () => applyParseConstraints( 7, 'n', [{ type : 'multipleOf', value : 3 }])).toThrow( /MultipleOf/ );
            expect( () => applyParseConstraints( 'abc', 'n', [{ type : 'pattern', value : '^[0-9]+$' }])).toThrow( /Pattern/ );
            expect( () => applyParseConstraints( 'abc', 'n', [{ type : 'pattern', value : 'a'.repeat( 1025 ) }])).toThrow( /UnsafePattern/ );
            expect( () => applyParseConstraints([ 1 ], 'n', [{ type : 'minItems', value : 2 }])).toThrow( /MinItems/ );
            expect( () => applyParseConstraints([ 1, 2, 3 ], 'n', [{ type : 'maxItems', value : 2 }])).toThrow( /MaxItems/ );
            expect( () => applyParseConstraints([ 1, 1 ], 'n', [{ type : 'uniqueItems', value : true }])).toThrow( /UniqueItems/ );
            expect( applyParseConstraints([ 1, 2 ], 'n', [{ type : 'uniqueItems', value : true }])).toEqual([ 1, 2 ]);
            expect( () => applyParseConstraints({ a : 1 }, 'n', [{ type : 'requires', value : 'b' }])).toThrow( /Requires/ );
            expect( applyParseConstraints({ a : 1, b : 2 }, 'n', [{ type : 'requires', value : [ 'a', 'b' ] }])).toEqual({ a : 1, b : 2 });
            expect( () => applyParseConstraints( 'not-an-email', 'n', [{ type : 'format', value : 'email' }])).toThrow();
            expect( applyParseConstraints( 'a@b.co', 'n', [{ type : 'format', value : 'email' }])).toBe( 'a@b.co' );
            expect( applyParseConstraints( '1', 'n', [{ type : 'transform', value : 'tonumber' }])).toBe( 1 );
            expect( applyParseConstraints( 'true', 'n', [{ type : 'transform', value : 'toboolean' }])).toBe( true );
            expect( applyParseConstraints( '2026-01-01T00:00:00.000Z', 'n', [{ type : 'transform', value : 'todate' }])).toBeInstanceOf( Date );
            expect( applyParseConstraints( 'x', 'n', [{ type : 'minLength', value : 1, message : 'too short' }], 'json' )).toBe( 'x' );
            expect( () => applyParseConstraints( '', 'n', [{ type : 'minLength', value : 1, message : 'too short' }])).toThrow( /too short/ );
            expect( () => applyParseConstraints( 'z', 'n', [
                { type : 'message', value : 'custom-msg' },
                { type : 'minLength', value : 2 }
            ])).toThrow( /custom-msg/ );
        });
    });

    describe( 'Generator & buildParser', () =>
    {
        it( 'emits JSON string parser for string types', () =>
        {
            const dummyType: any = { getFlags : () => ts.TypeFlags.String };
            const code = generateParseCode( dummyType, {} as any, { from : 'json' });

            expect( code ).toContain( 'expectString' );
            expect( code ).toContain( 'JSON.parse' );
        });

        it( 'emits a passthrough body for any and unknown', () =>
        {
            for( const flag of [ ts.TypeFlags.Any, ts.TypeFlags.Unknown ])
            {
                const dummyType: any = { getFlags : () => flag };
                const json = generateParseCode( dummyType, {} as any, { from : 'json' });
                const query = generateParseCode( dummyType, {} as any, { from : 'query' });

                expect( json ).toContain( 'JSON.parse' );
                expect( json ).not.toContain( 'expectObject' );
                expect( query ).toContain( 'parseQueryString' );
                expect( query ).not.toContain( 'expectObject' );
            }
        });

        it( 'buildParser caches by type + mode + from', () =>
        {
            const dummyType: any = { getFlags : () => ts.TypeFlags.String };
            const map = new Map<string, ts.Expression>();
            const ref = buildParser( dummyType, {} as any, map, 'hash_parse', { from : 'json', mode : 'strict' });

            expect( map.has( 'hash_parse_strict_json' )).toBe( true );
            expect( ts.isIdentifier( ref ) && ref.text ).toBe( '__parse_hash_parse_strict_json' );

            buildParser( dummyType, {} as any, map, 'hash_parse', { from : 'string', mode : 'strip' });
            expect( map.has( 'hash_parse_strip_string' )).toBe( true );
        });

        it( 'emits string-source parser without parseQueryString', () =>
        {
            const dummyType: any = { getFlags : () => ts.TypeFlags.String };
            const code = generateParseCode( dummyType, {} as any, { from : 'string' });

            expect( code ).toContain( 'expectString' );
            expect( code ).not.toContain( 'parseQueryString' );
            expect( code ).not.toContain( 'JSON.parse' );
        });

        it( 'rejects non-scalar roots for from:string at codegen', () =>
        {
            const objectLike: any = {
                getFlags             : () => ts.TypeFlags.Object,
                getProperties        : () => [],
                getStringIndexType   : () => undefined,
                getNumberIndexType   : () => undefined,
                getSymbol            : () => ({ getName : () => '__object' })
            };

            expect( () => generateParseCode( objectLike, {
                typeToString : () => '{ a: string }',
                isArrayType  : () => false,
                isTupleType  : () => false
            } as any, { from : 'string' })).toThrow( /from: 'string' only supports basic scalar types/ );
        });
    });

    describe( 'Transform (AST)', () =>
    {
        it( 'hoists runtime import for parse-only files', () =>
        {
            const code = compile( `
                import { parse } from './src/index.js';
                interface User { id: string; name: string }
                export function run( json: string ) { return parse<User>( json ); }
            ` );

            expect( code ).toContain( '@webergency-utils/typechecker/runtime' );
            expect( code ).toContain( '__parse_' );
            expect( code ).toContain( 'JSON.parse' );
            expect( code ).toContain( 'expectString' );
        });

        it( 'emits Custom transform and constraint calls for parse', () =>
        {
            const code = compile( `
                import { parse, constraint, transform } from './src/index.js';
                function addPrefix( val: string ) { return 'web_' + val; }
                function startsWithWeb( val: string ) { return val.startsWith( 'web_' ); }
                interface Row {
                    code: string & transform.Custom<typeof addPrefix>;
                    key: string & constraint.Custom<typeof startsWithWeb>;
                }
                export function run( json: string ) { return parse<Row>( json ); }
            ` );

            expect( code ).toContain( 'addPrefix' );
            expect( code ).toContain( 'startsWithWeb' );
            expect( code ).toContain( '__tcRuntime.validators.custom' );
        });

        it( 'compiles JSON modes and nested arrays', () =>
        {
            expect( compile( `
                import { parse } from './src/index.js';
                interface Config { port: number }
                export function run( json: string ) { return parse<Config>( json, { from: 'json', mode: 'strict' } ); }
            ` )).toContain( 'PropertyNotAllowed<' );

            const strip = compile( `
                import { parse } from './src/index.js';
                interface Data { name: string }
                export function run( json: string ) { return parse<Data>( json, { from: 'json', mode: 'strip' } ); }
            ` );
            expect( strip ).not.toContain( 'PropertyNotAllowed<' );

            expect( compile( `
                import { parse } from './src/index.js';
                interface Data { name: string }
                export function run( json: string ) { return parse<Data>( json, { from: 'json', mode: 'relaxed' } ); }
            ` )).toContain( 'res[k] = o[k]' );

            expect( compile( `
                import { parse } from './src/index.js';
                interface Item { id: number }
                interface Order { id: string; items: Item[] }
                export function run( json: string ) { return parse<Order>( json ); }
            ` )).toContain( 'expectArray' );
        });

        it( 'compiles query parsers with coercions and URLSearchParams branch', () =>
        {
            const code = compile( `
                import { parse } from './src/index.js';
                interface SearchQuery { page: number; active: boolean; tag?: string }
                export function run( qs: string ) { return parse<SearchQuery>( qs, { from: 'query', mode: 'strict' } ); }
            ` );
            expect( code ).toContain( '__tcRuntime.parseQueryString' );
            expect( code ).toContain( '__tcRuntime.coerceNumber' );
            expect( code ).toContain( '__tcRuntime.coerceBoolean' );

            const usp = compile( `
                import { parse } from './src/index.js';
                interface Params { id: number }
                export function run( searchParams: URLSearchParams ) { return parse<Params>( searchParams, { from: 'query' } ); }
            ` );
            expect( usp ).toContain( 'instanceof URLSearchParams' );

            expect( compile( `
                import { parse } from './src/index.js';
                interface User { id: string }
                export function run( json: string ) { return parse<User>( json, 'strict' ); }
            ` )).toContain( 'PropertyNotAllowed<' );
        });

        it( 'compiles from:string scalar parsers without parseQueryString', () =>
        {
            const code = compile( `
                import { parse } from './src/index.js';
                export function asString( v: unknown ) { return parse<string>( v, { from: 'string' } ); }
                export function asNumber( v: unknown ) { return parse<number>( v, { from: 'string' } ); }
                export function asBool( v: unknown ) { return parse<boolean>( v, { from: 'string' } ); }
            ` );
            expect( code ).toContain( '__tcRuntime.expectString' );
            expect( code ).toContain( '__tcRuntime.coerceNumber' );
            expect( code ).toContain( '__tcRuntime.coerceBoolean' );
            expect( code ).not.toContain( 'parseQueryString' );

            expect( () => compile( `
                import { parse } from './src/index.js';
                interface Bag { a: string }
                export function run( v: unknown ) { return parse<Bag>( v, { from: 'string' } ); }
            ` )).toThrow( /from: 'string' only supports basic scalar types/ );
        });

        it( 'compiles Buffer / Date parse branches', () =>
        {
            const code = compile( `
                import { parse } from './src/index.js';
                interface FileMeta { createdAt: Date; blob: Buffer }
                export function run( json: string ) { return parse<FileMeta>( json ); }
            ` );
            expect( code ).toContain( '__tcRuntime.coerceDate' );
            expect( code ).toContain( '__tcRuntime.coerceBuffer' );
        });
    });

    describe( 'E2E emitAndImport', () =>
    {
        it( 'parses JSON with modes, optionals, nested arrays, and invalid JSON', async() =>
        {
            const mod = await emitAndImport<{
                parseUser   : ( input: unknown ) => any
                parseStrict : ( input: unknown ) => any
                parseRelaxed : ( input: unknown ) => any
                parseOrder  : ( input: unknown ) => any
            }>( `
                import { parse } from '../src/index.js';
                interface User { id: string; age: number; email?: string }
                interface Order { id: string; items: { id: number }[] }
                export const parseUser = ( input: unknown ) => parse<User>( input );
                export const parseStrict = ( input: unknown ) => parse<User>( input, { mode: 'strict' } );
                export const parseRelaxed = ( input: unknown ) => parse<User>( input, { mode: 'relaxed' } );
                export const parseOrder = ( input: unknown ) => parse<Order>( input );
            `, 'temp_parse_e2e_json' );

            expect( mod.parseUser( '{"id":"1","age":30}' )).toEqual({ id : '1', age : 30 });
            expect( mod.parseUser({ id : '1', age : 30, email : 'a@b.c', drop : true })).toEqual({
                id : '1', age : 30, email : 'a@b.c'
            });
            expect( () => mod.parseStrict({ id : '1', age : 30, drop : true })).toThrow( /PropertyNotAllowed<drop>/ );
            expect( mod.parseRelaxed({ id : '1', age : 30, drop : true }).drop ).toBe( true );
            expect( mod.parseOrder( '{"id":"o1","items":[{"id":1},{"id":2}]}' )).toEqual({
                id : 'o1', items : [{ id : 1 }, { id : 2 }]
            });
            expect( () => mod.parseUser( '{bad' )).toThrow( /Invalid JSON/ );
            expect( () => mod.parseUser({ age : 30 })).toThrow( /Type<string>/ );
        });

        it( 'parses Date and Buffer from JSON', async() =>
        {
            const mod = await emitAndImport<{
                parseFile : ( input: unknown ) => { createdAt: Date; blob: Buffer }
            }>( `
                import { parse } from '../src/index.js';
                interface FileMeta { createdAt: Date; blob: Buffer }
                export const parseFile = ( input: unknown ) => parse<FileMeta>( input );
            `, 'temp_parse_e2e_exotic' );

            const result = mod.parseFile({
                createdAt : '2026-01-01T00:00:00.000Z',
                blob      : 'aGVsbG8='
            });
            expect( result.createdAt.toISOString()).toBe( '2026-01-01T00:00:00.000Z' );
            expect( result.blob.toString()).toBe( 'hello' );
        });

        it( 'parses query strings with coercions and URLSearchParams', async() =>
        {
            const mod = await emitAndImport<{
                parseQs  : ( input: unknown ) => any
                parseUsp : ( input: unknown ) => any
            }>( `
                import { parse } from '../src/index.js';
                interface SearchQuery { page: number; active: boolean; tag?: string; tags?: string[] }
                export const parseQs = ( input: unknown ) => parse<SearchQuery>( input, { from: 'query', mode: 'strict' } );
                export const parseUsp = ( input: unknown ) => parse<SearchQuery>( input, { from: 'query' } );
            `, 'temp_parse_e2e_query' );

            expect( mod.parseQs( 'page=2&active=true&tag=books' )).toEqual({
                page : 2, active : true, tag : 'books'
            });
            expect( mod.parseQs( 'page=1&active=0&tags[]=a&tags[]=b' )).toEqual({
                page : 1, active : false, tags : [ 'a', 'b' ]
            });
            expect( () => mod.parseQs( 'page=1&active=true&rogue=1' )).toThrow( /PropertyNotAllowed<rogue>/ );

            const usp = new URLSearchParams({ page : '3', active : '1' });
            expect( mod.parseUsp( usp )).toEqual({ page : 3, active : true });
        });

        it( 'parses from:string scalars without querystring splitting', async() =>
        {
            const mod = await emitAndImport<{
                asString : ( input: unknown ) => string
                asNumber : ( input: unknown ) => number
                asBool   : ( input: unknown ) => boolean
                asDate   : ( input: unknown ) => Date
                asRegex  : ( input: unknown ) => RegExp
            }>( `
                import { parse } from '../src/index.js';
                export const asString = ( input: unknown ) => parse<string>( input, { from: 'string' } );
                export const asNumber = ( input: unknown ) => parse<number>( input, { from: 'string' } );
                export const asBool = ( input: unknown ) => parse<boolean>( input, { from: 'string' } );
                export const asDate = ( input: unknown ) => parse<Date>( input, { from: 'string' } );
                export const asRegex = ( input: unknown ) => parse<RegExp>( input, { from: 'string' } );
            `, 'temp_parse_e2e_string' );

            expect( mod.asString( 'jpUllytbmQ=' )).toBe( 'jpUllytbmQ=' );
            expect( mod.asString( '100%' )).toBe( '100%' );
            expect( mod.asString( 'a&b=c' )).toBe( 'a&b=c' );
            expect( mod.asNumber( '42' )).toBe( 42 );
            expect( mod.asBool( 'true' )).toBe( true );
            expect( mod.asBool( '0' )).toBe( false );
            expect( mod.asDate( '2026-01-01T00:00:00.000Z' ).toISOString()).toBe( '2026-01-01T00:00:00.000Z' );
            expect( mod.asRegex( 'foo.*bar' )).toEqual( /foo.*bar/ );
            expect( () => mod.asNumber( 'nope' )).toThrow( /Type<number>/ );
        });

        it( 'round-trips stringify(json) → parse and stringify(query) → parse', async() =>
        {
            const mod = await emitAndImport<{
                dumpJson  : ( v: any ) => string
                loadJson  : ( v: unknown ) => any
                dumpQuery : ( v: any ) => string
                loadQuery : ( v: unknown ) => any
            }>( `
                import { stringify, parse } from '../src/index.js';
                interface User { id: string; age: number; active: boolean }
                interface Search { q: string; page: number; tags: string[] }
                export const dumpJson = ( v: User ) => stringify<User>( v );
                export const loadJson = ( v: unknown ) => parse<User>( v );
                export const dumpQuery = ( v: Search ) => stringify<Search>( v, { format: 'query' } );
                export const loadQuery = ( v: unknown ) => parse<Search>( v, { from: 'query' } );
            `, 'temp_parse_e2e_roundtrip' );

            const user = { id : 'u1', age : 41, active : true };
            expect( mod.loadJson( mod.dumpJson( user ))).toEqual( user );

            const search = { q : 'books & maps', page : 4, tags : [ 'a', 'b' ] };
            expect( mod.loadQuery( mod.dumpQuery( search ))).toEqual( search );
        });

        it( 'parses literals, tuples, enums, tagged unions, Record, brands, bigint', async() =>
        {
            const mod = await emitAndImport<{
                parseLit   : ( v: unknown ) => any
                parseTup   : ( v: unknown ) => any
                parseTag   : ( v: unknown ) => any
                parseRec   : ( v: unknown ) => any
                parseBrand : ( v: unknown ) => any
                parseBig   : ( v: unknown ) => any
            }>( `
                import { parse } from '../src/index.js';
                type Status = 'on' | 'off';
                type Pair = [string, number];
                type Shape =
                    | { kind: 'circle'; r: number }
                    | { kind: 'square'; s: number };
                type Scores = Record<string, number>;
                type UserId = string & { __brand: 'UserId' };
                export const parseLit = ( v: unknown ) => parse<Status>( v );
                export const parseTup = ( v: unknown ) => parse<Pair>( v );
                export const parseTag = ( v: unknown ) => parse<Shape>( v );
                export const parseRec = ( v: unknown ) => parse<Scores>( v );
                export const parseBrand = ( v: unknown ) => parse<UserId>( v );
                export const parseBig = ( v: unknown ) => parse<bigint>( v );
            `, 'temp_parse_e2e_parity' );

            expect( mod.parseLit( '"on"' )).toBe( 'on' );
            expect( () => mod.parseLit( '"maybe"' )).toThrow();
            expect( mod.parseTup( '["a",1]' )).toEqual([ 'a', 1 ]);
            expect( () => mod.parseTup( '["a"]' )).toThrow( /Tuple<2>/ );
            expect( mod.parseTag({ kind : 'square', s : 4 })).toEqual({ kind : 'square', s : 4 });
            expect( () => mod.parseTag({ kind : 'triangle' })).toThrow();
            expect( mod.parseRec({ x : 1, y : 2 })).toEqual({ x : 1, y : 2 });
            expect( mod.parseBrand( '"uid"' )).toBe( 'uid' );
            expect( mod.parseBig( '"42"' )).toBe( 42n );
            expect( mod.parseBig( 7 )).toBe( 7n );
        });

        it( 'applies defaults, transforms, and constraints on parse', async() =>
        {
            const mod = await emitAndImport<{
                parseUser : ( v: unknown ) => any
            }>( `
                import { parse, constraint, transform, tag } from '../src/index.js';
                interface User {
                    name: string & transform.Trim & constraint.MinLength<2>;
                    age: number & constraint.Minimum<18>;
                    role?: string & tag.Default<'guest'>;
                }
                export const parseUser = ( v: unknown ) => parse<User>( v );
            `, 'temp_parse_e2e_tags' );

            expect( mod.parseUser({ name : '  ab  ', age : 20 })).toEqual({
                name : 'ab', age : 20, role : 'guest'
            });
            expect( () => mod.parseUser({ name : 'x', age : 20 })).toThrow( /minLength/i );
            expect( () => mod.parseUser({ name : 'ab', age : 10 })).toThrow( /minimum/i );
        });

        it( 'applies transform.Custom and constraint.Custom like assert', async() =>
        {
            const mod = await emitAndImport<{
                parseRow : ( v: unknown ) => any
            }>( `
                import { parse, constraint, transform } from '../src/index.js';
                function addPrefix( val: string ) { return 'web_' + val; }
                function startsWithWeb( val: string ) { return val.startsWith( 'web_' ); }
                interface Row {
                    code: string & transform.Custom<typeof addPrefix>;
                    key: string & constraint.Custom<typeof startsWithWeb>;
                }
                export const parseRow = ( v: unknown ) => parse<Row>( v );
            `, 'temp_parse_e2e_custom' );

            expect( mod.parseRow({ code : 'abc', key : 'web_ok' })).toEqual({
                code : 'web_abc', key : 'web_ok'
            });
            expect( () => mod.parseRow({ code : 'abc', key : 'bad' })).toThrow( /Custom/ );
        });

        it( 'rejects Infinity from query numbers and accepts JSON Infinity', async() =>
        {
            const mod = await emitAndImport<{
                parseQ : ( v: unknown ) => any
                parseJ : ( v: unknown ) => any
            }>( `
                import { parse } from '../src/index.js';
                export const parseQ = ( v: unknown ) => parse<{ n: number }>( v, { from: 'query' } );
                export const parseJ = ( v: unknown ) => parse<{ n: number }>( v );
            `, 'temp_parse_e2e_nan' );

            expect( () => mod.parseQ( 'n=Infinity' )).toThrow( /number/ );
            expect( mod.parseJ({ n : Infinity })).toEqual({ n : Infinity });
            expect( () => mod.parseJ({ n : NaN })).toThrow( /number/ );
        });

        it( 'passes through any and unknown after json/query decode', async() =>
        {
            const mod = await emitAndImport<{
                parseAnyJson   : ( v: unknown ) => any
                parseUnknownJson : ( v: unknown ) => any
                parseAnyQuery  : ( v: unknown ) => any
            }>( `
                import { parse } from '../src/index.js';
                export const parseAnyJson = ( v: unknown ) => parse<any>( v );
                export const parseUnknownJson = ( v: unknown ) => parse<unknown>( v );
                export const parseAnyQuery = ( v: unknown ) => parse<any>( v, { from: 'query' } );
            `, 'temp_parse_e2e_any' );

            expect( mod.parseAnyJson( '{"a":1,"b":"x"}' )).toEqual({ a : 1, b : 'x' });
            expect( mod.parseAnyJson({ keep : true, nested : { n : 2 } })).toEqual({ keep : true, nested : { n : 2 } });
            expect( mod.parseAnyJson( 42 )).toBe( 42 );
            expect( mod.parseAnyJson( 'plain' )).toBe( 'plain' );

            expect( mod.parseUnknownJson( '{"ok":true}' )).toEqual({ ok : true });
            expect( mod.parseUnknownJson([ 1, 2 ])).toEqual([ 1, 2 ]);

            expect( mod.parseAnyQuery( 'a=1&b=two' )).toEqual({ a : '1', b : 'two' });
            expect( mod.parseAnyQuery({ already : 'parsed' })).toEqual({ already : 'parsed' });
            expect( mod.parseAnyQuery( 'bare' )).toBe( 'bare' );
        });
    });
});
