import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import ts from 'typescript';
import { emitAndImport, compileAndTransform, getCachedCompilerHost } from './helpers/compile.js';
import pluginInit from '../src/plugin.js';
import transformer from '../src/transformer.js';
import { createBundlerTransformer } from '../src/unplugin.js';
import { validateSchema, compileSchema } from '../src/index.js';
import
{
    validators,
    report,
    formatDisplayValue,
    formatConstraintMessage,
    extractDateEpochMs,
    splitStringValue,
    splitStringToSet,
    hasOnlyAllowedKeys,
    isMultipleOfValid,
    isMinDateValid,
    isMaxDateValid,
    isFormatValid,
    createValidator,
    type ValidationContext
}
    from '../src/runtime/validators.js';
import
{
    ParseError,
    formatParseMessage,
    applyParseConstraints,
    redactParseSecret
}
    from '../src/runtime/parse-runtime.js';
import
{
    createRng,
    randNumber,
    randBigInt,
    randFormat,
    randString,
    randDate
}
    from '../src/runtime/random-runtime.js';

describe( 'Tier 3 Features, Diagnostics Quick-Fixes, Fast-Path Guards, and Subpath Bundle Pass', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
    });

    afterEach(() =>
    {
        vi.clearAllMocks();
    });

    describe( 'Convenience Domain Tags, Modern Formats & transform.Split', () =>
    {
        it( 'enforces numeric/date shorthand tags, modern ID/auth formats, and transform.Split end-to-end', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                validatePayload : ( input: unknown ) => any
                isPayload       : ( input: unknown ) => boolean
                parsePayload    : ( raw: string ) => any
                randomPayload   : ( seed: number ) => any
                schema          : any
            }>( `
                import {
                    validate,
                    is,
                    parse,
                    random,
                    jsonSchema,
                    constraint,
                    format,
                    transform
                } from '../src/index.js';

                export interface Payload
                {
                    count     : number & constraint.Integer & constraint.NonNegative
                    safe      : number & constraint.SafeInteger & constraint.Positive
                    safeBig   : bigint & constraint.SafeInteger
                    debt      : number & constraint.Negative & constraint.Finite
                    eventDate : Date & constraint.MinDate<'2025-01-01T00:00:00.000Z'> & constraint.MaxDate<'2025-12-31T23:59:59.000Z'>
                    isoDay    : string & format.Date & constraint.MinDate<'2025-02-01'> & constraint.MaxDate<'2025-11-30'>
                    ulid      : string & format.ULID
                    cuid      : string & format.CUID2
                    token     : string & format.JWT
                    version   : string & format.SemVer
                    b64u      : string & format.Base64Url
                    csvTags   : string[] & transform.Split
                    pipeSet   : Set<string> & transform.Split<'|'>
                }

                export const validatePayload = ( input: unknown ) => validate<Payload>( input );
                export const isPayload = ( input: unknown ) => is<Payload>( input );
                export const parsePayload = ( raw: string ) => parse<Payload>( raw );
                export const randomPayload = ( seed: number ) => random<Payload>( seed );
                export const schema = jsonSchema<Payload>();
            `, 'temp_tier3_domain_tags_e2e' );

            const validWire =
            {
                count     : 0,
                safe      : 42,
                safeBig   : '9007199254740991',
                debt      : -12.5,
                eventDate : '2025-06-15T12:00:00.000Z',
                isoDay    : '2025-06-15',
                ulid      : '01ARZ3NDEKTSV4RRFFQ69G5FAV',
                cuid      : 'tz4a98xxat96iws9zmbrgj3a',
                token     : 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
                version   : '1.4.2-rc.1+build.7',
                b64u      : 'SGVsbG9fV29ybGQ-',
                csvTags   : 'alpha,beta,gamma',
                pipeSet   : 'read|write|read'
            };

            // Act
            const parsed = mod.parsePayload( JSON.stringify( validWire ));
            const validated = mod.validatePayload({
                ...parsed,
                csvTags : 'x,y',
                pipeSet : 'one|two'
            });
            const sampled = mod.randomPayload( 2026 );
            const sampledCheck = mod.validatePayload( sampled );

            // Assert
            expect( parsed.csvTags ).toEqual([ 'alpha', 'beta', 'gamma' ]);
            expect([ ...parsed.pipeSet ]).toEqual([ 'read', 'write' ]);
            expect( validated.success ).toBe( true );
            expect( validated.data.csvTags ).toEqual([ 'x', 'y' ]);
            expect([ ...validated.data.pipeSet ]).toEqual([ 'one', 'two' ]);
            expect( mod.isPayload( parsed )).toBe( true );
            expect( sampledCheck.success ).toBe( true );
            expect( mod.schema.properties.count.type ).toBe( 'integer' );
            expect( mod.schema.properties.debt['x-finite']).toBe( true );
            expect( mod.schema.properties.eventDate['x-min-date']).toBe( '2025-01-01T00:00:00.000Z' );
            expect( mod.schema.properties.eventDate['x-max-date']).toBe( '2025-12-31T23:59:59.000Z' );
            expect( mod.schema.properties.ulid.format ).toBe( 'ulid' );
            expect( mod.schema.properties.cuid.format ).toBe( 'cuid2' );
            expect( mod.schema.properties.token.format ).toBe( 'jwt' );
            expect( mod.schema.properties.version.format ).toBe( 'semver' );
            expect( mod.schema.properties.b64u.format ).toBe( 'base64url' );
        });

        it( 'enforces JSDoc equivalents (@integer, @safeInteger, @positive, @nonNegative, @negative, @finite, @minDate, @maxDate, @split)', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                parseDoc    : ( raw: string ) => any
                validateDoc : ( input: unknown ) => any
            }>( `
                import { parse, validate } from '../src/index.js';

                export interface DocConfig
                {
                    /** @integer @nonNegative */
                    retries : number
                    /** @safeInteger @positive */
                    workers : number
                    /** @negative @finite */
                    offset  : number
                    /** @minDate 2025-01-01T00:00:00Z @maxDate 2025-12-31T23:59:59Z */
                    cutoff  : Date
                    /** @split ; */
                    scopes  : string[]
                }

                export const parseDoc = ( raw: string ) => parse<DocConfig>( raw );
                export const validateDoc = ( input: unknown ) => validate<DocConfig>( input );
            `, 'temp_tier3_jsdoc_tags' );

            // Act
            const ok = mod.parseDoc( JSON.stringify({
                retries : 3,
                workers : 4,
                offset  : -5,
                cutoff  : '2025-05-01T00:00:00Z',
                scopes  : 'admin;billing'
            }));
            const bad = mod.validateDoc({
                retries : 1.5,
                workers : 0,
                offset  : Infinity,
                cutoff  : new Date( '2020-01-01T00:00:00Z' ),
                scopes  : ['ok']
            });

            // Assert
            expect( ok.scopes ).toEqual([ 'admin', 'billing' ]);
            expect( bad.success ).toBe( false );
            expect( bad.errors.length ).toBe( 5 );
        });
    });

    describe( 'Interpolation Placeholders ({path}, {value}), Secret Masking, Contradictions (90002) & IDE Quick Fixes', () =>
    {
        it( 'interpolates {path} and {value} and masks tag.Secret values across validate, parse, and compileSchema', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                checkAccount : ( input: unknown ) => any
                parseAccount : ( raw: string ) => any
            }>( `
                import { validate, parse, constraint, tag } from '../src/index.js';

                export interface Account
                {
                    age    : number & constraint.Minimum<18, '{path} rejected {value}'>
                    apiKey : string & tag.Secret & constraint.MinLength<16, '{path} rejected {value}'>
                }

                export const checkAccount = ( input: unknown ) => validate<Account>( input );
                export const parseAccount = ( raw: string ) => parse<Account>( raw );
            `, 'temp_tier3_placeholders_secret' );

            const badInput = { age : 12, apiKey : 'top-secret' };

            // Act
            const valRes = mod.checkAccount( badInput );
            let parseErrMessage = '';

            try
            {
                mod.parseAccount( JSON.stringify({ age : 21, apiKey : 'top-secret' }));
            }
            catch( e: any )
            {
                parseErrMessage = e.message;
            }

            const schemaRes = validateSchema(
                {
                    type : 'object',
                    properties :
                    {
                        secretCombo :
                        {
                            'x-secret' : true,
                            allOf      : [{ type : 'string', minLength : 10 }],
                            oneOf      : [{ type : 'string', maxLength : 20 }, { type : 'string', minLength : 50 }],
                            anyOf      : [{ type : 'string', pattern : '^sk_' }],
                            not        : { const : 'forbidden' },
                            if         : { type : 'string' },
                            then       : { minLength : 12 }
                        },
                        secretList :
                        {
                            'x-secret' : true,
                            type       : 'array',
                            contains   : { type : 'string', minLength : 8 }
                        }
                    }
                },
                { secretCombo : 'forbidden', secretList : ['short'] }
            );

            // Assert
            expect( valRes.success ).toBe( false );
            expect( valRes.errors ).toEqual([
                { path : 'age', value : 12, error : 'age rejected 12' },
                { path : 'apiKey', value : '[REDACTED]', error : 'apiKey rejected [REDACTED]' }
            ]);
            expect( parseErrMessage ).toContain( 'apiKey rejected [REDACTED]' );
            expect( parseErrMessage ).not.toContain( 'top-secret' );
            expect( schemaRes.success ).toBe( false );

            for( const err of schemaRes.errors )
            {
                expect( JSON.stringify( err )).not.toContain( 'forbidden' );
                expect( JSON.stringify( err )).not.toContain( 'short' );
            }
        });

        it( 'reports compile-time contradiction diagnostics (90002) and literal placeholder messages (90001)', () =>
        {
            // Arrange
            const tempFile = path.resolve( './temp_tier3_contradictions.ts' );
            const sourceCode = `
                import { constraint, tag } from './src/index.js';
                type BadNumRange = number & constraint.Minimum<10> & constraint.Maximum<5>;
                type BadExclRange = number & constraint.ExclusiveMinimum<5> & constraint.Maximum<5>;
                type BadPosNeg = number & constraint.Positive & constraint.Negative;
                type BadMultZero = number & constraint.MultipleOf<0>;
                type BadStrLen = string & constraint.MinLength<8> & constraint.MaxLength<3>;
                type BadItems = string[] & constraint.MinItems<5> & constraint.MaxItems<2>;
                type BadProps = Record<string, number> & constraint.MinProperties<4> & constraint.MaxProperties<1>;
                type BadDates = Date & constraint.MinDate<'2026-01-01'> & constraint.MaxDate<'2025-01-01'>;
                type BadInvalidDate = Date & constraint.MinDate<'not-a-valid-date'>;
                type BadUnsafeRegex = string & constraint.Pattern<'(a+)+$'>;

                const badAge: number & constraint.Minimum<18, '{path} got {value}'> = 10;
                const badSecret: string & tag.Secret & constraint.MinLength<10, '{path} got {value}'> = 'my-secret';
            `;
            const virtualFiles = new Map<string, string>([[ tempFile, sourceCode ]]);
            const opts: ts.CompilerOptions =
            {
                target           : ts.ScriptTarget.ES2022,
                module           : ts.ModuleKind.NodeNext,
                moduleResolution : ts.ModuleResolutionKind.NodeNext,
                skipLibCheck     : true,
                strict           : true
            };
            const host = getCachedCompilerHost( opts, virtualFiles );
            const program = ts.createProgram([tempFile], opts, host );

            // Act
            transformer( program );
            const sf = program.getSourceFile( tempFile )!;
            const diags = program.getSemanticDiagnostics( sf ).filter( d => d.source === 'webergency-typechecker' );
            const codes = diags.map( d => d.code );
            const msgs = diags.map( d => String( d.messageText ));

            // Assert
            expect( codes.filter( c => c === 90002 ).length ).toBe( 10 );
            expect( codes.filter( c => c === 90001 ).length ).toBe( 2 );
            expect( msgs.some( m => m.includes( 'badAge got 10' ))).toBe( true );
            expect( msgs.some( m => m.includes( 'badSecret got [REDACTED]' ))).toBe( true );
            expect( msgs.some( m => m.includes( 'my-secret' ))).toBe( false );
        });

        it( 'provides LSP getCodeFixesAtPosition quick fixes for 90002 bound swaps, 90001 literal clamping, and all plugin guard seams', () =>
        {
            // Arrange
            const tempFile = path.resolve( './temp_tier3_plugin_fixes.ts' );
            const sourceCode = [
                "import { constraint } from './src/index.js';",
                'type BadBounds = number & constraint.Minimum<20> & constraint.Maximum<5>;',
                'const tooLow: number & constraint.Minimum<18> = 12;',
                'const okVal = 42;'
            ].join( '\n' );
            const virtualFiles = new Map<string, string>([[ tempFile, sourceCode ]]);
            const opts: ts.CompilerOptions =
            {
                target           : ts.ScriptTarget.ES2022,
                module           : ts.ModuleKind.NodeNext,
                moduleResolution : ts.ModuleResolutionKind.NodeNext,
                skipLibCheck     : true,
                strict           : true
            };
            const host = getCachedCompilerHost( opts, virtualFiles );
            const program = ts.createProgram([tempFile], opts, host );

            const baseFix: ts.CodeFixAction =
            {
                fixName     : 'base-fix',
                description : 'Base TS fix',
                changes     : []
            };
            const mockLsWithBase =
                {
                    getProgram             : () => program,
                    getSemanticDiagnostics : () => [],
                    getCodeFixesAtPosition : () => [baseFix]
                } as unknown as ts.LanguageService;

            const mockLsWithoutCodeFixes =
                {
                    getProgram             : () => program,
                    getSemanticDiagnostics : () => []
                } as unknown as ts.LanguageService;

            const mockLsNoProgram =
                {
                    getProgram             : () => undefined,
                    getSemanticDiagnostics : () => [],
                    getCodeFixesAtPosition : () => [baseFix]
                } as unknown as ts.LanguageService;

            const factory = pluginInit({ typescript : ts });
            const proxyWithBase = factory.create({ languageService : mockLsWithBase } as ts.server.PluginCreateInfo );
            const proxyWithoutBase = factory.create({ languageService : mockLsWithoutCodeFixes } as ts.server.PluginCreateInfo );
            const proxyNoProgram = factory.create({ languageService : mockLsNoProgram } as ts.server.PluginCreateInfo );

            const boundsPos = sourceCode.indexOf( 'constraint.Minimum<20>' );
            const literalPos = sourceCode.indexOf( '12' );
            const plainPos = sourceCode.indexOf( '42' );

            // Act
            const swapFixes = proxyWithBase.getCodeFixesAtPosition(
                tempFile,
                boundsPos,
                boundsPos + 10,
                [90002],
                {},
                {}
            );
            const clampFixes = proxyWithoutBase.getCodeFixesAtPosition(
                tempFile,
                literalPos,
                literalPos + 2,
                [90001],
                {},
                {}
            );
            const noMatchFixes = proxyWithBase.getCodeFixesAtPosition(
                tempFile,
                plainPos,
                plainPos + 2,
                [90001],
                {},
                {}
            );
            const nodeModulesFixes = proxyWithBase.getCodeFixesAtPosition(
                '/project/node_modules/pkg/index.ts',
                0,
                1,
                [90001],
                {},
                {}
            );
            const noProgFixes = proxyNoProgram.getCodeFixesAtPosition(
                tempFile,
                literalPos,
                literalPos + 2,
                [90001],
                {},
                {}
            );

            // Assert
            expect( swapFixes.length ).toBe( 2 );
            expect( swapFixes[0]).toBe( baseFix );
            expect( swapFixes[1].fixName ).toBe( 'swapConstraintBounds' );
            expect( swapFixes[1].changes[0].textChanges.length ).toBe( 2 );

            expect( clampFixes.length ).toBe( 1 );
            expect( clampFixes[0].fixName ).toBe( 'clampLiteralToBound' );
            expect( clampFixes[0].changes[0].textChanges[0].newText ).toBe( '18' );

            expect( noMatchFixes ).toEqual([baseFix]);
            expect( nodeModulesFixes ).toEqual([baseFix]);
            expect( noProgFixes ).toEqual([baseFix]);
        });
    });

    describe( 'Zero-Allocation Fast-Path is<T>(), Subpath AOT Imports & V3 Source Maps', () =>
    {
        it( 'matches validate<T>(x).success across complex fast-path shapes and falls back cleanly on mutating tags', async() =>
        {
            // Arrange
            const mod = await emitAndImport<{
                isComplex       : ( v: unknown ) => boolean
                validateComplex : ( v: unknown ) => any
                isWithDefault   : ( v: unknown ) => boolean
                userValidator   : any
            }>( `
                import { is, validate, validator, tag, constraint, format } from '../src/index.js';

                class CustomToken
                {
                    code = 'ok';
                }

                type TaggedShape =
                    | { kind : 'card', digits : string & constraint.Length<4, 4> }
                    | { kind : 'cash', amount : number & constraint.Positive };

                interface ComplexGraph
                {
                    id      : string & format.UUID
                    created : Date
                    tags    : Set<string>
                    scores  : Map<string, number>
                    pair    : [string, number?, ...boolean[]]
                    payment : TaggedShape
                    token   : CustomToken
                    next?   : ComplexGraph
                }

                interface WithDefault
                {
                    role? : string & tag.Default<'member'>
                }

                export const isComplex = ( v: unknown ) => is<ComplexGraph>( v );
                export const validateComplex = ( v: unknown ) => validate<ComplexGraph>( v );
                export const isWithDefault = ( v: unknown ) => is<WithDefault>( v );
                export const userValidator = validator<{ id : number }>();
                export const makeToken = () => new CustomToken();
            `, 'temp_tier3_fast_guard_parity' ) as any;

            const validGraph =
            {
                id      : '550e8400-e29b-41d4-a716-446655440000',
                created : new Date( '2025-03-01T00:00:00Z' ),
                tags    : new Set([ 'a', 'b' ]),
                scores  : new Map([[ 'math', 100 ]]),
                pair    : [ 'head', 1, true, false ],
                payment : { kind : 'card', digits : '1234' },
                token   : mod.makeToken()
            };
            const invalidCandidates =
            [
                { ...validGraph, extraUndeclared : true },
                { ...validGraph, created : new Date( 'invalid' ) },
                { ...validGraph, pair : ['only', 'wrong'] },
                { ...validGraph, payment : { kind : 'card', digits : '12' } },
                { ...validGraph, token : {} }
            ];
            const mutableObj: Record<string, unknown> = {};

            // Act
            const validGuard = mod.isComplex( validGraph );
            const validFull = mod.validateComplex( validGraph ).success;
            const defaultGuardResult = mod.isWithDefault( mutableObj );
            const strictCompiledIs = mod.userValidator.is({ id : 7 });
            const strictCompiledRejectExtra = mod.userValidator.is({ id : 7, extra : 1 });
            const relaxedOverrideIs = mod.userValidator.is({ id : 7, extra : 1 }, 'relaxed' );

            // Assert
            expect( validGuard ).toBe( true );
            expect( validFull ).toBe( true );

            for( const candidate of invalidCandidates )
            {
                expect( mod.isComplex( candidate )).toBe( mod.validateComplex( candidate ).success );
                expect( mod.isComplex( candidate )).toBe( false );
            }

            expect( defaultGuardResult ).toBe( true );
            expect( mutableObj.role ).toBe( 'member' );
            expect( strictCompiledIs ).toBe( true );
            expect( strictCompiledRejectExtra ).toBe( false );
            expect( relaxedOverrideIs ).toBe( true );
        });

        it( 'emits zero runtime imports for pure guards, single subpath imports for single-domain files, and distinct namespaces for multi-domain files', () =>
        {
            // Arrange
            const pureGuardCode = `
                import { is } from '../src/index.js';
                export const check = ( x: unknown ) => is<string[]>( x );
            `;
            const parseOnlyCode = `
                import { parse } from '../src/index.js';
                export const load = ( raw: string ) => parse<{ id : number }>( raw );
            `;
            const multiDomainCode = `
                import { validate, parse, stringify, clone, random } from '../src/index.js';
                interface Item { id : number; meta : unknown }
                export const v = ( x: unknown ) => validate<Item>( x );
                export const p = ( s: string ) => parse<Item>( s );
                export const s = ( i: Item ) => stringify<Item>( i );
                export const c = ( i: Item ) => clone<Item>( i );
                export const r = () => random<Item>( 1 );
            `;

            // Act
            const pureOut = compileAndTransform( pureGuardCode, 'temp_tier3_pure_guard' );
            const parseOut = compileAndTransform( parseOnlyCode, 'temp_tier3_parse_only' );
            const multiOut = compileAndTransform( multiDomainCode, 'temp_tier3_multi_domain' );

            // Assert
            expect( pureOut ).not.toContain( '@webergency-utils/typechecker/runtime' );
            expect( pureOut ).toMatch( /const __is_[a-f0-9]+ =/ );

            expect( parseOut ).toContain( '"@webergency-utils/typechecker/runtime/parse"' );
            expect( parseOut ).not.toContain( '"@webergency-utils/typechecker/runtime/validators"' );

            expect( multiOut ).toContain( '"@webergency-utils/typechecker/runtime/validators"' );
            expect( multiOut ).toContain( '"@webergency-utils/typechecker/runtime/serialize"' );
            expect( multiOut ).toContain( '"@webergency-utils/typechecker/runtime/parse"' );
            expect( multiOut ).toContain( '"@webergency-utils/typechecker/runtime/clone"' );
            expect( multiOut ).toContain( '"@webergency-utils/typechecker/runtime/random"' );
        });

        it( 'produces valid V3 source maps in createBundlerTransformer for both transpile: false and transpile: true', () =>
        {
            // Arrange
            const virtualPath = path.resolve( './src/__virtual_tier3_sourcemap__.ts' );
            const code = [
                "import { validate } from './index.js';",
                'export interface Box { value : number }',
                'export function runBox( x: unknown ) {',
                '    return validate<Box>( x );',
                '}'
            ].join( '\n' );
            const rawBundler = createBundlerTransformer({ transpile : false });
            const jsBundler = createBundlerTransformer({ transpile : true });

            // Act
            const rawRes = rawBundler.transform( code, virtualPath );
            const jsRes = jsBundler.transform( code, virtualPath );

            // Assert
            expect( rawRes ).not.toBeNull();
            expect( rawRes!.map.version ).toBe( 3 );
            expect( rawRes!.map.sources ).toEqual([ virtualPath.replace( /\\/g, '/' ) ]);
            expect( rawRes!.map.sourcesContent ).toEqual([code]);
            expect( typeof rawRes!.map.mappings ).toBe( 'string' );
            expect( rawRes!.map.mappings.length ).toBeGreaterThan( 0 );

            expect( jsRes ).not.toBeNull();
            expect( jsRes!.map.version ).toBe( 3 );
            expect( jsRes!.map.sources ).toEqual([ virtualPath.replace( /\\/g, '/' ) ]);
            expect( jsRes!.map.sourcesContent ).toEqual([code]);
            expect( typeof jsRes!.map.mappings ).toBe( 'string' );
            expect( jsRes!.map.mappings.length ).toBeGreaterThan( 0 );
        });
    });

    describe( 'Direct Runtime Unit Coverage Matrix (validators, parse-runtime, random-runtime, schema-compiler)', () =>
    {
        it( 'covers all branches of formatDisplayValue, formatConstraintMessage, extractDateEpochMs, split helpers, and report secretDepth', () =>
        {
            // Arrange
            const circular: Record<string, unknown> = {};
            circular.self = circular;
            const sym = Symbol( 'tag' );
            const secretCtx: ValidationContext = { success : true, errors : [], mode : 'strict', secretDepth : 1 };
            const plainCtx: ValidationContext = { success : true, errors : [], mode : 'strict' };

            // Act & Assert
            expect( formatDisplayValue( 'abc' )).toBe( '"abc"' );
            expect( formatDisplayValue( 42 )).toBe( '42' );
            expect( formatDisplayValue( false )).toBe( 'false' );
            expect( formatDisplayValue( 99n )).toBe( '99n' );
            expect( formatDisplayValue( null )).toBe( 'null' );
            expect( formatDisplayValue( undefined )).toBe( 'undefined' );
            expect( formatDisplayValue( new Date( '2025-01-01T00:00:00.000Z' ))).toBe( '2025-01-01T00:00:00.000Z' );
            expect( formatDisplayValue( new Date( 'invalid' ))).toBe( 'Invalid Date' );
            expect( formatDisplayValue([ 1, 2 ])).toBe( '[1,2]' );
            expect( formatDisplayValue({ a : 1 })).toBe( '{"a":1}' );
            expect( formatDisplayValue( circular )).toBe( '[object Object]' );
            expect( formatDisplayValue( sym )).toBe( 'Symbol(tag)' );

            expect( formatConstraintMessage( 'plain message', 'field', 123 )).toBe( 'plain message' );
            expect( formatConstraintMessage( 'at {path}: {value}', '', 5 )).toBe( 'at root: 5' );
            expect( formatConstraintMessage( 'at {path}: {value}', 'user.pin', 1234, true )).toBe( 'at user.pin: [REDACTED]' );

            expect( extractDateEpochMs( new Date( 1000 ))).toBe( 1000 );
            expect( extractDateEpochMs( '1970-01-01T00:00:02.000Z' )).toBe( 2000 );
            expect( extractDateEpochMs( 3000 )).toBe( 3000 );
            expect( extractDateEpochMs( true )).toBeUndefined();

            expect( splitStringValue( 123, ',' )).toBe( 123 );
            expect( splitStringValue( '', ',' )).toEqual([]);
            expect( splitStringValue( '', '' )).toEqual([]);
            expect( splitStringValue( 'a,b', ',' )).toEqual([ 'a', 'b' ]);

            expect( splitStringToSet( 123, ',' )).toBe( 123 );
            expect([ ...splitStringToSet( '', ',' ) ]).toEqual([]);
            expect([ ...splitStringToSet( '', '' ) ]).toEqual([]);
            expect([ ...splitStringToSet( 'a,b,a', ',' ) ]).toEqual([ 'a', 'b' ]);

            report( secretCtx, 'pin', 'Minimum<4>', '0000', '{path}={value}' );
            report( plainCtx, 'pin', 'Minimum<4>', '0000', '{path}={value}' );
            expect( secretCtx.errors[0].error ).toBe( 'pin=[REDACTED]' );
            expect( plainCtx.errors[0].error ).toBe( 'pin="0000"' );
        });

        it( 'covers all branches of JWT, SemVer, Base64Url, ULID, CUID2, numeric/date validators, boolean guard helpers, and createValidator fastIs', () =>
        {
            // Arrange
            const makeCtx = (): ValidationContext => ({ success : true, errors : [], mode : 'strict' });
            const allowed = new Set([ 'a', 'b' ]);

            // Act & Assert — JWT & SemVer & new formats
            expect( isFormatValid( 'only.two', 'jwt' )).toBe( false );
            expect( isFormatValid( '.b.c', 'jwt' )).toBe( false );
            expect( isFormatValid( 'a.bb.cc', 'jwt' )).toBe( false );
            expect( isFormatValid( 'ab.cd$.ef', 'jwt' )).toBe( false );
            expect( isFormatValid( 'eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiIxIn0.c2ln', 'jwt' )).toBe( true );

            expect( isFormatValid( '', 'semver' )).toBe( false );
            expect( isFormatValid( '1.0.0+' + 'a'.repeat( 260 ), 'semver' )).toBe( false );
            expect( isFormatValid( '1.0.0+', 'semver' )).toBe( false );
            expect( isFormatValid( '1.0.0+bad_meta', 'semver' )).toBe( false );
            expect( isFormatValid( '1.0.0-', 'semver' )).toBe( false );
            expect( isFormatValid( '1.0.0-bad_pre', 'semver' )).toBe( false );
            expect( isFormatValid( '1.0.0-01', 'semver' )).toBe( false );
            expect( isFormatValid( '1.0.0-0alpha.1+exp.sha.5114f85', 'semver' )).toBe( true );
            expect( isFormatValid( '01.0.0', 'semver' )).toBe( false );
            expect( isFormatValid( '1.2', 'semver' )).toBe( false );
            expect( isFormatValid( '1.2.3', 'semver' )).toBe( true );

            expect( isFormatValid( 'SGVsbG9fV29ybGQ-', 'base64url' )).toBe( true );
            expect( isFormatValid( '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'ulid' )).toBe( true );
            expect( isFormatValid( 'tz4a98xxat96iws9zmbrgj3a', 'cuid2' )).toBe( true );

            // Boolean guard helpers
            expect( hasOnlyAllowedKeys({ a : 1 }, allowed )).toBe( true );
            expect( hasOnlyAllowedKeys({ a : 1, c : 2 }, allowed )).toBe( false );
            expect( isMultipleOfValid( 10n, 5n )).toBe( true );
            expect( isMultipleOfValid( 10n, 0n )).toBe( false );
            expect( isMultipleOfValid( 1.5, 1n )).toBe( false );
            expect( isMultipleOfValid( 6, 3 )).toBe( true );

            expect( isMinDateValid({}, '2025-01-01' )).toBe( true );
            expect( isMinDateValid( new Date( 'invalid' ), '2025-01-01' )).toBe( false );
            expect( isMinDateValid( '2025-06-01', 'invalid-bound' )).toBe( false );
            expect( isMinDateValid( '2025-06-01', '2025-01-01' )).toBe( true );
            expect( isMinDateValid( '2024-06-01', '2025-01-01' )).toBe( false );

            expect( isMaxDateValid({}, '2025-01-01' )).toBe( true );
            expect( isMaxDateValid( new Date( 'invalid' ), '2025-01-01' )).toBe( false );
            expect( isMaxDateValid( '2025-06-01', 'invalid-bound' )).toBe( false );
            expect( isMaxDateValid( '2024-06-01', '2025-01-01' )).toBe( true );
            expect( isMaxDateValid( '2025-06-01', '2025-01-01' )).toBe( false );

            // validators.* new methods
            const c1 = makeCtx();
            validators.integer( 1.5, 'i', c1 );
            validators.integer( 2, 'i', c1 );
            validators.integer( 2n, 'i', c1 );
            expect( c1.errors.length ).toBe( 1 );

            const c2 = makeCtx();
            validators.safeInteger( Number.MAX_SAFE_INTEGER + 1, 's', c2 );
            validators.safeInteger( 42, 's', c2 );
            validators.safeInteger( 9007199254740992n, 's', c2 );
            validators.safeInteger( -9007199254740992n, 's', c2 );
            validators.safeInteger( 10n, 's', c2 );
            expect( c2.errors.length ).toBe( 3 );

            const c3 = makeCtx();
            validators.positive( 0, 'p', c3 );
            validators.positive( 1, 'p', c3 );
            validators.positive( 0n, 'p', c3 );
            validators.positive( 1n, 'p', c3 );
            expect( c3.errors.length ).toBe( 2 );

            const c4 = makeCtx();
            validators.nonNegative( -1, 'nn', c4 );
            validators.nonNegative( 0, 'nn', c4 );
            validators.nonNegative( -1n, 'nn', c4 );
            validators.nonNegative( 0n, 'nn', c4 );
            expect( c4.errors.length ).toBe( 2 );

            const c5 = makeCtx();
            validators.negative( 0, 'neg', c5 );
            validators.negative( -1, 'neg', c5 );
            validators.negative( 0n, 'neg', c5 );
            validators.negative( -1n, 'neg', c5 );
            expect( c5.errors.length ).toBe( 2 );

            const c6 = makeCtx();
            validators.finite( Infinity, 'f', c6 );
            validators.finite( 10, 'f', c6 );
            validators.finite( 10n, 'f', c6 );
            expect( c6.errors.length ).toBe( 1 );

            const c7 = makeCtx();
            validators.minDate( '2020-01-01', 'd', c7, '2025-01-01' );
            validators.minDate( '2026-01-01', 'd', c7, '2025-01-01' );
            validators.maxDate( '2026-01-01', 'd', c7, '2025-01-01' );
            validators.maxDate( '2024-01-01', 'd', c7, '2025-01-01' );
            expect( c7.errors.length ).toBe( 2 );

            // createValidator fastIs compatibility matrix
            const fastSpy = vi.fn(( x: unknown ) => typeof x === 'number' );
            const vDefault = createValidator<number>( validators.number, undefined, fastSpy );
            const vStrictStr = createValidator<number>( validators.number, 'strict', fastSpy );
            const vRelaxedStr = createValidator<number>( validators.number, 'relaxed', fastSpy );
            const vStrictObj = createValidator<number>( validators.number, { mode : 'strict' }, fastSpy );
            const vFromObj = createValidator<number>( validators.number, { from : 'string' }, fastSpy );

            expect( vDefault.is( 1 )).toBe( true );
            expect( vDefault.is( 1, 'relaxed' )).toBe( true );
            expect( vStrictStr.is( 2 )).toBe( true );
            expect( vStrictObj.is( 3 )).toBe( true );
            expect( vRelaxedStr.is( 4 )).toBe( true );
            expect( vFromObj.is( 5 )).toBe( true );
            expect( fastSpy ).toHaveBeenCalledTimes( 3 );
        });

        it( 'covers all new branches in parse-runtime, random-runtime, and schema-compiler', () =>
        {
            // Arrange
            const rng = createRng( 42 );

            // Act & Assert — parse-runtime
            expect( formatParseMessage( '{path}:{value}', 'id', 9 )).toBe( 'id:9' );
            expect(
                redactParseSecret(() => formatParseMessage( '{path}:{value}', 'pw', 'secret123' ), 'secret123', 'pw' )
            ).toBe( 'pw:[REDACTED]' );

            expect( applyParseConstraints( 'a|b', 'p', [{ type : 'transform_split', value : '|' }])).toEqual([ 'a', 'b' ]);
            expect( applyParseConstraints( 'a,b', 'p', [{ type : 'transform_split', value : undefined as any }])).toEqual([ 'a', 'b' ]);

            expect( applyParseConstraints( 4, 'p', [{ type : 'integer' }])).toBe( 4 );
            expect( applyParseConstraints( 'skip', 'p', [{ type : 'integer' }])).toBe( 'skip' );
            expect(() => applyParseConstraints( 1.2, 'p', [{ type : 'integer' }])).toThrow( ParseError );

            expect( applyParseConstraints( 4, 'p', [{ type : 'safeInteger' }])).toBe( 4 );
            expect( applyParseConstraints( 4n, 'p', [{ type : 'safeInteger' }])).toBe( 4n );
            expect( applyParseConstraints( 'skip', 'p', [{ type : 'safeInteger' }])).toBe( 'skip' );
            expect(() => applyParseConstraints( Number.MAX_SAFE_INTEGER + 1, 'p', [{ type : 'safeInteger' }])).toThrow( ParseError );
            expect(() => applyParseConstraints( 9007199254740999n, 'p', [{ type : 'safeInteger' }])).toThrow( ParseError );
            expect(() => applyParseConstraints( -9007199254740999n, 'p', [{ type : 'safeInteger' }])).toThrow( ParseError );

            expect( applyParseConstraints( 1, 'p', [{ type : 'positive' }])).toBe( 1 );
            expect( applyParseConstraints( 1n, 'p', [{ type : 'positive' }])).toBe( 1n );
            expect( applyParseConstraints( 'skip', 'p', [{ type : 'positive' }])).toBe( 'skip' );
            expect(() => applyParseConstraints( 0, 'p', [{ type : 'positive' }])).toThrow( ParseError );
            expect(() => applyParseConstraints( 0n, 'p', [{ type : 'positive' }])).toThrow( ParseError );

            expect( applyParseConstraints( 0, 'p', [{ type : 'nonNegative' }])).toBe( 0 );
            expect( applyParseConstraints( 0n, 'p', [{ type : 'nonNegative' }])).toBe( 0n );
            expect( applyParseConstraints( 'skip', 'p', [{ type : 'nonNegative' }])).toBe( 'skip' );
            expect(() => applyParseConstraints( -1, 'p', [{ type : 'nonNegative' }])).toThrow( ParseError );
            expect(() => applyParseConstraints( -1n, 'p', [{ type : 'nonNegative' }])).toThrow( ParseError );

            expect( applyParseConstraints( -1, 'p', [{ type : 'negative' }])).toBe( -1 );
            expect( applyParseConstraints( -1n, 'p', [{ type : 'negative' }])).toBe( -1n );
            expect( applyParseConstraints( 'skip', 'p', [{ type : 'negative' }])).toBe( 'skip' );
            expect(() => applyParseConstraints( 0, 'p', [{ type : 'negative' }])).toThrow( ParseError );
            expect(() => applyParseConstraints( 0n, 'p', [{ type : 'negative' }])).toThrow( ParseError );

            expect( applyParseConstraints( 10, 'p', [{ type : 'finite' }])).toBe( 10 );
            expect( applyParseConstraints( 10n, 'p', [{ type : 'finite' }])).toBe( 10n );
            expect(() => applyParseConstraints( Infinity, 'p', [{ type : 'finite' }])).toThrow( ParseError );

            expect( applyParseConstraints( '2025-06-01', 'p', [
                { type : 'minDate', value : '2025-01-01' },
                { type : 'maxDate', value : '2025-12-31' }
            ])).toBe( '2025-06-01' );
            expect(() => applyParseConstraints( '2024-01-01', 'p', [{ type : 'minDate', value : '2025-01-01' }])).toThrow( ParseError );
            expect(() => applyParseConstraints( '2026-01-01', 'p', [{ type : 'maxDate', value : '2025-12-31' }])).toThrow( ParseError );

            // random-runtime upper-only bounds, formats, and date generators
            expect( randNumber( rng, { max : -1, step : 2 })).toBeLessThanOrEqual( -1 );
            expect( randNumber( rng, { exclMax : 0 })).toBeLessThan( 0 );
            expect( randBigInt( rng, { max : -5n })).toBeLessThanOrEqual( -5n );

            expect( isFormatValid( randFormat( rng, 'ulid' ), 'ulid' )).toBe( true );
            expect( isFormatValid( randFormat( rng, 'cuid2' ), 'cuid2' )).toBe( true );
            expect( isFormatValid( randFormat( rng, 'jwt' ), 'jwt' )).toBe( true );
            expect( isFormatValid( randFormat( rng, 'semver' ), 'semver' )).toBe( true );
            expect( isFormatValid( randFormat( rng, 'base64url' ), 'base64url' )).toBe( true );

            const dMin = Date.parse( '2025-03-01T12:00:00Z' );
            const dMax = Date.parse( '2025-04-01T12:00:00Z' );
            expect( Date.parse( randString( rng, { minDateMs : dMin, maxDateMs : dMax }))).toBeGreaterThanOrEqual( dMin );
            expect( isFormatValid( randString( rng, { format : 'date', minDateMs : dMin, maxDateMs : dMax }), 'date' )).toBe( true );
            expect( isFormatValid( randString( rng, { format : 'date', maxDateMs : dMax }), 'date' )).toBe( true );
            expect( isFormatValid( randString( rng, { format : 'date-time', minDateMs : dMin }), 'date-time' )).toBe( true );

            expect( randDate( rng )).toBeInstanceOf( Date );
            expect( randDate( rng, dMin ).getTime()).toBeGreaterThanOrEqual( dMin );
            expect( randDate( rng, undefined, dMax ).getTime()).toBeLessThanOrEqual( dMax );
            expect( randDate( rng, dMax, dMin ).getTime()).toBe( dMax );

            // schema-compiler x-min-date / x-max-date / x-finite
            const dateObjRawSchema =
            {
                type                : 'string',
                'x-typescript-type' : 'Date',
                'x-min-date'        : '2025-01-01T00:00:00Z',
                'x-max-date'        : '2025-12-31T23:59:59Z'
            } as const;
            const isoStrRawSchema =
            {
                type         : 'string',
                format       : 'date',
                'x-min-date' : '2025-02-01',
                'x-max-date' : '2025-10-01'
            } as const;
            const finiteNumRawSchema =
            {
                type       : 'number',
                'x-finite' : true
            } as const;

            expect( compileSchema( dateObjRawSchema )( new Date( '2025-06-01T00:00:00Z' ), '', { success : true, errors : [], mode : 'strict' })).toBeInstanceOf( Date );
            expect( validateSchema( dateObjRawSchema, new Date( '2025-06-01T00:00:00Z' )).success ).toBe( true );
            expect( validateSchema( dateObjRawSchema, new Date( '2024-06-01T00:00:00Z' )).success ).toBe( false );
            expect( validateSchema( isoStrRawSchema, '2025-05-01' ).success ).toBe( true );
            expect( validateSchema( isoStrRawSchema, '2025-11-01' ).success ).toBe( false );
            expect( validateSchema( finiteNumRawSchema, 42 ).success ).toBe( true );
            expect( validateSchema( finiteNumRawSchema, Infinity ).success ).toBe( false );
        });
    });
});
