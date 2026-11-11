import { describe, it, expect, beforeAll, expectTypeOf, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { emitAndImport, compileAndTransform } from './helpers/compile.js';
import pluginInit from '../src/plugin.js';
import {
    typecheckerVite,
    typecheckerRollup,
    typecheckerWebpack,
    shouldTransformFile,
    createBundlerTransformer
} from '../src/unplugin.js';
import webpackLoader from '../src/webpack-loader.js';
import {
    validateSchema,
    isSchema,
    assertGuardSchema,
    compileSchema,
    convertPropertyCasing,
    createValidator,
    type ResolveDefaults,
    type WithModifiers,
    type ConvertPropertyCasing,
    type constraint
} from '../src/index.js';
import {
    isMultipleOfNumber,
    deepEqual,
    hasUniqueItems,
    validators
} from '../src/runtime/validators.js';
import { isSafeRegexSource } from '../src/runtime/regex.js';
import { getValueAtPath, hasPath } from '../src/runtime/path.js';
import { reviveTree } from '../src/runtime/transform.js';
import {
    safeParse as runtimeSafeParse,
    mapParseArray,
    coerceBuffer,
    coerceTypedArray,
    parseJson,
    ParseError
} from '../src/runtime/parse-runtime.js';
import {
    safeSerialize as runtimeSafeSerialize,
    serializeAny,
    applyJsonReplacer,
    SerializationError
} from '../src/runtime/serializer-runtime.js';

const require = createRequire( import.meta.url );

describe( 'Audit Bugfixes Regression Suite (Groups 1-21)', () =>
{
    let aot: Record<string, any>;

    beforeAll( async() =>
    {
        aot = await emitAndImport( `
            import {
                is,
                validate,
                assert,
                parse,
                safeParse,
                stringify,
                safeSerialize,
                jsonSchema,
                validator,
                constraint,
                format,
                transform
            } from '../src/index.js';

            const symKey = Symbol( 'hidden' );

            export declare enum UninitEnum
            {
                First,
                Second = 5,
                Third
            }

            export class SecretVault
            {
                private secret = 'top-secret';
                public label: string;

                constructor( label: string )
                {
                    this.label = label;
                }
            }

            export type NegTagged =
                | { kind : -1; reason : string }
                | { kind : 1; ok : boolean };

            export type Brand<K> = { readonly __brand : K };
            export type UserId = string & Brand<'UserId'> & constraint.MinLength<4>;

            export type IntersectedNested =
                { nested : { a : string }; shared : number } &
                { nested : { b : number }; extra? : boolean };

            export interface ProtoPayload
            {
                toString?  : string
                __proto__? : { safe : boolean }
            }

            export interface NumericIndexBag
            {
                [ index: number ] : boolean
            }

            export interface SymbolIgnored
            {
                visible       : string
                [ symKey ]?   : number
            }

            export type MultiCard =
                ( string | number )[] &
                constraint.Contains<string> &
                constraint.Contains<number>;

            export type MultiPropNames =
                Record<string, number> &
                constraint.PropertyNames<string & constraint.MinLength<2>> &
                constraint.PropertyNames<string & constraint.MaxLength<4>>;

            export type MidTuple = [ string, ...number[], boolean ];
            export type MultilineTpl = \`line1
\${string}\`;

            export type DateStr = string & format.Date & constraint.Pattern<'^2026-'>;

            // Group 1: Negative literals & negative schema bounds
            export const validateNegOne = ( v: unknown ) => validate<-1>( v );
            export const validateNegUnion = ( v: unknown ) => validate<NegTagged>( v );
            export const negTempSchema = jsonSchema<{ temp : number & constraint.Minimum<-10> & constraint.Maximum<-2> }>();

            // Group 2: safeParse & safeSerialize never throw uncaught errors
            export const safeParseQueryObj = ( s: string ) => safeParse<Record<string, any>>( s, { from : 'query' });
            export const safeParseQueryStr = ( s: string ) => safeParse<{ a : string }>( s, { from : 'query' });
            export const safeParseSparseArr = ( s: string ) => safeParse<{ ids : number[] }>( s, { from : 'query' });
            export const safeSerAny = ( v: any ) => safeSerialize<{ x : any }>( v );

            // Group 5: Nominal class with private field
            export class VaultInstance extends SecretVault {}
            export const isSecretVault = ( v: unknown ) => is<SecretVault>( v );
            export const stringifyVault = ( v: SecretVault ) => stringify<SecretVault>( v );

            // Group 6: Unsafe regex fails safely
            export const isUnsafePattern = ( v: unknown ) => is<string & constraint.Pattern<'^(a+)+$'>>( v );

            // Group 7: Prototype pollution & Object.prototype key collisions
            export const validateProto = ( v: unknown ) => validate<ProtoPayload>( v );
            export const parseProto = ( s: string ) => parse<ProtoPayload>( s, { mode : 'strict' });
            export const stringifyRecord = ( v: Record<string, string> ) => stringify<Record<string, string>>( v );

            // Group 8: RegExp round-trip with modern flags
            export const stringifyRegExp = ( v: RegExp ) => stringify<RegExp>( v );
            export const parseRegExp = ( s: string ) => parse<RegExp>( s );
            export const isRegExp = ( v: unknown ) => is<RegExp>( v );

            // Group 9: Non-JSON types & optional tuple round-trip
            export const stringifyNumber = ( v: number ) => stringify<number>( v );
            export const stringifyFn = ( v: () => void ) => stringify<() => void>( v );
            export const stringifySym = ( v: symbol ) => stringify<symbol>( v );
            export const stringifyOptTuple = ( v: [ string, number? ] ) => stringify<[ string, number? ]>( v );
            export const parseOptTuple = ( s: string ) => parse<[ string, number? ]>( s );

            // Group 10: TypedArrays exact runtime instances
            export const parseFloat64 = ( s: string ) => parse<Float64Array>( s );
            export const stringifyFloat64 = ( v: Float64Array ) => stringify<Float64Array>( v );
            export const parseArrayBuffer = ( s: string ) => parse<ArrayBuffer>( s );
            export const parseDataView = ( s: string ) => parse<DataView>( s );

            // Group 11: string & format.Date stays string in query/string
            export const parseDateStrQuery = ( s: string ) => parse<{ d : DateStr }>( s, { from : 'query' });
            export const parseDateStrScalar = ( s: string ) => parse<DateStr>( s, { from : 'string' });
            export const validateDateStrQuery = ( v: unknown ) => validate<{ d : DateStr }>( v, { from : 'query' });

            // Group 13: Union forwards transform
            export const validateUnionTransform = ( v: unknown, tx: any ) =>
                validate<{ a : string } | { b : number }>( v, { transform : tx });

            // Group 14: Deep merged intersections
            export const validateMerged = ( v: unknown ) => validate<IntersectedNested>( v );
            export const parseMerged = ( s: string ) => parse<IntersectedNested>( s, { mode : 'strict' });
            export const mergedSchema = jsonSchema<IntersectedNested>();

            // Group 15: Required unknown / any properties
            export const isReqUnknown = ( v: unknown ) => is<{ a : unknown }>( v );
            export const parseReqUnknown = ( s: string ) => parse<{ a : unknown }>( s );

            // Group 19: Compiler & codegen edge cases
            export const isUpper = ( v: unknown ) => is<Uppercase<string>>( v );
            export const parseLower = ( s: string ) => parse<Lowercase<string>>( s );
            export const stringifyCap = ( v: Capitalize<string> ) => stringify<Capitalize<string>>( v );
            export const isUncap = ( v: unknown ) => is<Uncapitalize<string>>( v );
            export const upperSchema = jsonSchema<Uppercase<string>>();

            export const isUninitEnum = ( v: unknown ) => is<UninitEnum>( v );
            export const isNumericBag = ( v: unknown ) => is<NumericIndexBag>( v );
            export const isSymbolIgnored = ( v: unknown ) => is<SymbolIgnored>( v );
            export const isUserId = ( v: unknown ) => is<UserId>( v );
            export const parseUserId = ( s: string ) => parse<UserId>( s );

            export const validateContainsBool = ( v: unknown ) => validate<( string | boolean )[] & constraint.Contains<boolean>>( v );
            export const safeParseCustomMsg = ( s: string ) =>
                safeParse<string & constraint.MinLength<5> & constraint.Message<'Too short custom'>>( s );
            export const validateMultiCard = ( v: unknown ) => validate<MultiCard>( v );
            export const validateMultiPropNames = ( v: unknown ) => validate<MultiPropNames>( v );

            export type TransformOrderA = string & transform.Trim & transform.LowerCase;
            export type TransformOrderB = string & transform.LowerCase & transform.Trim;
            export const assertOrderA = ( v: unknown ) => assert<TransformOrderA>( v );
            export const assertOrderB = ( v: unknown ) => assert<TransformOrderB>( v );

            export const isMidTuple = ( v: unknown ) => is<MidTuple>( v );
            export const parseMidTuple = ( s: string ) => parse<MidTuple>( s );
            export const stringifyMidTuple = ( v: MidTuple ) => stringify<MidTuple>( v );
            export const midTupleSchema = jsonSchema<MidTuple>();

            export const isMultilineTpl = ( v: unknown ) => is<MultilineTpl>( v );
            export const isVaultCtor = ( v: unknown ) => is<typeof SecretVault>( v );
            export const stringifyNestedRecord = ( v: Record<string, Record<string, number>> ) =>
                stringify<Record<string, Record<string, number>>>( v );

            export const getMutableSchema = () => jsonSchema<{ x : number }>();
            export const emptyTuple2020 = jsonSchema<[]>({ target : 'draft-2020-12' });
            export const exclusiveOpenApi30 = jsonSchema<{ n : number & constraint.ExclusiveMinimum<0> & constraint.ExclusiveMaximum<10> }>({ target : 'openapi-3.0' });

            // Group 21: CompiledValidator.assertGuard
            export const compiledNum = validator<number>();
        `, 'temp_bugfixes_audit_suite' );
    });

    it( 'Group 1: handles negative numeric literals, negative tagged unions, and negative schema bounds', () =>
    {
        // Arrange & Act
        const okNeg = aot.validateNegOne( -1 );
        const badNeg = aot.validateNegOne( 1 );
        const okUnion = aot.validateNegUnion({ kind : -1, reason : 'err' });
        const badUnion = aot.validateNegUnion({ kind : -1, reason : 123 });

        // Assert
        expect( okNeg.success ).toBe( true );
        expect( badNeg.success ).toBe( false );
        expect( okUnion.success ).toBe( true );
        expect( badUnion.success ).toBe( false );
        expect( aot.negTempSchema.properties.temp ).toMatchObject({ minimum : -10, maximum : -2 });
    });

    it( 'Group 2 & 12: catches query shape collisions, sparse query arrays, and non-Error throws in safeParse / safeSerialize', () =>
    {
        // Arrange
        const circular: any = {};
        circular.self = circular;

        // Act
        const collision1 = aot.safeParseQueryObj( 'a=1&a[b]=2' );
        const collision2 = aot.safeParseQueryObj( 'a[0]=1&a[b]=2' );
        const collisionTyped = aot.safeParseQueryStr( 'a=1&a[b]=2' );
        const sparseRes = aot.safeParseSparseArr( 'ids[2]=42' );
        const denseRes = aot.safeParseSparseArr( 'ids[0]=10&ids[1]=20' );
        const bigInAny = aot.safeSerAny({ x : 1n });
        const circInAny = aot.safeSerAny({ x : circular });
        const rawParseThrow = runtimeSafeParse(() => { throw 'string-err' }, 'x' );
        const rawSerThrow = runtimeSafeSerialize(() => { throw 'ser-string-err' }, 'x' );

        // Assert
        expect( collision1 ).toEqual({ success : true, data : { a : { b : '2' } } });
        expect( collision2 ).toEqual({ success : true, data : { a : { 0 : '1', b : '2' } } });
        expect( collisionTyped.success ).toBe( false );
        expect( sparseRes.success ).toBe( false );
        expect( denseRes ).toEqual({ success : true, data : { ids : [ 10, 20 ] } });
        expect( bigInAny.success ).toBe( false );
        expect( circInAny.success ).toBe( false );
        expect( rawParseThrow.success ).toBe( false );
        expect( rawSerThrow.success ).toBe( false );
    });

    it( 'Group 3 & 18: exports callable CJS tsserver plugin, binds LanguageService methods, supports Webpack loader, and preserves directives in hoister', () =>
    {
        // Arrange
        const cjsPluginRoot = require( '../plugin/index.js' );
        const cjsPluginDist = require( '../dist/plugin.cjs' );
        let isBoundToFakeLs = false;
        const fakeLs: any = {
            version                : '1.0',
            getSemanticDiagnostics : function( this: any )
            {
                isBoundToFakeLs = this === fakeLs;

                return [];
            },
            getProgram : () => undefined
        };

        // Act
        const pluginObj = pluginInit({ typescript : ts });
        const proxy = pluginObj.create({ languageService : fakeLs } as any );
        const diags = proxy.getSemanticDiagnostics( 'test.ts' );

        const wpPlugin = typecheckerWebpack({ cwd : process.cwd() });
        const rules: any[] = [];
        wpPlugin.apply({ options : { module : { rules } } });

        const hoistedDirective = compileAndTransform( `
            'use client';
            import { is } from './src/index.js';
            export const check = ( x: unknown ) => is<string>( x );
        `, 'temp_directive_hoist' );

        const ignoredRelative = shouldTransformFile(
            'import { parse } from \'./other/index.js\';',
            path.resolve( './app.ts' )
        );

        // Assert
        expect( typeof cjsPluginRoot ).toBe( 'function' );
        expect( typeof cjsPluginDist ).toBe( 'function' );
        expect( diags ).toEqual([]);
        expect( isBoundToFakeLs ).toBe( true );
        expect( proxy.version ).toBe( '1.0' );
        expect( rules.length ).toBe( 1 );
        expect( hoistedDirective.trimStart().startsWith( '\'use client\';' ) || hoistedDirective.trimStart().startsWith( '"use client";' )).toBe( true );
        expect( ignoredRelative ).toBe( false );
    });

    it( 'Group 3b: executes webpack-loader and Vite/Rollup watch-file tracking cleanly', () =>
    {
        // Arrange
        const tmpDir = path.resolve( './temp_wp_loader_test' );
        fs.mkdirSync( tmpDir, { recursive : true });
        const entryPath = path.join( tmpDir, 'entry.ts' );
        const sharedPath = path.join( tmpDir, 'shared.ts' );
        fs.writeFileSync( sharedPath, 'export interface SharedItem { name: string }\n' );
        const entrySource = 'import { is } from \'../src/index.js\';\nimport type { SharedItem } from \'./shared.js\';\nexport const check = ( v: unknown ) => is<SharedItem>( v );\n';
        fs.writeFileSync( entryPath, entrySource );

        try
        {
            const controller = createBundlerTransformer({ cwd : process.cwd() });
            const deps: string[] = [];
            let asyncResult: { err : any, code? : string } | undefined;

            // Act
            const passthroughSync = webpackLoader.call({}, 'const x = 1;' );
            webpackLoader.call({
                async : () => ( err: any, code?: string ) => { asyncResult = { err, code } }
            }, 'const x = 1;' );

            const syncOut = webpackLoader.call({
                resourcePath  : entryPath,
                getOptions    : () => ({ controller }),
                addDependency : ( dep: string ) => deps.push( dep )
            }, entrySource );

            const vitePlugin = typecheckerVite({ cwd : process.cwd() });
            const watchedVite: string[] = [];
            const viteOut = vitePlugin.transform.call(
                { addWatchFile : ( f: string ) => watchedVite.push( f ) },
                entrySource,
                entryPath
            );

            const rollupPlugin = typecheckerRollup({ cwd : process.cwd() });
            const watchedRollup: string[] = [];
            const rollupOut = rollupPlugin.transform.call(
                { addWatchFile : ( f: string ) => watchedRollup.push( f ) },
                entrySource,
                entryPath
            );

            // Assert
            expect( passthroughSync ).toBe( 'const x = 1;' );
            expect( asyncResult ).toEqual({ err : null, code : 'const x = 1;' });
            expect( typeof syncOut ).toBe( 'string' );
            expect( syncOut ).toContain( '__tcRuntime' );
            expect( deps.some( d => d.endsWith( 'shared.ts' ))).toBe( true );
            expect( viteOut?.code ).toContain( '__tcRuntime' );
            expect( watchedVite.some( d => d.endsWith( 'shared.ts' ))).toBe( true );
            expect( rollupOut?.code ).toContain( '__tcRuntime' );
            expect( watchedRollup.some( d => d.endsWith( 'shared.ts' ))).toBe( true );
        }
        finally
        {
            fs.rmSync( tmpDir, { recursive : true, force : true });
        }
    });

    it( 'Group 4: validates isMultipleOfNumber accurately across large integers, decimals, scientific notation, and infinities', () =>
    {
        // Arrange & Act & Assert
        expect( isMultipleOfNumber( 0, 0.3 )).toBe( true );
        expect( isMultipleOfNumber( 100_000_001, 2 )).toBe( false );
        expect( isMultipleOfNumber( 100_000_002, 2 )).toBe( true );
        expect( isMultipleOfNumber( 500_000.005, 0.01 )).toBe( false );
        expect( isMultipleOfNumber( 500_000.01, 0.01 )).toBe( true );
        expect( isMultipleOfNumber( Number.POSITIVE_INFINITY, 2 )).toBe( false );
        expect( isMultipleOfNumber( 3e-7, 1e-7 )).toBe( true );
        expect( isMultipleOfNumber( 3e-7, 1.5e-7 )).toBe( true );
        expect( isMultipleOfNumber( 3e-15, 1e-15 )).toBe( true );
        expect( isMultipleOfNumber( 1 - 1e-16, 1e-15 )).toBe( true );
        expect( isMultipleOfNumber( 2.5e-15, 1e-15 )).toBe( false );
        expect( isMultipleOfNumber( 1e16, 0.1 )).toBe( true );
    });

    it( 'Group 5: preserves nullable defaults in ResolveDefaults<T> and validates nominal classes with private fields', () =>
    {
        // Arrange
        interface NullableCfg
        {
            token? : ( string | null ) & constraint.MinLength<1>
            port?  : number
        }
        type ResolvedNullable = ResolveDefaults<NullableCfg>;
        const vault = new aot.VaultInstance( 'primary' );
        const impostor = { label : 'primary', secret : 'top-secret' };

        // Act & Assert
        expectTypeOf<ResolvedNullable>().toEqualTypeOf<NullableCfg>();
        expect( aot.isSecretVault( vault )).toBe( true );
        expect( aot.isSecretVault( impostor )).toBe( false );
        expect( JSON.parse( aot.stringifyVault( vault ))).toEqual({ label : 'primary' });
        expect(() => aot.stringifyVault( impostor )).toThrow( 'Type<SecretVault>' );
    });

    it( 'Group 6: detects ReDoS constructs and permits safe fixed-repetition groups in isSafeRegexSource', () =>
    {
        // Arrange & Act & Assert
        expect( isSafeRegexSource( '^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$' )).toBe( true );
        expect( isSafeRegexSource( '^((a+))+$' )).toBe( false );
        expect( isSafeRegexSource( '^(a?)+$' )).toBe( false );
        expect( isSafeRegexSource( '(?<x>a+)\\k<x>' )).toBe( false );
        expect( isSafeRegexSource( '^a*?b+?c??$' )).toBe( true );
        expect( isSafeRegexSource( '^a{abc}$' )).toBe( true );
        expect( isSafeRegexSource( '^a{101}$' )).toBe( false );
        expect( isSafeRegexSource( '^a{0}b{1}c{2}d{2,}$' )).toBe( true );
        expect( isSafeRegexSource( '^a{1,101}$' )).toBe( false );
        expect( isSafeRegexSource( '^a{5,2}$' )).toBe( false );
        expect( isSafeRegexSource( '^a{0,0}b{1,1}c{2,2}d{0,1}e{2,4}$' )).toBe( true );
        expect( isSafeRegexSource( 'abc\\' )).toBe( false );
        expect( isSafeRegexSource( '(?<=a)b(?<!c)d(?<name>e)' )).toBe( true );
        expect( isSafeRegexSource( '(?=a)b(?!c)d(?x)e(f)?' )).toBe( true );
        expect( isSafeRegexSource( '(?<unclosed' )).toBe( false );
        expect( isSafeRegexSource( '(a){101}' )).toBe( false );
        expect( isSafeRegexSource( '((a){2}){2}' )).toBe( true );
        expect( isSafeRegexSource( '((a+)?){2}' )).toBe( false );
        expect( isSafeRegexSource( '((a|a)){2}' )).toBe( false );
        expect( isSafeRegexSource( '((a{2}))+' )).toBe( false );
        expect( aot.isUnsafePattern( 'aaa' )).toBe( false );
    });

    it( 'Group 7: prevents prototype pollution and Object.prototype collisions across validate, parse, stringify, reviveTree, and path helpers', () =>
    {
        // Arrange
        const rawJson = '{"__proto__":{"safe":true},"toString":"ok"}';
        const inherited = Object.assign( Object.create({ leaked : 'bad' }), { own : 'good' });
        const mapRoot = new Map<any, any>([
            [ 'strKey', new Map<any, any>([[ 0, 'zeroVal' ], [ 'idxKey', 'namedVal' ]]) ]
        ]);

        // Act
        const vEmpty = aot.validateProto({});
        const parsed = aot.parseProto( rawJson );
        const serialized = aot.stringifyRecord( inherited );
        const revived = reviveTree(
            JSON.parse( '{"__proto__":1,"constructor":2,"prototype":3}' ),
            ( _k, v ) => v
        );

        // Assert
        expect( vEmpty.success ).toBe( true );
        expect( Object.getPrototypeOf( parsed )).toBe( Object.prototype );
        expect(({} as any ).safe ).toBeUndefined();
        expect( Object.getOwnPropertyDescriptor( parsed, '__proto__' )?.value ).toEqual({ safe : true });
        expect( JSON.parse( serialized )).toEqual({ own : 'good' });
        expect( Object.getOwnPropertyDescriptor( revived, 'constructor' )?.value ).toBe( 2 );
        expect( getValueAtPath( mapRoot, 'strKey[0]' )).toBe( 'zeroVal' );
        expect( getValueAtPath( mapRoot, 'strKey[idxKey]' )).toBe( 'namedVal' );
        expect( hasPath( mapRoot, 'strKey[0]' )).toBe( true );
    });

    it( 'Group 8, 9 & 10: round-trips RegExp flags, optional tuples, TypedArrays, and rejects non-JSON scalars in stringify', () =>
    {
        // Arrange
        const re = new RegExp( '^hello\\/world$', 'dgimsvy' );
        const reU = /^abc$/u;
        const f64 = new Float64Array([ 1.25, -3.5 ]);

        // Act
        const serRe = aot.stringifyRegExp( re );
        const parsedRe = aot.parseRegExp( serRe );
        const parsedReU = aot.parseRegExp( aot.stringifyRegExp( reU ));
        const optTupJson = aot.stringifyOptTuple([ 'a', undefined ]);
        const parsedOptTup = aot.parseOptTuple( optTupJson );
        const serF64 = aot.stringifyFloat64( f64 );
        const parsedF64 = aot.parseFloat64( serF64 );
        const parsedAb = aot.parseArrayBuffer( '"AQIDBA=="' );
        const parsedDv = aot.parseDataView( '"AQIDBA=="' );

        // Assert
        expect( serRe ).toBe( JSON.stringify( '/^hello\\/world$/dgimsvy' ));
        expect( parsedRe ).toBeInstanceOf( RegExp );
        expect( parsedRe.source ).toBe( re.source );
        expect( parsedRe.flags ).toBe( re.flags );
        expect( parsedReU.flags ).toBe( 'u' );
        expect( aot.isRegExp( parsedRe )).toBe( true );

        expect(() => aot.stringifyNumber( Number.POSITIVE_INFINITY )).toThrow( 'Type<number>' );
        expect(() => aot.stringifyFn(() => {})).toThrow();
        expect(() => aot.stringifySym( Symbol( 'x' ))).toThrow();
        expect( parsedOptTup ).toEqual(['a']);

        expect( parsedF64 ).toBeInstanceOf( Float64Array );
        expect( Array.from( parsedF64 )).toEqual([ 1.25, -3.5 ]);
        expect( parsedAb ).toBeInstanceOf( ArrayBuffer );
        expect( parsedDv ).toBeInstanceOf( DataView );
        expect(() => aot.parseFloat64( '"not!valid!base64"' )).toThrow( 'Type<Float64Array>' );
    });

    it( 'Group 10b: covers source-level coerceBuffer, coerceTypedArray, mapParseArray, parseJson, and serializeAny edge branches', () =>
    {
        // Arrange
        const savedBuffer = globalThis.Buffer;
        const bytes = new Uint8Array([ 1, 2, 3, 4, 5, 6, 7, 8 ]);
        const int16 = new Int16Array( bytes.buffer );

        // Act & Assert
        expect( mapParseArray([ 'a', 'b' ], 'arr', ( item, p ) => `${p}:${item}` )).toEqual([ 'arr[0]:a', 'arr[1]:b' ]);
        expect(() => parseJson( 123 )).toThrow( ParseError );
        expect(() => parseJson( '{bad' )).toThrow( ParseError );

        expect( coerceBuffer( Buffer.from([ 1, 2 ]), 'b' )).toBeInstanceOf( Buffer );
        expect( coerceBuffer( bytes, 'b' )).toBeInstanceOf( Buffer );
        expect( coerceBuffer( bytes.buffer, 'b' )).toBeInstanceOf( Buffer );
        expect( coerceBuffer( int16, 'b' )).toBeInstanceOf( Buffer );
        expect( coerceBuffer( 'AQIDBA==', 'b' )).toBeInstanceOf( Buffer );
        expect(() => coerceBuffer( 'bad!base64', 'b' )).toThrow( ParseError );
        expect(() => coerceBuffer( 123, 'b' )).toThrow( ParseError );

        expect( coerceTypedArray( 'AQIDBA==', 'b', 'Buffer' )).toBeInstanceOf( Buffer );
        expect(() => coerceTypedArray( 'AQIDBA==', 'b', 'UnknownTypedArrayCtor' )).toThrow( ParseError );
        expect( coerceTypedArray( int16, 'b', 'Int16Array' )).toBe( int16 );
        expect( coerceTypedArray( bytes, 'b', 'Float64Array' )).toBeInstanceOf( Float64Array );
        expect( coerceTypedArray( int16, 'b', 'Float64Array' )).toBeInstanceOf( Float64Array );
        expect( coerceTypedArray( bytes.buffer, 'b', 'Float64Array' )).toBeInstanceOf( Float64Array );
        expect( coerceTypedArray( bytes, 'b', 'ArrayBuffer' )).toBeInstanceOf( ArrayBuffer );
        expect( coerceTypedArray( bytes, 'b', 'SharedArrayBuffer' )).toBeInstanceOf( SharedArrayBuffer );
        expect( coerceTypedArray( bytes, 'b', 'DataView' )).toBeInstanceOf( DataView );
        expect(() => coerceTypedArray( 'AQID', 'b', 'Float64Array' )).toThrow( ParseError );
        expect(() => coerceTypedArray( 42, 'b', 'Float64Array' )).toThrow( ParseError );

        try
        {
            ( globalThis as any ).Buffer = undefined;
            expect( coerceBuffer( bytes, 'b' )).toBeInstanceOf( Uint8Array );
            expect( coerceBuffer( bytes.buffer, 'b' )).toBeInstanceOf( Uint8Array );
            expect( coerceBuffer( int16, 'b' )).toBeInstanceOf( Uint8Array );
            expect( coerceBuffer( 'AQIDBA==', 'b' )).toBeInstanceOf( Uint8Array );
        }
        finally
        {
            globalThis.Buffer = savedBuffer;
        }

        const srcCircular: any = {};
        srcCircular.self = srcCircular;
        expect( serializeAny( Number.POSITIVE_INFINITY )).toBe( 'null' );
        expect( serializeAny({ toJSON : () => undefined })).toBe( 'null' );
        expect(() => serializeAny( srcCircular, 'p' )).toThrow( SerializationError );
        expect(() => serializeAny({ toJSON : () => { throw 'boom' } }, 'p' )).toThrow( SerializationError );
        expect( applyJsonReplacer( '[1,2]', ( _k, v ) => v )).toBe( '[1,2]' );
        expect( applyJsonReplacer( '{"flt":1e25}', ( _k, v ) => v )).toBe( '{"flt":1e+25}' );
    });

    it( 'Group 11, 13, 14 & 15: preserves string & format.Date type, forwards union transform, deep-merges intersections, and enforces required unknown', () =>
    {
        // Arrange
        const emptyObj = {};

        // Act
        const qDate = aot.parseDateStrQuery( 'd=2026-05-20' );
        const sDate = aot.parseDateStrScalar( '2026-05-20' );
        const vDate = aot.validateDateStrQuery({ d : '2026-05-20' });
        const uTx = aot.validateUnionTransform({ a : 'hello' }, ( val: unknown, ctx: { type : string }) =>
            ( ctx.type === 'string' ? String( val ).toUpperCase() : val )
        );
        const mergedOk = aot.validateMerged({ nested : { a : 'x', b : 2 }, shared : 1 });
        const mergedBad = aot.validateMerged({ nested : { a : 'x' }, shared : 1 });
        const reqUnkFalse = aot.isReqUnknown( emptyObj );
        const reqUnkTrue = aot.isReqUnknown({ a : undefined });

        // Assert
        expect( typeof qDate.d ).toBe( 'string' );
        expect( sDate ).toBe( '2026-05-20' );
        expect( vDate.success ).toBe( true );
        expect( typeof vDate.data.d ).toBe( 'string' );

        expect( uTx.success ).toBe( true );
        expect( uTx.data ).toEqual({ a : 'HELLO' });

        expect( mergedOk.success ).toBe( true );
        expect( mergedBad.success ).toBe( false );
        expect( aot.parseMerged( '{"nested":{"a":"x","b":2},"shared":1}' )).toEqual({ nested : { a : 'x', b : 2 }, shared : 1 });
        expect( aot.mergedSchema.properties.nested.required ).toEqual([ 'a', 'b' ]);

        expect( reqUnkFalse ).toBe( false );
        expect( Object.keys( emptyObj )).toEqual([]);
        expect( reqUnkTrue ).toBe( true );
        expect(() => aot.parseReqUnknown( '{}' )).toThrow( 'Required<a>' );
        expect( validateSchema({ type : 'object', properties : { a : {} }, required : ['a'] }, {}).success ).toBe( false );
    });

    it( 'Group 16: compares NaN, ArrayBuffer, TypedArrays, Error, class prototypes, and cyclic Set/Map in deepEqual & hasUniqueItems', () =>
    {
        // Arrange
        const ab1 = new Uint8Array([ 1, 2 ]).buffer;
        const ab2 = new Uint8Array([ 1, 2 ]).buffer;
        const ab3 = new Uint8Array([ 1, 3 ]).buffer;
        const cycSetA = new Set<any>();
        cycSetA.add( cycSetA );
        const cycSetB = new Set<any>();
        cycSetB.add( cycSetB );

        class BoxA { x = 1; }
        class BoxB { x = 1; }

        // Act & Assert
        expect( hasUniqueItems([{ a : Number.NaN }, { a : Number.NaN }])).toBe( false );
        expect( deepEqual( ab1, ab2 )).toBe( true );
        expect( deepEqual( ab1, ab3 )).toBe( false );
        expect( deepEqual( ab1, {})).toBe( false );
        expect( deepEqual( new Uint8Array([ 1, 2 ]), new Uint8Array([ 1, 2 ]))).toBe( true );
        expect( deepEqual( new Uint8Array([ 1, 2 ]), new Uint8Array([ 1, 3 ]))).toBe( false );
        expect( deepEqual( new Uint8Array([ 1, 2 ]), new Int8Array([ 1, 2 ]))).toBe( false );
        expect( deepEqual( new Error( 'a' ), new Error( 'a' ))).toBe( true );
        expect( deepEqual( new Error( 'a' ), new Error( 'b' ))).toBe( false );
        expect( deepEqual( new Error( 'a' ), { message : 'a' })).toBe( false );
        expect( deepEqual( new BoxA(), { x : 1 })).toBe( false );
        expect( deepEqual( new BoxA(), new BoxB())).toBe( false );
        expect( deepEqual( cycSetA, cycSetB )).toBe( true );
    });

    it( 'Group 17: enforces standard JSON Schema open objects, unevaluatedProperties isolation, $dynamicAnchor, and browser contentEncoding', () =>
    {
        // Arrange
        const openObjSchema = { type : 'object', properties : { a : { type : 'number' } } };
        const ifThenUneval = {
            type                  : 'object',
            if                    : { properties : { kind : { const : 'a' } }, required : ['kind'] },
            then                  : { properties : { kind : { type : 'string' }, aOnly : { type : 'string' } } },
            else                  : { properties : { kind : { type : 'string' }, bOnly : { type : 'string' } } },
            unevaluatedProperties : false
        };
        const allOfUneval = {
            allOf : [
                { type : 'object', properties : { a : { type : 'number' } }, additionalProperties : false }
            ],
            unevaluatedProperties : false
        };
        const anyOfClosedUneval = {
            anyOf : [
                {
                    type                 : 'object',
                    properties           : { a : { type : 'number' }, opt : { type : 'string' } },
                    additionalProperties : false
                }
            ],
            unevaluatedProperties : false
        };
        const cycAllOf = {
            $defs : {
                A : { $ref : '#/$defs/B' },
                B : { $ref : '#/$defs/A' }
            },
            allOf : [{ $ref : '#/$defs/A' }]
        };
        const dynRoot = {
            type       : 'object',
            properties : { child : { $dynamicRef : '#' } }
        };
        const typelessNum = { minimum : 10 };
        const savedBuffer = globalThis.Buffer;

        // Act & Assert
        expect( validateSchema({ type : 'object' }, { extra : 1 }, 'strip' )).toEqual({
            success : true,
            data    : { extra : 1 },
            errors  : []
        });
        expect( validateSchema( openObjSchema, { a : 1, extra : true }, 'strict' ).success ).toBe( true );
        expect( validateSchema( openObjSchema, { a : 1, extra : true }, 'strip' )).toEqual({
            success : true,
            data    : { a : 1 },
            errors  : []
        });
        expect( validateSchema( ifThenUneval, { kind : 'b', aOnly : 'leaked' }).success ).toBe( false );
        expect( validateSchema( ifThenUneval, { kind : 'b', bOnly : 'ok' }).success ).toBe( true );
        expect( validateSchema( allOfUneval, { a : 1, rogue : 2 }).success ).toBe( false );
        expect( validateSchema( allOfUneval, { a : 1 }).success ).toBe( true );
        expect( validateSchema( anyOfClosedUneval, { a : 1 }).success ).toBe( true );
        expect( compileSchema( cycAllOf )).toBeTypeOf( 'function' );
        expect( validateSchema( dynRoot, { child : {} }).success ).toBe( true );
        expect( validateSchema( typelessNum, 5 ).success ).toBe( false );
        expect( validateSchema( typelessNum, 'not-a-number' ).success ).toBe( true );

        try
        {
            ( globalThis as any ).Buffer = undefined;
            const b64Schema = {
                type             : 'string',
                contentEncoding  : 'base64url',
                contentMediaType : 'application/json'
            };
            expect( validateSchema( b64Schema, 'eyJhIjoxfQ' ).success ).toBe( true );
        }
        finally
        {
            globalThis.Buffer = savedBuffer;
        }
    });

    it( 'Group 19, 20 & 21: covers StringMapping, declare enum, middle-rest tuples, constructor types, dynamic option errors, WithModifiers, and narrowing', () =>
    {
        // Arrange
        const mutableTuple: [ string, number, boolean ] = [ 'hi', 42, true ];

        // Act & Assert
        expect( aot.isUpper( 'HELLO' )).toBe( true );
        expect( aot.isUpper( 'Hello' )).toBe( false );
        expect( aot.parseLower( '"hello"' )).toBe( 'hello' );
        expect(() => aot.parseLower( '"Hello"' )).toThrow();
        expect( aot.stringifyCap( 'Hello' )).toBe( '"Hello"' );
        expect(() => aot.stringifyCap( 'hello' )).toThrow();
        expect( aot.isUncap( 'helloWorld' )).toBe( true );
        expect( aot.isUncap( 'HelloWorld' )).toBe( false );
        expect( aot.upperSchema.type ).toBe( 'string' );

        expect( aot.isUninitEnum( 0 )).toBe( true );
        expect( aot.isUninitEnum( 5 )).toBe( true );
        expect( aot.isUninitEnum( 2 )).toBe( true );
        expect( aot.isUninitEnum( 'not-a-number' )).toBe( false );

        expect( aot.isNumericBag({ 0 : true, 1 : false })).toBe( true );
        expect( aot.isNumericBag({ foo : true })).toBe( false );
        expect( aot.isSymbolIgnored({ visible : 'ok' })).toBe( true );

        expect( aot.isUserId( 'abcd' )).toBe( true );
        expect( aot.isUserId( 'ab' )).toBe( false );
        expect( aot.parseUserId( '"abcd"' )).toBe( 'abcd' );

        expect( aot.validateContainsBool([ 'x', false ]).success ).toBe( true );
        expect( aot.validateContainsBool([ 'x', 'y' ]).success ).toBe( false );

        const customMsgFail = aot.safeParseCustomMsg( '"hi"' );
        expect( customMsgFail.success ).toBe( false );
        expect( customMsgFail.error.message ).toContain( 'Too short custom' );

        expect( aot.validateMultiCard([ 'a', 1 ]).success ).toBe( true );
        expect( aot.validateMultiCard([ 'a', 'b' ]).success ).toBe( false );
        expect( aot.validateMultiPropNames({ ab : 1 }).success ).toBe( true );
        expect( aot.validateMultiPropNames({ abcde : 1 }).success ).toBe( false );

        expect( aot.assertOrderA( '  HI  ' )).toBe( 'hi' );
        expect( aot.assertOrderB( '  HI  ' )).toBe( 'hi' );

        expect( aot.isMidTuple([ 'a', true ])).toBe( true );
        expect( aot.isMidTuple([ 'a', 1, 2, false ])).toBe( true );
        expect( aot.isMidTuple([ 'a', 1, 'bad' ])).toBe( false );
        expect( aot.parseMidTuple( '["a",1,2,true]' )).toEqual([ 'a', 1, 2, true ]);
        expect( aot.stringifyMidTuple([ 'a', 1, true ])).toBe( '["a",1,true]' );
        expect( aot.midTupleSchema.minItems ).toBe( 2 );

        // Exercise validators.tuple suffixChecks in both mutate: true (with and without coercion) and mutate: false
        const mutCtx: any = { success : true, errors : [], mode : 'strict', mutate : true, from : 'query' };
        const immutCtx: any = { success : true, errors : [], mode : 'strict', mutate : false, from : 'query' };
        validators.tuple( mutableTuple as any, '', mutCtx, [ validators.string ], 1, validators.number, [ validators.boolean ]);
        const mutCoerceArr: any[] = [ 'hi', '42', 'true' ];
        validators.tuple( mutCoerceArr, '', mutCtx, [ validators.string ], 1, validators.number, [ validators.boolean ]);
        const immutRes = validators.tuple([ 'hi', '42', 'true' ], '', immutCtx, [ validators.string ], 1, validators.number, [ validators.boolean ]);
        expect( mutCtx.success ).toBe( true );
        expect( mutCoerceArr ).toEqual([ 'hi', 42, true ]);
        expect( immutRes ).toEqual([ 'hi', 42, true ]);

        expect( aot.isMultilineTpl( 'line1\nhello' )).toBe( true );
        expect( aot.isVaultCtor( aot.SecretVault )).toBe( true );
        expect( aot.isVaultCtor({})).toBe( false );

        expect(() => aot.stringifyNestedRecord({ outer : { inner : Number.NaN } })).toThrow( 'outer[inner]' );

        const s1 = aot.getMutableSchema();
        s1.properties.x.type = 'corrupted';
        expect( aot.getMutableSchema().properties.x.type ).toBe( 'number' );
        expect( aot.emptyTuple2020.prefixItems ).toBeUndefined();
        expect( aot.emptyTuple2020.maxItems ).toBe( 0 );
        expect( aot.exclusiveOpenApi30.properties.n ).toMatchObject({
            minimum          : 0,
            exclusiveMinimum : true,
            maximum          : 10,
            exclusiveMaximum : true
        });

        // Unconstrained type parameter & dynamic compile-time options must fail at compile time
        expect(() => compileAndTransform( `
            import { is } from './src/index.js';
            export function generic<T>( x: unknown ) { return is<T>( x ); }
        `, 'temp_unconstrained_t' )).toThrow( /type parameter/i );

        expect(() => compileAndTransform( `
            import { parse } from './src/index.js';
            let opts = { mode: 'strict' as const };
            export const p = ( s: string ) => parse<{ a: string }>( s, opts );
        `, 'temp_mutable_let_opts' )).toThrow( /compile-time/i );

        // Group 21: WithModifiers preserves nullability, ConvertPropertyCasing parity, assertGuard narrowing
        type NullableTarget = { profile : { bio : string | null } | null };
        type ModifiedNullable = WithModifiers<NullableTarget, { 'profile.bio' : constraint.MinLength<2> }>;
        expectTypeOf<ModifiedNullable['profile']>().toMatchTypeOf<{ bio : ( string & constraint.MinLength<2> ) | null } | null>();

        const cased = convertPropertyCasing({ userID : 1, 'FOO-BAR' : 2 }, 'snake_case' );
        expect( cased ).toEqual({ user_id : 1, foo_bar : 2 });
        expectTypeOf( cased ).toEqualTypeOf<ConvertPropertyCasing<{ userID : number, 'FOO-BAR' : number }, 'snake_case'>>();

        const unknownVal: unknown = 42;
        aot.compiledNum.assertGuard( unknownVal );
        expect( unknownVal ).toBe( 42 );

        const directCompiled = createValidator<number>(( v: any, p: string, ctx: any ) => validators.number( v, p, ctx ));
        const rawNum: unknown = 99;
        directCompiled.assertGuard( rawNum );
        expect( rawNum ).toBe( 99 );

        const schemaCandidate: unknown = 'hello';

        if( isSchema<string>({ type : 'string' }, schemaCandidate ))
        {
            expectTypeOf( schemaCandidate ).toEqualTypeOf<string>();
        }

        const guardedSchemaCandidate: unknown = 10;
        assertGuardSchema<number>({ type : 'number' }, guardedSchemaCandidate );
        expectTypeOf( guardedSchemaCandidate ).toEqualTypeOf<number>();
        expect( vi.isMockFunction( directCompiled )).toBe( false );
    });
});
