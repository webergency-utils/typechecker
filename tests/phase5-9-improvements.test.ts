import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import * as path from 'path';
import { emitAndImport } from './helpers/compile.js';
import {
    compileSchema,
    getOrCompileSchema,
    createValidator,
    validator as rawValidatorMacro,
    safeSerialize as rawSafeSerializeMacro,
    validators,
    SerializationError,
    convertPropertyCasing,
    validateSchema,
    isSchema
} from '../src/index.js';
import {
    safeSerialize as runtimeSafeSerialize,
    serializeUrl,
    serializeQueryUrl,
    appendQueryAny
} from '../src/runtime/serializer-runtime.js';
import { coerceUrl, parseMap } from '../src/runtime/parse-runtime.js';
import { deepEqual, type ValidationContext } from '../src/runtime/validators.js';
import { compileSchema as subCompileSchema, getOrCompileSchema as subGetOrCompileSchema } from '../src/runtime/schema-compiler.js';
import { resolveTypeIr } from '../src/engine/type-ir.js';
import {
    shouldTransformFile,
    createBundlerTransformer,
    typecheckerVite,
    typecheckerRollup,
    typecheckerEsbuild,
    typecheckerWebpack,
    typecheckerPlugin
} from '../src/unplugin.js';

describe( 'Phases 5–9 Next-Gen Improvements', () =>
{
    describe( 'Phase 5: Schema Compiler Modularity & Lazy Annotations', () =>
    {
        it( 'exposes compileSchema and getOrCompileSchema from root, runtime, and schema-compiler entrypoints', () =>
        {
            expect( compileSchema ).toBe( subCompileSchema );
            expect( getOrCompileSchema ).toBe( subGetOrCompileSchema );

            const schema = {
                type       : 'object',
                properties : { name : { type : 'string' } },
                required   : [ 'name' ]
            };
            const compiled = getOrCompileSchema( schema );
            expect( getOrCompileSchema( schema )).toBe( compiled );
            expect( isSchema( schema, { name : 'Alice' })).toBe( true );
            expect( isSchema( schema, { name : 123 })).toBe( false );
        });

        it( 'preserves full unevaluatedProperties and unevaluatedItems semantics when present', () =>
        {
            const schema = {
                type  : 'object',
                allOf : [
                    {
                        type       : 'object',
                        properties : { a : { type : 'string' } }
                    }
                ],
                unevaluatedProperties : false
            };

            expect( validateSchema( schema, { a : 'ok' }).success ).toBe( true );
            const bad = validateSchema( schema, { a : 'ok', extra : 1 });
            expect( bad.success ).toBe( false );
            expect( bad.errors[0]?.error ).toBe( 'UnevaluatedProperty<extra>' );

            const tupleSchema = {
                type             : 'array',
                prefixItems      : [ { type : 'number' } ],
                unevaluatedItems : false
            };
            expect( validateSchema( tupleSchema, [ 1 ]).success ).toBe( true );
            expect( validateSchema( tupleSchema, [ 1, 2 ]).success ).toBe( false );
        });
    });

    describe( 'Phase 6: Developer Experience Macros (validator<T> & safeSerialize<T>)', () =>
    {
        it( 'createValidator runtime helper supports callable, .validate, .is, .assert, .assertGuard, and ~standard', () =>
        {
            const rawValidator = ( v: any, p: string, ctx: any ) =>
            {
                const obj = validators.object( v, p, ctx, [ 'id', 'name' ], 'User' );

                if( obj === false ){ return v }

                const data = validators.objectShell( obj, ctx, true );
                validators.props( obj, data, p, ctx, [
                    [ 'id', false, validators.number ],
                    [ 'name', false, validators.string ]
                ]);
                validators.stripExtras( data, ctx, [ 'id', 'name' ]);

                return data;
            };

            const checkUser = createValidator<{ id : number, name : string }>( rawValidator, { from : 'query' });

            // Direct call & .validate()
            const res1 = checkUser({ id : '42', name : 'Ada' });
            expect( res1.success ).toBe( true );
            expect( res1.data ).toEqual({ id : 42, name : 'Ada' });

            const res2 = checkUser.validate({ id : '42', name : 'Ada', extra : true }, 'strip' );
            expect( res2.success ).toBe( true );
            expect( res2.data ).toEqual({ id : 42, name : 'Ada' });

            // Override when defaults is string
            const checkStrict = createValidator<{ id : number, name : string }>( rawValidator, 'strip' );
            expect( checkStrict({ id : 1, name : 'A', extra : 1 }).data ).toEqual({ id : 1, name : 'A' });
            expect( checkStrict({ id : 1, name : 'A', extra : 1 }, { mode : 'strict' }).success ).toBe( false );

            const checkNoDefaults = createValidator<{ id : number, name : string }>( rawValidator );
            expect( checkNoDefaults({ id : 1, name : 'A' }, 'strict' ).success ).toBe( true );

            // .is()
            const candidate: unknown = { id : 7, name : 'Bob' };
            expect( checkUser.is( candidate )).toBe( true );
            expect( checkUser.is({ id : 'not-a-num', name : 'Bob' })).toBe( false );

            // .assert() and .assertGuard()
            expect( checkUser.assert({ id : '99', name : 'Eve' })).toEqual({ id : 99, name : 'Eve' });
            expect(() => checkUser.assert({ id : 'bad', name : 'Eve' })).toThrow( /Validation Error/ );

            const guardTarget: unknown = { id : 10, name : 'Dan' };
            expect(() => checkUser.assertGuard( guardTarget )).not.toThrow();
            expect(() => checkUser.assertGuard({ id : 'bad', name : 'Dan' })).toThrow( /Validation Error/ );

            // Standard Schema v1 (~standard)
            const stdSuccess = checkUser['~standard'].validate({ id : '5', name : 'Std' });
            expect( stdSuccess ).toEqual({ value : { id : 5, name : 'Std' } });

            const stdFail = checkUser['~standard'].validate({ id : 'bad', name : 123 });
            expect( 'issues' in stdFail && stdFail.issues?.length ).toBe( 2 );
        });

        it( 'runtimeSafeSerialize catches SerializationError and rethrows unexpected errors', () =>
        {
            const okRes = runtimeSafeSerialize(( x: number ) => String( x ), 42 );
            expect( okRes ).toEqual({ success : true, data : '42' });

            const failRes = runtimeSafeSerialize(() =>
            {
                throw new SerializationError( 'user.age', 'Type<number>' );
            }, 'bad' );
            expect( failRes.success ).toBe( false );

            if( !failRes.success )
            {
                expect( failRes.error ).toBeInstanceOf( SerializationError );
                expect( failRes.error.path ).toBe( 'user.age' );
            }

            expect(() => runtimeSafeSerialize(() =>
            {
                throw new TypeError( 'unexpected boom' );
            }, 'bad' )).toThrow( 'unexpected boom' );
        });

        it( 'throws transformer missing error when validator() or safeSerialize() macro stubs are invoked directly', () =>
        {
            expect(() => rawValidatorMacro()).toThrow( 'Typechecker transformer was not applied' );
            expect(() => rawSafeSerializeMacro({})).toThrow( 'Typechecker transformer was not applied' );
        });

        it( 'transforms validator<T>() and safeSerialize<T>() AOT macros end-to-end', async () =>
        {
            const mod = await emitAndImport<any>( `
                import { validator, safeSerialize, tag } from '../src/index.js';

                export interface Account {
                    id: number;
                    role?: string & tag.Default<'member'>;
                }

                export const checkAccount = validator<Account>({ from: 'query', mode: 'strip' });
                export const serializeSafe = ( input: any ) => safeSerialize<Account>( input );
                export const serializeSafeQuery = ( input: any ) => safeSerialize<Account>( input, { to: 'query' });
            `, 'temp_phase6_macros' );

            const vRes = mod.checkAccount({ id : '101', extra : 'ignored' });
            expect( vRes ).toEqual({
                success : true,
                errors  : [],
                data    : { id : 101, role : 'member' }
            });
            expect( mod.checkAccount.is({ id : 101, role : 'admin' })).toBe( true );
            expect( mod.checkAccount.is({ id : 'not-num' })).toBe( false );
            expect( mod.checkAccount.assert({ id : '202' })).toEqual({ id : 202, role : 'member' });
            expect( mod.checkAccount['~standard'].validate({ id : '303' })).toEqual({
                value : { id : 303, role : 'member' }
            });

            const sOk = mod.serializeSafe({ id : 55, role : 'admin', extra : true });
            expect( sOk ).toEqual({
                success : true,
                data    : '{"id":55,"role":"admin"}'
            });

            const sQueryOk = mod.serializeSafeQuery({ id : 55, role : 'admin' });
            expect( sQueryOk ).toEqual({
                success : true,
                data    : 'id=55&role=admin'
            });

            const sFail = mod.serializeSafe({ id : 'invalid' });
            expect( sFail.success ).toBe( false );
            expect( sFail.error.path ).toBe( 'id' );
        });
    });

    describe( 'Phase 7: First-Class URL, Template-Literal Index Signatures & Multi-Target JSON Schema', () =>
    {
        it( 'supports URL across validate, is, assert, parse, serializer, jsonSchema, compileSchema, and casing', async () =>
        {
            const mod = await emitAndImport<any>( `
                import { is, validate, parse, stringify, jsonSchema } from '../src/index.js';

                export interface Endpoint {
                    url: URL;
                    fallback?: URL | null;
                }

                export const isEndpoint = ( x: unknown ) => is<Endpoint>( x );
                export const validateEndpoint = ( x: unknown, opts?: any ) => validate<Endpoint>( x, opts );
                export const parseEndpointJson = ( s: string ) => parse<Endpoint>( s );
                export const parseEndpointQuery = ( s: string ) => parse<Endpoint>( s, { from: 'query' });
                export const parseUrlString = ( s: string ) => parse<URL>( s, { from: 'string' });
                export const stringifyEndpointJson = ( x: Endpoint ) => stringify<Endpoint>( x );
                export const stringifyEndpointQuery = ( x: Endpoint ) => stringify<Endpoint>( x, { to: 'query' });
                export const endpointSchema = jsonSchema<Endpoint>();
            `, 'temp_phase7_url' );

            const u = new URL( 'https://example.com/api?v=1' );
            expect( mod.isEndpoint({ url : u, fallback : null })).toBe( true );
            expect( mod.isEndpoint({ url : 'https://example.com/api?v=1' })).toBe( false );

            // Revival via from: 'json' and custom from function
            const revived = mod.validateEndpoint({ url : 'https://example.com/path' }, { from : 'json' });
            expect( revived.success ).toBe( true );
            expect( revived.data.url ).toBeInstanceOf( URL );
            expect( revived.data.url.href ).toBe( 'https://example.com/path' );

            const customRevived = mod.validateEndpoint({ url : 'example.com' }, {
                from : ( val: any, ctx: any ) => ctx.kind === 'URL' ? new URL( `https://${val}` ) : val
            });
            expect( customRevived.success ).toBe( true );
            expect( customRevived.data.url.href ).toBe( 'https://example.com/' );

            // Parse from JSON, query, and string
            const parsedJson = mod.parseEndpointJson( JSON.stringify({ url : 'https://webergency.com/test' }));
            expect( parsedJson.url ).toBeInstanceOf( URL );
            expect( parsedJson.url.href ).toBe( 'https://webergency.com/test' );

            const parsedQuery = mod.parseEndpointQuery( 'url=https%3A%2F%2Fwebergency.com%2Fq' );
            expect( parsedQuery.url ).toBeInstanceOf( URL );
            expect( parsedQuery.url.href ).toBe( 'https://webergency.com/q' );

            const parsedStr = mod.parseUrlString( 'https://webergency.com/scalar' );
            expect( parsedStr ).toBeInstanceOf( URL );
            expect( parsedStr.href ).toBe( 'https://webergency.com/scalar' );
            expect(() => mod.parseUrlString( 'not a valid url' )).toThrow( /Type<URL>/ );

            // Stringify to JSON and query
            const jsonOut = mod.stringifyEndpointJson({ url : u });
            expect( JSON.parse( jsonOut )).toEqual({ url : 'https://example.com/api?v=1' });

            const queryOut = mod.stringifyEndpointQuery({ url : u });
            expect( queryOut ).toBe( 'url=' + encodeURIComponent( u.href ));

            // JSON Schema & compileSchema
            expect( mod.endpointSchema.properties.url ).toEqual({
                type                : 'string',
                format              : 'uri',
                'x-typescript-type' : 'URL'
            });
            expect( isSchema( mod.endpointSchema, { url : u })).toBe( true );
            expect( validateSchema( mod.endpointSchema, { url : 'https://example.com' }, { from : 'json' }).success ).toBe( true );

            // convertPropertyCasing preserves URL instances untouched
            const cased = convertPropertyCasing({ endpoint_url : u }, 'camelCase' );
            expect( cased.endpointUrl ).toBe( u );
        });

        it( 'exercises runtime URL and patternProps primitives directly across all branches', () =>
        {
            const u1 = new URL( 'https://example.com/a' );
            const u2 = new URL( 'https://example.com/a' );
            const u3 = new URL( 'https://example.com/b' );

            expect( deepEqual( u1, u2 )).toBe( true );
            expect( deepEqual( u1, u3 )).toBe( false );
            expect( deepEqual( u1, { href : u1.href })).toBe( false );

            // validators.urlInstance
            const makeCtx = ( overrides: Partial<ValidationContext> = {}): ValidationContext => ({
                success : true,
                errors  : [],
                mode    : 'strict',
                ...overrides
            });

            const cOk = makeCtx();
            expect( validators.urlInstance( u1, 'u', cOk )).toBe( u1 );
            expect( cOk.success ).toBe( true );

            const cReviveOk = makeCtx({ from : 'json' });
            const revived = validators.urlInstance( 'https://example.com/revived', 'u', cReviveOk );
            expect( revived ).toBeInstanceOf( URL );
            expect( cReviveOk.success ).toBe( true );

            const cReviveBad = makeCtx({ from : 'json' });
            validators.urlInstance( ':::not-a-url:::', 'u', cReviveBad );
            expect( cReviveBad.success ).toBe( false );

            const cCustomOk = makeCtx({
                from : ( val: any ) => new URL( `https://${val}` )
            });
            expect( validators.urlInstance( 'example.com', 'u', cCustomOk )).toBeInstanceOf( URL );
            expect( cCustomOk.success ).toBe( true );

            const cCustomBad = makeCtx({
                from : () => 'still-not-a-url'
            });
            validators.urlInstance( 'example.com', 'u', cCustomBad );
            expect( cCustomBad.success ).toBe( false );

            // coerceUrl & parseMap('string', 'URL')
            expect( coerceUrl( u1, 'u' )).toBe( u1 );
            expect( coerceUrl( 'https://example.com/c', 'u' ).href ).toBe( 'https://example.com/c' );
            expect(() => coerceUrl( ':::invalid:::', 'u' )).toThrow( /Type<URL>/ );
            expect(() => coerceUrl( '   ', 'u' )).toThrow( /Type<URL>/ );
            expect(() => coerceUrl( 123 as any, 'u' )).toThrow( /Type<URL>/ );

            const urlMap = parseMap({ home : 'https://example.com/' }, 'm', 'json', ( k: any ) => String( k ), coerceUrl );
            expect( urlMap.get( 'home' )).toBeInstanceOf( URL );
            expect(() => parseMap( u1, 'm', 'json', ( k: any ) => String( k ), coerceUrl )).toThrow( /Type<Map>/ );

            // serializeUrl, serializeQueryUrl, serializeQueryPair
            expect( serializeUrl( u1 )).toBe( JSON.stringify( u1.href ));
            expect( serializeUrl( 'https://example.com/s' )).toBe( '"https://example.com/s"' );
            expect(() => serializeUrl( ':::bad:::' )).toThrow( SerializationError );
            expect(() => serializeUrl( 123 as any )).toThrow( SerializationError );

            expect( serializeQueryUrl( u1 )).toBe( encodeURIComponent( u1.href ));
            expect( serializeQueryUrl( 'https://example.com/s' )).toBe( encodeURIComponent( 'https://example.com/s' ));
            expect(() => serializeQueryUrl( ':::bad:::' )).toThrow( SerializationError );
            expect(() => serializeQueryUrl( 123 as any )).toThrow( SerializationError );

            const qParts: string[] = [];
            appendQueryAny( qParts, u1, 'link' );
            appendQueryAny( qParts, new Date( 0 ), 'ts' );
            appendQueryAny( qParts, 42n, 'big' );
            expect( qParts ).toEqual([
                `link=${encodeURIComponent( u1.href )}`,
                `ts=${encodeURIComponent( new Date( 0 ).toISOString())}`,
                'big=42'
            ]);

            // validators.patternProps
            const cNonObj = makeCtx();
            validators.patternProps( null, {}, '', cNonObj, [], [[ /^a_/, validators.number ]]);
            expect( cNonObj.success ).toBe( true );

            // Out-of-place strip with unionProbe + indexValidator fallback
            const probe1 = { stripped : 0, matched : 0 };
            const cStripProbe = makeCtx({ mode : 'strip', mutate : false, unionProbe : probe1 });
            const src1 = { fixed : 'yes', a_1 : '10', other : '20' };
            const dst1: any = { fixed : 'yes' };
            validators.patternProps(
                src1,
                dst1,
                '',
                cStripProbe,
                [ 'fixed' ],
                [[ /^a_/, ( v: any ) => Number( v ) ]],
                ( v: any ) => Number( v )
            );
            expect( dst1 ).toEqual({ fixed : 'yes', a_1 : 10, other : 20 });
            expect( probe1.matched ).toBe( 3 );

            // In-place strip with unmatched key deletion
            const probe2 = { stripped : 0, matched : 0 };
            const cInPlaceStrip = makeCtx({ mode : 'strip', mutate : true, unionProbe : probe2 });
            const mutObj: any = { fixed : 'ok', a_1 : 5, rogue : 99 };
            validators.patternProps(
                mutObj,
                mutObj,
                '',
                cInPlaceStrip,
                new Set([ 'fixed' ]),
                [[ /^a_/, validators.number ]]
            );
            expect( mutObj ).toEqual({ fixed : 'ok', a_1 : 5 });
            expect( probe2 ).toEqual({ stripped : 1, matched : 2 });

            // Strict mode rejection on unmatched key
            const cStrict = makeCtx({ mode : 'strict' });
            validators.patternProps(
                { a_1 : 1, bad : 2 },
                {},
                'root',
                cStrict,
                [],
                [[ /^a_/, validators.number ]]
            );
            expect( cStrict.success ).toBe( false );
            expect( cStrict.errors[0]?.error ).toBe( 'PropertyNotAllowed<bad>' );

            // Relaxed mode out-of-place copies unmatched key
            const cRelaxed = makeCtx({ mode : 'relaxed', mutate : false });
            const dstRelaxed: any = {};
            validators.patternProps(
                { a_1 : 1, extra : 'kept' },
                dstRelaxed,
                '',
                cRelaxed,
                [],
                [[ /^a_/, validators.number ]]
            );
            expect( dstRelaxed ).toEqual({ a_1 : 1, extra : 'kept' });
        });

        it( 'supports template-literal index signatures across validate, parse, serializer, and jsonSchema', async () =>
        {
            const mod = await emitAndImport<any>( `
                import { is, validate, parse, stringify, jsonSchema } from '../src/index.js';

                export interface MetricsBag {
                    service: string;
                    [key: \`metric_\${string}\`]: number;
                }

                export type IdFlags = Record<\`id_\${number}\`, boolean>;

                export const isMetrics = ( x: unknown ) => is<MetricsBag>( x );
                export const validateMetrics = ( x: unknown, opts?: any ) => validate<MetricsBag>( x, opts );
                export const parseMetrics = ( s: string ) => parse<MetricsBag>( s );
                export const parseMetricsStrict = ( s: string ) => parse<MetricsBag>( s, { mode: 'strict' });
                export const parseMetricsRelaxed = ( s: string ) => parse<MetricsBag>( s, { mode: 'relaxed' });
                export const serializeMetrics = ( x: any ) => stringify<MetricsBag>( x );
                export const serializeMetricsStrict = ( x: any ) => stringify<MetricsBag>( x, { mode: 'strict' });
                export const serializeMetricsQuery = ( x: any ) => stringify<MetricsBag>( x, { to: 'query' });
                export const metricsSchema = jsonSchema<MetricsBag>();

                export const validateFlags = ( x: unknown, opts?: any ) => validate<IdFlags>( x, opts );
                export const parseFlags = ( s: string ) => parse<IdFlags>( s );
            `, 'temp_phase7_tpl_idx' );

            const validBag = { service : 'auth', metric_latency : 12, metric_errors : 0 };
            expect( mod.isMetrics( validBag )).toBe( true );
            expect( mod.isMetrics({ service : 'auth', metric_latency : 'bad' })).toBe( false );
            expect( mod.isMetrics({ service : 'auth', other_key : 12 })).toBe( false );

            // Strip mode removes keys that match neither fixed props nor template-literal pattern
            const stripped = mod.validateMetrics(
                { service : 'auth', metric_cpu : 50, rogue_key : 999 },
                'strip'
            );
            expect( stripped.success ).toBe( true );
            expect( stripped.data ).toEqual({ service : 'auth', metric_cpu : 50 });

            // Relaxed mode preserves unmatched keys
            const relaxed = mod.validateMetrics(
                { service : 'auth', metric_cpu : 50, rogue_key : 'kept' },
                'relaxed'
            );
            expect( relaxed.success ).toBe( true );
            expect( relaxed.data ).toEqual({ service : 'auth', metric_cpu : 50, rogue_key : 'kept' });

            // Parse in strip, strict, and relaxed modes
            expect( mod.parseMetrics( JSON.stringify({ service : 'api', metric_rps : 100, unknown : 1 }))).toEqual({
                service    : 'api',
                metric_rps : 100
            });
            expect(() => mod.parseMetricsStrict(
                JSON.stringify({ service : 'api', metric_rps : 100, unknown : 1 })
            )).toThrow( /PropertyNotAllowed<unknown>/ );
            expect( mod.parseMetricsRelaxed(
                JSON.stringify({ service : 'api', metric_rps : 100, unknown : 'ok' })
            )).toEqual({
                service    : 'api',
                metric_rps : 100,
                unknown    : 'ok'
            });

            // Serialize in strip, strict, and query modes
            expect( JSON.parse( mod.serializeMetrics({ service : 'db', metric_qps : 42, extra : 'drop' }))).toEqual({
                service    : 'db',
                metric_qps : 42
            });
            expect(() => mod.serializeMetricsStrict(
                { service : 'db', metric_qps : 42, extra : 'drop' }
            )).toThrow( /PropertyNotAllowed<extra>/ );
            expect( mod.serializeMetricsQuery({ service : 'db', metric_qps : 42, extra : 'drop' })).toBe(
                'service=db&metric_qps=42'
            );

            // JSON Schema patternProperties + compileSchema
            expect( mod.metricsSchema.patternProperties ).toEqual({
                '^metric_.*$' : { type : 'number' }
            });
            expect( isSchema( mod.metricsSchema, validBag )).toBe( true );
            expect( isSchema( mod.metricsSchema, { service : 'auth', other : 1 })).toBe( false );

            // Record<`id_${number}`, boolean>
            expect( mod.validateFlags({ id_1 : true, id_2 : false }).success ).toBe( true );
            expect( mod.validateFlags({ id_abc : true }).success ).toBe( false );
            expect( mod.parseFlags( '{"id_10":true,"id_20":false}' )).toEqual({ id_10 : true, id_20 : false });
        });

        it( 'supports jsonSchema<T>(options) targets: draft-07, draft-2020-12, openapi-3.0, and openapi-3.1', async () =>
        {
            const mod = await emitAndImport<any>( `
                import { jsonSchema } from '../src/index.js';

                export interface NodeItem {
                    kind: 'node';
                    label: string | null;
                    pair: [string, number, ...boolean[]];
                    next?: NodeItem;
                }

                export const sDraft07 = jsonSchema<NodeItem>();
                export const sDraft2020 = jsonSchema<NodeItem>({ target: 'draft-2020-12' });
                export const sOpenApi30 = jsonSchema<NodeItem>( 'openapi-3.0' );
                export const sOpenApi31 = jsonSchema<NodeItem>({ target: 'openapi-3.1' });
            `, 'temp_phase7_schema_targets' );

            // draft-07
            expect( mod.sDraft07.$schema ).toBeUndefined();
            expect( mod.sDraft07.$ref ).toMatch( /^#\/\$defs\/NodeItem_/ );
            const defKey = Object.keys( mod.sDraft07.$defs )[0];
            const d07Def = mod.sDraft07.$defs[defKey];
            expect( Array.isArray( d07Def.properties.pair.items )).toBe( true );
            expect( d07Def.properties.pair.additionalItems ).toEqual({ type : 'boolean' });

            // draft-2020-12
            expect( mod.sDraft2020.$schema ).toBe( 'https://json-schema.org/draft/2020-12/schema' );
            const d2020Def = mod.sDraft2020.$defs[defKey];
            expect( Array.isArray( d2020Def.properties.pair.prefixItems )).toBe( true );
            expect( d2020Def.properties.pair.items ).toEqual({ type : 'boolean' });
            expect( d2020Def.properties.pair.additionalItems ).toBeUndefined();

            // openapi-3.0
            expect( mod.sOpenApi30.$ref ).toBe( `#/components/schemas/${defKey}` );
            expect( mod.sOpenApi30.$defs ).toBeUndefined();
            const oa30Def = mod.sOpenApi30.components.schemas[defKey];
            expect( oa30Def.properties.kind ).toEqual({ type : 'string', enum : [ 'node' ] });
            expect( oa30Def.properties.label ).toEqual({ type : 'string', nullable : true });
            expect( oa30Def.properties.next ).toEqual({ $ref : `#/components/schemas/${defKey}` });

            // compileSchema validates OpenAPI 3.0 schemas (including #/components/schemas and nullable: true)
            expect( isSchema( mod.sOpenApi30, {
                kind  : 'node',
                label : null,
                pair  : [ 'a', 1, true ]
            })).toBe( true );
            expect( isSchema( mod.sOpenApi30, {
                kind  : 'node',
                label : 123,
                pair  : [ 'a', 1 ]
            })).toBe( false );

            // openapi-3.1
            expect( mod.sOpenApi31.$schema ).toBe( 'https://spec.openapis.org/oas/3.1/dialect/base' );
            const oa31Def = mod.sOpenApi31.$defs[defKey];
            expect( Array.isArray( oa31Def.properties.pair.prefixItems )).toBe( true );
        });
    });

    describe( 'Phase 8: Unplugin / Bundler Ecosystem Integration (src/unplugin.ts)', () =>
    {
        it( 'filters files accurately with shouldTransformFile', () =>
        {
            expect( shouldTransformFile( 'import { is } from "@webergency-utils/typechecker";', '/app/src/user.ts' )).toBe( true );
            expect( shouldTransformFile( 'const x = 1;', '/app/src/user.ts' )).toBe( false );
            expect( shouldTransformFile( 'import { is } from "@webergency-utils/typechecker";', '/app/node_modules/pkg/index.ts' )).toBe( false );
            expect( shouldTransformFile( 'import { is } from "@webergency-utils/typechecker";', '/app/src/styles.css' )).toBe( false );
            expect( shouldTransformFile(
                'import { is } from "@webergency-utils/typechecker";',
                '/app/src/custom.ts',
                { include : id => id.endsWith( '.ts' ), exclude : id => id.includes( 'ignore' ) }
            )).toBe( true );
        });

        it( 'transforms TypeScript files via Vite, Rollup, esbuild, and Webpack plugin adapters', () =>
        {
            const sampleFile = path.resolve( process.cwd(), 'src/__virtual_bundler_test.ts' );
            const sourceCode = `
                import { is, validator } from './index.js';
                export interface Item { id: number; name: string; }
                export const checkItem = validator<Item>();
                export const isItem = ( x: unknown ) => is<Item>( x );
            `;

            const vitePlugin = typecheckerVite();
            expect( vitePlugin.name ).toBe( 'webergency-typechecker' );
            expect( vitePlugin.enforce ).toBe( 'pre' );

            const transformed = vitePlugin.transform( sourceCode, sampleFile + '?v=123' );
            expect( transformed ).not.toBeNull();
            expect( transformed!.code ).toContain( 'createValidator' );
            expect( transformed!.code ).toContain( '__val_' );

            // Hot update invalidation
            vitePlugin.handleHotUpdate({ file : sampleFile });

            // Transpile mode (emits JS + sourceMap)
            const transpilingController = createBundlerTransformer({ transpile : true });
            const jsOut = transpilingController.transform( sourceCode, sampleFile );
            expect( jsOut ).not.toBeNull();
            expect( jsOut!.code ).not.toContain( 'export interface Item' );
            expect( jsOut!.map ).toBeDefined();
            transpilingController.invalidate();

            // Rollup adapter
            const rollupPlugin = typecheckerRollup();
            expect( rollupPlugin.transform( 'const plain = 1;', sampleFile )).toBeNull();

            // Webpack adapter
            const webpackPlugin = typecheckerWebpack();
            let tapped = false;
            webpackPlugin.apply({
                hooks : {
                    compilation : {
                        tap : ( _name: string, cb: Function ) =>
                        {
                            cb({
                                hooks : {
                                    normalModuleLoader : {
                                        tap : ( _n: string, innerCb: Function ) =>
                                        {
                                            tapped = true;
                                            innerCb();
                                        }
                                    }
                                }
                            });
                        }
                    }
                }
            });
            expect( tapped ).toBe( true );
            expect( webpackPlugin.transform( 'const plain = 1;', sampleFile )).toBeNull();

            // Esbuild adapter + unified typecheckerPlugin object
            const esbuildPlugin = typecheckerEsbuild();
            expect( esbuildPlugin.name ).toBe( 'webergency-typechecker' );
            expect( typeof typecheckerPlugin ).toBe( 'function' );
            expect( typecheckerPlugin().name ).toBe( 'webergency-typechecker' );
            expect( typecheckerPlugin.vite ).toBe( typecheckerVite );
            expect( typecheckerPlugin.rollup ).toBe( typecheckerRollup );
            expect( typecheckerPlugin.esbuild ).toBe( typecheckerEsbuild );
            expect( typecheckerPlugin.webpack ).toBe( typecheckerWebpack );
        });
    });

    describe( 'Phase 9: Unified TypeNode IR (src/engine/type-ir.ts)', () =>
    {
        it( 'classifies types and caches TypeIrNode per (checker, type)', () =>
        {
            const code = `
                enum Status { Active = 'active', Inactive = 'inactive' }
                type Tpl = \`user_\${number}\`;
                type TplMap = { [key: \`k_\${string}\`]: number; fixed?: string };
                interface AllKinds {
                    str: string;
                    num: number;
                    bool: boolean;
                    big: bigint;
                    sym: symbol;
                    litStr: 'hello';
                    litNum: 42;
                    litBool: true;
                    litBig: 100n;
                    tpl: Tpl;
                    status: Status;
                    arr: string[];
                    tup: [string, number?];
                    dt: Date;
                    url: URL;
                    re: RegExp;
                    st: Set<string>;
                    mp: Map<string, number>;
                    pr: Promise<void>;
                    buf: Uint8Array;
                    fn: (a: number) => string;
                    nullable: string | null | undefined;
                    tplMap: TplMap;
                }
            `;
            const sf = ts.createSourceFile( 'ir-test.ts', code, ts.ScriptTarget.Latest );
            const defaultHost = ts.createCompilerHost({});
            const origGetSf = defaultHost.getSourceFile.bind( defaultHost );
            defaultHost.getSourceFile = ( f, l ) => f === 'ir-test.ts' ? sf : origGetSf( f, l );
            const program = ts.createProgram([ 'ir-test.ts' ], { strict : true }, defaultHost );
            const checker = program.getTypeChecker();

            let ifaceType: ts.Type | undefined;

            for( const stmt of sf.statements )
            {
                if( ts.isInterfaceDeclaration( stmt ) && stmt.name.text === 'AllKinds' )
                {
                    ifaceType = checker.getTypeAtLocation( stmt );
                }
            }

            expect( ifaceType ).toBeDefined();
            const rootIr = resolveTypeIr( ifaceType!, checker );
            expect( resolveTypeIr( ifaceType!, checker )).toBe( rootIr );
            expect( rootIr.kind ).toBe( 'object' );

            const propsByName = new Map( rootIr.getProps().map( p => [ p.name, p.type ]));
            expect( resolveTypeIr( propsByName.get( 'str' )!, checker ).kind ).toBe( 'string' );
            expect( resolveTypeIr( propsByName.get( 'num' )!, checker ).kind ).toBe( 'number' );
            expect( resolveTypeIr( propsByName.get( 'bool' )!, checker ).kind ).toBe( 'boolean' );
            expect( resolveTypeIr( propsByName.get( 'big' )!, checker ).kind ).toBe( 'bigint' );
            expect( resolveTypeIr( propsByName.get( 'sym' )!, checker ).kind ).toBe( 'symbol' );
            expect( resolveTypeIr( propsByName.get( 'litStr' )!, checker ).kind ).toBe( 'literal-string' );
            expect( resolveTypeIr( propsByName.get( 'litNum' )!, checker ).kind ).toBe( 'literal-number' );
            expect( resolveTypeIr( propsByName.get( 'litBool' )!, checker ).kind ).toBe( 'literal-boolean' );
            expect( resolveTypeIr( propsByName.get( 'litBig' )!, checker ).kind ).toBe( 'literal-bigint' );
            expect( resolveTypeIr( propsByName.get( 'tpl' )!, checker ).kind ).toBe( 'template-literal' );
            expect( resolveTypeIr( propsByName.get( 'status' )!, checker ).kind ).toBe( 'enum' );
            expect( resolveTypeIr( propsByName.get( 'arr' )!, checker ).kind ).toBe( 'array' );

            const tupIr = resolveTypeIr( propsByName.get( 'tup' )!, checker );
            expect( tupIr.kind ).toBe( 'tuple' );
            expect( tupIr.getTuple().fixedCount ).toBe( 2 );
            expect( tupIr.getTuple().minItems ).toBe( 1 );

            expect( resolveTypeIr( propsByName.get( 'dt' )!, checker ).kind ).toBe( 'date' );
            expect( resolveTypeIr( propsByName.get( 'url' )!, checker ).kind ).toBe( 'url' );
            expect( resolveTypeIr( propsByName.get( 're' )!, checker ).kind ).toBe( 'regexp' );
            expect( resolveTypeIr( propsByName.get( 'st' )!, checker ).kind ).toBe( 'set' );
            expect( resolveTypeIr( propsByName.get( 'mp' )!, checker ).kind ).toBe( 'map' );
            expect( resolveTypeIr( propsByName.get( 'pr' )!, checker ).kind ).toBe( 'promise' );
            expect( resolveTypeIr( propsByName.get( 'buf' )!, checker ).kind ).toBe( 'buffer' );
            expect( resolveTypeIr( propsByName.get( 'fn' )!, checker ).kind ).toBe( 'function' );

            const nullableIr = resolveTypeIr( propsByName.get( 'nullable' )!, checker );
            expect( nullableIr.kind ).toBe( 'union' );
            expect( nullableIr.getNullableUnionClassification().hasNull ).toBe( true );
            expect( nullableIr.getNullableUnionClassification().hasUndefined ).toBe( true );

            const tplMapIr = resolveTypeIr( propsByName.get( 'tplMap' )!, checker );
            expect( tplMapIr.kind ).toBe( 'object' );
            expect( tplMapIr.getTemplateIndexInfos().length ).toBe( 1 );
            expect( tplMapIr.getTemplateIndexInfos()[0]?.pattern ).toBe( '^k_.*$' );
        });
    });
});
