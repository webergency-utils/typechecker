import { describe, it, expect, expectTypeOf, beforeAll, beforeEach, vi } from 'vitest';
import { emitAndImport } from './helpers/compile.js';
import {
    clone as rawClone,
    cloner as rawCloner,
    prune as rawPrune,
    pruner as rawPruner,
    random as rawRandom,
    randomGenerator as rawRandomGenerator,
    validateSchema,
    compileSchema,
    validators,
    assignBracketPair,
    extractFormDataObject,
    extractHeadersObject,
    splitHeaderList,
    toHeaderKebabKey,
    ParseError,
    SerializationError,
    type ParseOutput,
    type SerializeInput,
    type tag
} from '../src/index.js';
import {
    expectFile,
    expectBlob,
    redactParseSecret,
    parseFormData,
    parseHeaders,
    coerceHeaderArray,
    parseSet
} from '../src/runtime/parse-runtime.js';
import {
    setSafeProp,
    cloneDate,
    cloneUrl,
    cloneRegExp,
    cloneBuffer,
    cloneBinary,
    cloneBlob,
    cloneFile,
    cloneSet,
    cloneMap,
    cloneClassInstance,
    cloneAny,
    dispatchUnion
} from '../src/runtime/clone-runtime.js';
import {
    createRng,
    createRandomGenerator,
    randInt,
    randBool,
    randNumber,
    randBigInt,
    randFormat,
    randFromPattern,
    randString,
    randArray,
    randSet,
    randMap,
    randRecord,
    randDate,
    randUrl,
    randRegExp,
    randBuffer,
    randBinary,
    randBlob,
    randFile
} from '../src/runtime/random-runtime.js';

describe( 'Tier 2 Features', () =>
{
    beforeEach(() =>
    {
        vi.restoreAllMocks();
    });

    describe( 'Untransformed macro stubs in src/index.ts', () =>
    {
        it( 'throws TRANSFORMER_MISSING when Tier 2 macros are invoked without the transformer', () =>
        {
            // Arrange
            const sample = { a : 1 };

            // Act & Assert
            expect(() => rawClone( sample )).toThrow( /transformer was not applied/i );
            expect(() => rawCloner<typeof sample>()).toThrow( /transformer was not applied/i );
            expect(() => rawPrune( sample )).toThrow( /transformer was not applied/i );
            expect(() => rawPruner<typeof sample>()).toThrow( /transformer was not applied/i );
            expect(() => rawRandom<typeof sample>()).toThrow( /transformer was not applied/i );
            expect(() => rawRandomGenerator<typeof sample>()).toThrow( /transformer was not applied/i );
        });

        it( 'projects ParseOutput<T> and SerializeInput<T> accurately at the type level', () =>
        {
            // Arrange
            interface AccountRecord
            {
                id         : string & tag.ReadOnly
                createdAt? : number & tag.ReadOnly & tag.Default<100>
                email      : string
                password   : string & tag.WriteOnly
                apiToken   : string & tag.Secret
            }

            // Act & Assert
            expectTypeOf<ParseOutput<AccountRecord>>().toEqualTypeOf<{
                createdAt : number & tag.ReadOnly & tag.Default<100>
                email     : string
                password  : string & tag.WriteOnly
                apiToken  : string & tag.Secret
            }>();
            expectTypeOf<SerializeInput<AccountRecord>>().toEqualTypeOf<{
                password?  : string & tag.WriteOnly
                apiToken?  : string & tag.Secret
                id         : string & tag.ReadOnly
                createdAt? : number & tag.ReadOnly & tag.Default<100>
                email      : string
            }>();
        });
    });

    describe( 'Tier 2A: tag.ReadOnly, tag.WriteOnly, tag.Secret & JSDoc equivalents', () =>
    {
        let mod: Record<string, any>;

        beforeAll( async() =>
        {
            mod = await emitAndImport( `
                import {
                    parse,
                    safeParse,
                    stringify,
                    serializer,
                    safeSerialize,
                    validate,
                    is,
                    assert,
                    jsonSchema,
                    constraint,
                    transform,
                    tag
                } from '../src/index.js';

                function rejectEchoedSecret( val: string ): boolean
                {
                    if( val.startsWith( 'bad:' ))
                    {
                        throw new Error( 'Rejected token ' + val );
                    }

                    return val.length >= 8;
                }

                export interface UserAccount
                {
                    id         : string & tag.ReadOnly
                    role?      : string & tag.ReadOnly & tag.Default<'member'>
                    email      : string
                    password   : string & tag.WriteOnly & constraint.MinLength<6>
                    apiSecret  : string & tag.Secret & transform.Trim & constraint.Custom<typeof rejectEchoedSecret>
                }

                export interface JsDocTaggedAccount
                {
                    /** @readonly */
                    auditId : string
                    /** @writeOnly */
                    pinCode : string
                    /** @secret */
                    totpKey : string & constraint.MinLength<6>
                    name    : string
                }

                export interface RelaxedSecretBag
                {
                    [key: string] : unknown
                    publicName    : string
                    secretKey     : string & tag.Secret
                    writeToken    : string & tag.WriteOnly
                }

                export type CompetingReadOnlyUnion =
                    | { id : string & tag.ReadOnly, name : string, age : number }
                    | { id : string, name : string };

                export type SecretUnion =
                    | { kind : 'a', token : string & tag.Secret & constraint.MinLength<10> }
                    | { kind : 'b', count : number };

                export const parseStrict = ( s: string ) => parse<UserAccount>( s, 'strict' );
                export const parseStrip = ( s: string ) => parse<UserAccount>( s, 'strip' );
                export const parseRelaxed = ( s: string ) => parse<UserAccount>( s, 'relaxed' );
                export const safeParseStrict = ( s: string ) => safeParse<UserAccount>( s, 'strict' );
                export const parseJsDocStrict = ( s: string ) => parse<JsDocTaggedAccount>( s, 'strict' );

                export const stringifyStrict = ( v: SerializeInput<UserAccount> ) => stringify<UserAccount>( v, 'strict' );
                export const stringifyRelaxed = ( v: SerializeInput<UserAccount> ) => stringify<UserAccount>( v, 'relaxed' );
                export const stringifyQuery = ( v: SerializeInput<UserAccount> ) => stringify<UserAccount>( v, { format : 'query', mode : 'strict' });
                export const stringifyBag = ( v: SerializeInput<RelaxedSecretBag> ) => stringify<RelaxedSecretBag>( v, 'relaxed' );
                export const userSerializer = serializer<UserAccount>( 'strict' );
                export const safeSerUser = ( v: SerializeInput<UserAccount> ) => safeSerialize<UserAccount>( v, 'strict' );

                export const validateUser = ( v: unknown, opts?: any ) => validate<UserAccount>( v, opts );
                export const isUser = ( v: unknown, opts?: any ) => is<UserAccount>( v, opts );
                export const assertUser = ( v: unknown, opts?: any ) => assert<UserAccount>( v, opts );
                export const validateJsDoc = ( v: unknown, opts?: any ) => validate<JsDocTaggedAccount>( v, opts );

                export const parseUnionStrip = ( s: string ) => parse<CompetingReadOnlyUnion>( s, 'strip' );
                export const validateUnionStrip = ( v: unknown ) => validate<CompetingReadOnlyUnion>( v, { mode : 'strip', from : 'json' });
                export const validateSecretUnion = ( v: unknown ) => validate<SecretUnion>( v );

                export const userSchema = jsonSchema<UserAccount>();
                export const jsDocSchema = jsonSchema<JsDocTaggedAccount>();
            `, 'temp_tier2a_access_tags' );
        });

        it( 'enforces ReadOnly across strict, strip, and relaxed parse modes while filling ReadOnly defaults', () =>
        {
            // Arrange
            const cleanPayload = JSON.stringify({
                email     : 'alice@example.com',
                password  : 'hunter2!',
                apiSecret : '  topsecret99  '
            });
            const withReadOnlyPayload = JSON.stringify({
                id        : 'spoofed-admin-id',
                role      : 'superadmin',
                email     : 'alice@example.com',
                password  : 'hunter2!',
                apiSecret : 'topsecret99'
            });

            // Act
            const parsedClean = mod.parseStrict( cleanPayload );
            const stripped = mod.parseStrip( withReadOnlyPayload );
            const relaxed = mod.parseRelaxed( withReadOnlyPayload );
            const strictFail = mod.safeParseStrict( withReadOnlyPayload );
            const jsDocFail = () => mod.parseJsDocStrict( JSON.stringify({
                auditId : 'spoof',
                pinCode : '1234',
                totpKey : '123456',
                name    : 'Bob'
            }));

            // Assert
            expect( parsedClean ).toEqual({
                role      : 'member',
                email     : 'alice@example.com',
                password  : 'hunter2!',
                apiSecret : 'topsecret99'
            });
            expect( 'id' in parsedClean ).toBe( false );
            expect( stripped ).toEqual({
                role      : 'member',
                email     : 'alice@example.com',
                password  : 'hunter2!',
                apiSecret : 'topsecret99'
            });
            expect( relaxed.id ).toBeUndefined();
            expect( relaxed.role ).toBe( 'member' );
            expect( strictFail.success ).toBe( false );
            expect( strictFail.error.path ).toBe( 'id' );
            expect( strictFail.error.message ).toContain( 'ReadOnly<id>' );
            expect( jsDocFail ).toThrow( /ReadOnly<auditId>/ );
        });

        it( 'redacts Secret values in ParseError and IValidationError messages without leaking raw tokens', () =>
        {
            // Arrange
            const echoedRawSecret = '  bad:super-secret-value  ';
            const badPayload = JSON.stringify({
                email     : 'alice@example.com',
                password  : 'hunter2!',
                apiSecret : echoedRawSecret
            });
            const unionPayload = { kind : 'a', token : 'short' };

            // Act
            const parseRes = mod.safeParseStrict( badPayload );
            const valRes = mod.validateUser({
                id        : 'usr_1',
                email     : 'alice@example.com',
                password  : 'hunter2!',
                apiSecret : echoedRawSecret
            });
            const unionValRes = mod.validateSecretUnion( unionPayload );

            // Assert
            expect( parseRes.success ).toBe( false );
            expect( parseRes.error.message ).not.toContain( 'super-secret-value' );
            expect( parseRes.error.message ).toContain( '[REDACTED]' );

            expect( valRes.success ).toBe( false );
            expect( valRes.errors[0].value ).toBe( '[REDACTED]' );
            expect( valRes.errors[0].error ).not.toContain( 'super-secret-value' );
            expect( valRes.errors[0].error ).toContain( '[REDACTED]' );

            expect( unionValRes.success ).toBe( false );
            expect( JSON.stringify( unionValRes.errors )).not.toContain( 'short' );
        });

        it( 'omits WriteOnly and Secret properties during JSON and query serialization in all modes', () =>
        {
            // Arrange
            const fullRecord = {
                id        : 'usr_42',
                role      : 'admin',
                email     : 'alice@example.com',
                password  : 'my-password',
                apiSecret : 'my-secret-token'
            };
            const partialRecord = {
                id    : 'usr_42',
                email : 'alice@example.com'
            };
            const bagRecord = {
                publicName : 'widget',
                secretKey  : 'do-not-emit-secret',
                writeToken : 'do-not-emit-token',
                extraField : 'allowed-extra'
            };

            // Act
            const jsonStrict = mod.stringifyStrict( fullRecord );
            const jsonPartial = mod.stringifyStrict( partialRecord );
            const jsonRelaxed = mod.stringifyRelaxed({ ...fullRecord, extra : 123 } as any );
            const queryOut = mod.stringifyQuery( fullRecord );
            const bagJson = mod.stringifyBag( bagRecord );
            const safeRes = mod.safeSerUser( fullRecord );

            // Assert
            expect( JSON.parse( jsonStrict )).toEqual({
                id    : 'usr_42',
                role  : 'admin',
                email : 'alice@example.com'
            });
            expect( JSON.parse( jsonPartial )).toEqual({
                id    : 'usr_42',
                email : 'alice@example.com'
            });
            expect( JSON.parse( jsonRelaxed )).toEqual({
                id    : 'usr_42',
                role  : 'admin',
                email : 'alice@example.com',
                extra : 123
            });
            expect( queryOut ).toBe( 'id=usr_42&role=admin&email=alice%40example.com' );
            expect( JSON.parse( bagJson )).toEqual({
                publicName : 'widget',
                extraField : 'allowed-extra'
            });
            expect( safeRes.success ).toBe( true );
        });

        it( 'distinguishes in-memory validation vs external wire validation (ctx.from) for ReadOnly fields and union probes', () =>
        {
            // Arrange
            const domainUser = {
                id        : 'usr_1',
                role      : 'editor',
                email     : 'bob@example.com',
                password  : 'secret123',
                apiSecret : 'validsecret99'
            };
            const unionCandidate = { id : 'real-id', name : 'Bob' };

            // Act
            const inMemoryOk = mod.isUser( domainUser );
            const wireStrictFail = mod.validateUser( domainUser, { mode : 'strict', from : 'json' });
            const wireStripOk = mod.validateUser( domainUser, { mode : 'strip', from : 'json' });
            const wireRelaxedOk = mod.validateUser( domainUser, { mode : 'relaxed', from : 'json' });
            const parsedUnion = mod.parseUnionStrip( JSON.stringify( unionCandidate ));
            const validatedUnion = mod.validateUnionStrip( unionCandidate );

            // Assert
            expect( inMemoryOk ).toBe( true );
            expect( wireStrictFail.success ).toBe( false );
            expect( wireStrictFail.errors[0]).toMatchObject({ path : 'id', error : 'ReadOnly<id>' });
            expect( wireStripOk.success ).toBe( true );
            expect( 'id' in wireStripOk.data ).toBe( false );
            expect( wireStripOk.data.role ).toBe( 'member' );
            expect( wireRelaxedOk.success ).toBe( true );
            expect( parsedUnion ).toEqual({ id : 'real-id', name : 'Bob' });
            expect( validatedUnion ).toMatchObject({ success : true, data : { id : 'real-id', name : 'Bob' } });
        });

        it( 'emits readOnly, writeOnly, and x-secret in jsonSchema<T>() and enforces them in compileSchema()', () =>
        {
            // Arrange
            const schema = mod.userSchema;
            const jsDocSchema = mod.jsDocSchema;

            // Act
            const strictWireRes = validateSchema( schema, {
                id        : 'spoof',
                email     : 'a@b.com',
                password  : '123456',
                apiSecret : '123'
            }, { mode : 'strict', from : 'json' });
            const domainRes = validateSchema( jsDocSchema, {
                auditId : 'ok-id',
                pinCode : '1234',
                totpKey : 'short',
                name    : 'Alice'
            });

            // Assert
            expect( schema.properties.id.readOnly ).toBe( true );
            expect( schema.properties.password.writeOnly ).toBe( true );
            expect( schema.properties.apiSecret.writeOnly ).toBe( true );
            expect( schema.properties.apiSecret['x-secret']).toBe( true );

            expect( jsDocSchema.properties.auditId.readOnly ).toBe( true );
            expect( jsDocSchema.properties.pinCode.writeOnly ).toBe( true );
            expect( jsDocSchema.properties.totpKey.writeOnly ).toBe( true );
            expect( jsDocSchema.properties.totpKey['x-secret']).toBe( true );

            expect( strictWireRes.success ).toBe( false );
            expect( strictWireRes.errors.some( e => e.error === 'ReadOnly<id>' )).toBe( true );
            expect( domainRes.success ).toBe( false );

            if( !domainRes.success )
            {
                expect( domainRes.errors[0].value ).toBe( '[REDACTED]' );
            }
        });

        it( 'covers direct redactParseSecret and validators.secret edge branches', () =>
        {
            // Arrange
            const echoedParseErr = (): never =>
            {
                throw new ParseError( 'token', 'Bad my-token' );
            };
            const nonParseThrow = (): never =>
            {
                throw new TypeError( 'boom' );
            };
            const unrelatedParseErr = (): never =>
            {
                throw new ParseError( 'token', 'MinLength<10>' );
            };

            // Act & Assert
            expect( redactParseSecret(() => 'ok', 'my-token' )).toBe( 'ok' );
            expect(() => redactParseSecret( echoedParseErr, 'my-token' )).toThrow( '[REDACTED]' );
            expect(() => redactParseSecret( nonParseThrow, 'boom', 'token' )).toThrow( '[REDACTED]' );
            expect(() => redactParseSecret(() => { throw 'raw-str-err' }, 12345 )).toThrow( 'raw-str-err' );
            expect(() => redactParseSecret( unrelatedParseErr, 'my-token' )).toThrow( 'MinLength<10>' );

            const ctx: any = {
                mode    : 'strict',
                errors  : [],
                root    : { secret : 'abc' },
                success : true
            };
            const inner = ( v: any, p: string, c: any ) =>
            {
                c.success = false;
                c.errors.push({
                    path   : p,
                    value  : v,
                    error  : 'Rejected abc',
                    issues : [{ path : p, value : v, error : 'Nested abc' }]
                });

                return v;
            };
            validators.secret( 'abc', 'secret', ctx, inner );

            expect( ctx.errors[0].value ).toBe( '[REDACTED]' );
            expect( ctx.errors[0].error ).toBe( 'Rejected [REDACTED]' );
            expect( ctx.errors[0].issues[0].value ).toBe( '[REDACTED]' );
            expect( ctx.errors[0].issues[0].error ).toBe( 'Nested [REDACTED]' );
        });
    });

    describe( 'Tier 2B: from: "formData" | "headers" & native File / Blob support', () =>
    {
        let mod: Record<string, any>;

        beforeAll( async() =>
        {
            mod = await emitAndImport( `
                import {
                    parse,
                    parser,
                    safeParse,
                    stringify,
                    safeSerialize,
                    validate,
                    is,
                    assert,
                    jsonSchema
                } from '../src/index.js';

                export interface UploadForm
                {
                    title    : string
                    count    : number
                    publish  : boolean
                    avatar   : File
                    rawBlob? : Blob
                    gallery  : File[]
                    meta     : { author : string, tags : Set<string> }
                }

                export interface RequestHeaders
                {
                    contentType     : string
                    contentLength   : number
                    xRetryEnabled?  : boolean
                    acceptEncoding  : string[]
                    allowOrigins?   : Set<string>
                    setCookie?      : string[]
                }

                export type HeaderAuthUnion =
                    | { xAuthKind : 'api-key', xApiKey : string }
                    | { xAuthKind : 'bearer', authorization : string };

                export const parseUpload = parser<UploadForm>({ from : 'formData', mode : 'strict' });
                export const safeUpload = ( fd: any ) => safeParse<UploadForm>( fd, { from : 'formData', mode : 'strict' });
                export const validateUpload = ( fd: unknown ) => validate<UploadForm>( fd, { from : 'formData', mode : 'strict' });
                export const assertUpload = ( fd: unknown ) => assert<UploadForm>( fd, { from : 'formData', mode : 'strip' });

                export const parseReqHeaders = parser<RequestHeaders>({ from : 'headers', mode : 'strip' });
                export const parseReqHeadersStrict = ( h: any ) => parse<RequestHeaders>( h, { from : 'headers', mode : 'strict' });
                export const validateReqHeaders = ( h: unknown, mode: 'strict' | 'strip' | 'relaxed' = 'strip' ) =>
                    validate<RequestHeaders>( h, { from : 'headers', mode });
                export const parseHeaderUnion = ( h: any ) => parse<HeaderAuthUnion>( h, { from : 'headers', mode : 'strip' });
                export const validateHeaderRecord = ( h: unknown ) =>
                    validate<Record<string, number>>( h, { from : 'headers', mode : 'strict' });

                export const isFilePayload = ( v: unknown ) => is<{ file : File, blob : Blob }>( v );
                export const stringifyFilePayload = ( v: { file : File, blob : Blob }, opts?: any ) =>
                    stringify<{ file : File, blob : Blob }>( v, opts );
                export const stringifyFileQuery = ( v: { file : File, blob : Blob }, opts?: any ) =>
                    stringify<{ file : File, blob : Blob }>( v, { format : 'query', ...opts });
                export const safeSerFile = ( v: { file : File, blob : Blob }) =>
                    safeSerialize<{ file : File, blob : Blob }>( v );
                export const uploadSchema = jsonSchema<UploadForm>();
            `, 'temp_tier2b_formdata_headers_files' );
        });

        it( 'parses and validates FormData payloads with nested bracket keys, checkbox booleans, and File/Blob instances', () =>
        {
            // Arrange
            const avatar = new File([ 'avatar-bytes' ], 'avatar.png', { type : 'image/png' });
            const rawBlob = new Blob([ 'blob-bytes' ], { type : 'application/octet-stream' });
            const pic1 = new File([ '1' ], '1.jpg', { type : 'image/jpeg' });
            const pic2 = new File([ '2' ], '2.jpg', { type : 'image/jpeg' });

            const fd = new FormData();
            fd.append( 'title', 'Release 0.11' );
            fd.append( 'count', '42' );
            fd.append( 'publish', 'on' );
            fd.append( 'avatar', avatar );
            fd.append( 'rawBlob', rawBlob );
            fd.append( 'gallery', pic1 );
            fd.append( 'gallery', pic2 );
            fd.append( 'meta[author]', 'Tomas' );
            fd.append( 'meta[tags][]', 'ts' );
            fd.append( 'meta[tags][]', 'aot' );

            // Act
            const parsed = mod.parseUpload( fd );
            const validated = mod.validateUpload( fd );
            const asserted = mod.assertUpload( fd );
            const badInput = mod.safeUpload( 'not-form-data' );

            // Assert
            expect( parsed.title ).toBe( 'Release 0.11' );
            expect( parsed.count ).toBe( 42 );
            expect( parsed.publish ).toBe( true );
            expect( parsed.avatar ).toBeInstanceOf( File );
            expect( parsed.avatar.name ).toBe( 'avatar.png' );
            expect( parsed.rawBlob ).toBeInstanceOf( Blob );
            expect( parsed.gallery ).toHaveLength( 2 );
            expect( parsed.gallery[0].name ).toBe( '1.jpg' );
            expect( parsed.gallery[1].name ).toBe( '2.jpg' );
            expect( parsed.meta.author ).toBe( 'Tomas' );
            expect( parsed.meta.tags ).toEqual( new Set([ 'ts', 'aot' ]));

            expect( validated.success ).toBe( true );
            expect( asserted.count ).toBe( 42 );
            expect( badInput.success ).toBe( false );
            expect( badInput.error.message ).toContain( 'FormData' );
        });

        it( 'parses and validates Headers, tuple arrays, and IncomingHttpHeaders case-insensitively with camelCase -> kebab-case mapping', () =>
        {
            // Arrange
            const fetchHeaders = new Headers();
            fetchHeaders.append( 'Content-Type', 'application/json' );
            fetchHeaders.append( 'Content-Length', '512' );
            fetchHeaders.append( 'X-Retry-Enabled', 'true' );
            fetchHeaders.append( 'Accept-Encoding', 'gzip, br, zstd' );
            fetchHeaders.append( 'Allow-Origins', 'https://a.dev, https://b.dev' );
            fetchHeaders.append( 'Set-Cookie', 'sid=1; Path=/' );
            fetchHeaders.append( 'Set-Cookie', 'theme=dark; Path=/' );
            fetchHeaders.append( 'X-Ignored-Header', 'extra' );

            const tupleHeaders: ReadonlyArray<readonly [string, string]> = [
                [ 'content-type', 'text/plain' ],
                [ 'content-length', '128' ],
                [ 'accept-encoding', 'gzip' ]
            ];

            const nodeHeaders = {
                'Content-Type'    : 'text/html',
                'content-length'  : '256',
                'accept-encoding' : [ 'gzip', 'deflate' ],
                'x-undefined'     : undefined
            };

            // Act
            const fromFetch = mod.parseReqHeaders( fetchHeaders );
            const fromTuples = mod.parseReqHeadersStrict( tupleHeaders );
            const fromNode = mod.parseReqHeaders( nodeHeaders );
            const valFetch = mod.validateReqHeaders( fetchHeaders, 'strip' );
            const valStrictFail = mod.validateReqHeaders( fetchHeaders, 'strict' );
            const unionAuth = mod.parseHeaderUnion( new Headers({
                'X-Auth-Kind' : 'bearer',
                Authorization : 'Bearer tok_123'
            }));
            const recordVal = mod.validateHeaderRecord({ 'X-Rate-Limit' : '100', 'X-Remaining' : '99' });

            // Assert
            expect( fromFetch ).toEqual({
                contentType    : 'application/json',
                contentLength  : 512,
                xRetryEnabled  : true,
                acceptEncoding : [ 'gzip', 'br', 'zstd' ],
                allowOrigins   : new Set([ 'https://a.dev', 'https://b.dev' ]),
                setCookie      : [ 'sid=1; Path=/', 'theme=dark; Path=/' ]
            });
            expect( fromTuples ).toEqual({
                contentType    : 'text/plain',
                contentLength  : 128,
                acceptEncoding : ['gzip']
            });
            expect( fromNode ).toEqual({
                contentType    : 'text/html',
                contentLength  : 256,
                acceptEncoding : [ 'gzip', 'deflate' ]
            });
            expect( valFetch.success ).toBe( true );
            expect( valFetch.data ).toEqual( fromFetch );
            expect( valStrictFail.success ).toBe( false );
            expect( unionAuth ).toEqual({ xAuthKind : 'bearer', authorization : 'Bearer tok_123' });
            expect( recordVal ).toMatchObject({
                success : true,
                data    : { 'x-rate-limit' : 100, 'x-remaining' : 99 }
            });
        });

        it( 'validates File/Blob across is<T>, jsonSchema<T>, compileSchema(), and rejects untransformed stringify<T>', () =>
        {
            // Arrange
            const file = new File([ 'hello' ], 'hello.txt', { type : 'text/plain' });
            const blob = new Blob([ 'world' ], { type : 'text/plain' });
            const payload = { file, blob };

            // Act
            const guardOk = mod.isFilePayload( payload );
            const guardBlobFail = mod.isFilePayload({ file : blob, blob });
            const safeFail = mod.safeSerFile( payload );
            const queryFail = () => mod.stringifyFileQuery( payload );
            const transformedJson = mod.stringifyFilePayload( payload, {
                transform : ( val: unknown ) =>
                {
                    if( val instanceof File ){ return val.name }

                    if( val instanceof Blob ){ return `blob:${val.size}` }

                    return val;
                }
            });
            const transformedQuery = mod.stringifyFileQuery( payload, {
                transform : ( val: unknown ) =>
                {
                    if( val instanceof File ){ return val.name }

                    if( val instanceof Blob ){ return `blob:${val.size}` }

                    return val;
                }
            });
            const schema = mod.uploadSchema;
            const compiled = compileSchema( schema );
            const schemaOk = compiled(
                {
                    title   : 'Doc',
                    count   : 1,
                    publish : false,
                    avatar  : file,
                    rawBlob : blob,
                    gallery : [file],
                    meta    : { author : 'Ada', tags : new Set([ 'v1' ]) }
                },
                '',
                { mode : 'strict', errors : [], root : {}, success : true }
            );

            // Assert
            expect( guardOk ).toBe( true );
            expect( guardBlobFail ).toBe( false );
            expect( safeFail.success ).toBe( false );
            expect( safeFail.error.name ).toBe( 'SerializationError' );
            expect( safeFail.error.message ).toContain( 'Type<File>' );
            expect( queryFail ).toThrow( /Type<File>/ );
            expect( JSON.parse( transformedJson )).toEqual({ file : 'hello.txt', blob : 'blob:5' });
            expect( transformedQuery ).toBe( 'file=hello.txt&blob=blob%3A5' );
            expect( schema.properties.avatar ).toEqual({
                type                : 'string',
                format              : 'binary',
                'x-typescript-type' : 'File'
            });
            expect( schema.properties.rawBlob ).toEqual({
                type                : 'string',
                format              : 'binary',
                'x-typescript-type' : 'Blob'
            });
            expect( schemaOk ).toBeDefined();
        });

        it( 'covers direct FormData/Headers/File/Blob helper edge branches in validators and parse-runtime', () =>
        {
            // Arrange
            const customHeadersLike = {
                *entries()
                {
                    yield [ 'X-Custom', 'a' ] as [string, string];
                    yield [ 'x-custom', 'b' ] as [string, string];
                }
            };
            const reviver = ( key: string, val: any ) => ( key === 'a' ? String( val ).toUpperCase() : val );
            const fd = new FormData();
            fd.append( 'a', 'hello' );

            // Act & Assert
            expect( toHeaderKebabKey( 'contentLength' )).toBe( 'content-length' );
            expect( splitHeaderList( '   ' )).toEqual([]);
            expect( splitHeaderList( 'a, b , c' )).toEqual([ 'a', 'b', 'c' ]);

            expect( extractFormDataObject( null )).toBeUndefined();
            expect( extractFormDataObject({})).toBeUndefined();

            expect( extractHeadersObject( null )).toBeUndefined();
            expect( extractHeadersObject( new Date())).toBeUndefined();
            expect( extractHeadersObject([[ 'bad-tuple-only-one' ]])).toBeUndefined();
            expect( extractHeadersObject({ __proto__ : 'ignored', host : 'example.com', arr : [ 'x', 'y' ], dup : '1' })).toEqual({
                host : 'example.com',
                arr  : [ 'x', 'y' ],
                dup  : '1'
            });
            const extractedCustom = extractHeadersObject( customHeadersLike )!;
            expect( extractedCustom['x-custom']).toEqual([ 'a', 'b' ]);
            expect( extractHeadersObject( extractedCustom )).toBe( extractedCustom );

            // Duplicate array merge in appendHeaderEntry
            expect( extractHeadersObject([
                [ 'x-multi', 'one' ],
                [ 'x-multi', 'two' ]
            ])).toEqual({ 'x-multi' : [ 'one', 'two' ] });

            // assignBracketPair edge cases: unsafe keys, array->object promotion, plain-object append
            const bracketTarget: Record<string, any> = {};
            assignBracketPair( bracketTarget, '__proto__[polluted]', 'bad' );
            assignBracketPair( bracketTarget, 'safe[prototype]', 'bad' );
            assignBracketPair( bracketTarget, 'items[0]', 'first' );
            assignBracketPair( bracketTarget, 'items[named]', 'promoted' );
            assignBracketPair( bracketTarget, 'items', 'appended' );
            expect( bracketTarget.items ).toEqual({ 0 : 'first', named : 'promoted', 1 : 'appended' });

            expect( parseFormData( fd )).toEqual({ a : 'hello' });
            expect(() => parseFormData({})).toThrow( 'Input must be FormData' );
            expect( parseHeaders({ 'X-Val' : 'hi' })).toEqual({ 'x-val' : 'hi' });
            expect(() => parseHeaders( 123 )).toThrow( 'Headers' );

            expect( coerceHeaderArray([ 1, 2 ], 'h', v => v )).toEqual([ 1, 2 ]);
            expect( coerceHeaderArray( undefined, 'h', v => v )).toEqual([]);
            expect( coerceHeaderArray( 'a, b', 'h', v => v )).toEqual([ 'a', 'b' ]);
            expect( coerceHeaderArray( 42, 'h', v => v )).toEqual([ 42 ]);

            expect( parseSet( 'x, y', 's', 'headers', v => String( v ))).toEqual( new Set([ 'x', 'y' ]));
            const okFile = new File([ 'ok' ], 'ok.txt' );
            const okBlob = new Blob([ 'ok' ]);
            expect( expectFile( okFile, 'f' )).toBe( okFile );
            expect( expectBlob( okBlob, 'b' )).toBe( okBlob );
            expect(() => expectFile( new Blob([ 'x' ]), 'f' )).toThrow( 'Type<File>' );
            expect(() => expectBlob( 'not-blob', 'b' )).toThrow( 'Type<Blob>' );

            // Direct redactParseSecret edge branches
            expect( redactParseSecret(() => 'clean', 'sec' )).toBe( 'clean' );
            expect(() => redactParseSecret(() => { throw new ParseError( 'p', 'Type<string>' ) }, 'sec' )).toThrow( 'Type<string>' );
            expect(() => redactParseSecret(() => { throw new ParseError( 'p', 'bad sec' ) }, 'sec' )).toThrow( 'bad [REDACTED]' );
            expect(() => redactParseSecret(() => { throw new ParseError( 'p', 'bad trimmed-tok' ) }, '  trimmed-tok  ' )).toThrow( 'bad [REDACTED]' );
            expect(() => redactParseSecret(() => { throw new ParseError( 'p', 'ws-only' ) }, '   ' )).toThrow( 'ws-only' );
            expect(() => redactParseSecret(() => { throw new ParseError( 'p', 'empty-str' ) }, '' )).toThrow( 'empty-str' );
            expect(() => redactParseSecret(() => { throw new ParseError( 'p', 'non-str' ) }, 123 )).toThrow( 'non-str' );
            expect(() => redactParseSecret(() => { throw new Error( 'err sec' ) }, 'sec', 'tok' )).toThrow( 'err [REDACTED]' );
            expect(() => redactParseSecret(() => { throw 'raw-str sec' }, 'sec' )).toThrow( 'raw-str [REDACTED]' );

            // Custom `from` converter on validators.file / validators.blob and binary format check
            const customFile = new File([ 'ok' ], 'ok.txt' );
            const customBlob = new Blob([ 'ok' ]);
            const fileCtx: any = { mode : 'strict', errors : [], root : {}, success : true, from : () => customFile };
            const blobCtx: any = { mode : 'strict', errors : [], root : {}, success : true, from : () => customBlob };
            expect( validators.instanceOf( 'raw', 'f', fileCtx, 'File' )).toBe( customFile );
            expect( validators.instanceOf( 'raw', 'b', blobCtx, 'Blob' )).toBe( customBlob );

            const binCtx: any = { mode : 'strict', errors : [], root : {}, success : true };
            validators.format( 'plain-str', 'bin', binCtx, 'binary' );
            expect( binCtx.success ).toBe( true );
        });

        it( 'covers direct src/runtime/validators.ts paths for readOnly, secret, formData, and headers', () =>
        {
            // Arrange
            const hugeFormDataLike = {
                getAll : () => [],
                *entries()
                {
                    for( let i = 0; i < 10005; i++ )
                    {
                        yield [ `k${i}`, 'v' ] as [string, string];
                    }
                }
            };
            const mergeHeadersLike = {
                *entries()
                {
                    yield [ 'x-merge', 'a' ] as [string, any];
                    yield [ 'x-merge', [ 'b', 'c' ] ] as [string, any];
                    yield [ 'x-merge', 'd' ] as [string, any];
                }
            };
            const invalidKeyHeadersLike = {
                *entries()
                {
                    yield [ 123 as any, 'bad' ];
                }
            };
            const realHeadersWithCookies = new Headers();
            realHeadersWithCookies.append( 'Set-Cookie', 'c1=1' );
            realHeadersWithCookies.append( 'Set-Cookie', 'c2=2' );
            realHeadersWithCookies.append( 'X-Ok', 'yes' );

            const roSchema = {
                type       : 'object',
                properties : {
                    roPlain     : { type : 'string', readOnly : true },
                    roDef       : { type : 'string', readOnly : true, default : 'sys' },
                    name        : { type : 'string' },
                    secretUnion : {
                        anyOf      : [ { type : 'string', minLength : 5 }, { type : 'number' } ],
                        'x-secret' : true
                    }
                },
                required             : [ 'name', 'secretUnion' ],
                additionalProperties : false
            };

            const roUnionSchema = {
                anyOf : [
                    {
                        type                 : 'object',
                        properties           : { a : { type : 'string' }, b : { type : 'string', readOnly : true } },
                        required             : [ 'a' ],
                        additionalProperties : false
                    },
                    {
                        type                 : 'object',
                        properties           : { a : { type : 'string' } },
                        required             : [ 'a' ],
                        additionalProperties : false
                    }
                ]
            };

            const hdrSchema = {
                type       : 'object',
                properties : {
                    contentLength : { type : 'number' },
                    xFlatKey      : { type : 'string' },
                    optHeader     : { type : 'string' },
                    tags          : { type : 'array', items : { type : 'string' } },
                    origins       : { type : 'array', items : { type : 'string' }, 'x-typescript-type' : 'Set' }
                },
                required             : [ 'contentLength' ],
                additionalProperties : false
            };

            const nestedHdrSchema = {
                type                 : 'object',
                properties           : { nested : hdrSchema },
                required             : [ 'nested' ],
                additionalProperties : false
            };

            const hdrAdditionalSchema = {
                type                 : 'object',
                properties           : { host : { type : 'string' } },
                additionalProperties : { type : 'number' }
            };

            const hdrPatternSchema = {
                type                 : 'object',
                properties           : { host : { type : 'string' } },
                patternProperties    : { '^x-' : { type : 'number' } },
                additionalProperties : false
            };

            const pureRecordSchema = {
                type                 : 'object',
                additionalProperties : { type : 'number' }
            };

            const innerFd = new FormData();
            innerFd.append( 'ok', 'true' );
            const nestedFormDataLike = {
                getAll : () => [],
                *entries()
                {
                    yield [ 'name', 'Ada' ];
                    yield [ 'nested', innerFd ];
                }
            };
            const fdObjSchema = {
                type       : 'object',
                properties : {
                    name   : { type : 'string' },
                    nested : { type : 'object', properties : { ok : { type : 'boolean' } } }
                },
                required : [ 'name' ]
            };
            const recordFd = new FormData();
            recordFd.append( 'n', '7' );

            // Act
            const cappedFd = extractFormDataObject( hugeFormDataLike )!;
            const mergedHdr = extractHeadersObject( mergeHeadersLike )!;
            const badKeyHdr = extractHeadersObject( invalidKeyHeadersLike );
            const cookiesHdr = extractHeadersObject( realHeadersWithCookies )!;
            const plainProtoHdr = extractHeadersObject({
                undef       : undefined,
                __proto__   : 'ignored',
                constructor : 'ignored',
                prototype   : 'ignored',
                'X-Str'     : 'val'
            })!;

            const roInMemory = validateSchema( roSchema, { roPlain : 'keep', roDef : 'keepDef', name : 'Ada', secretUnion : 'validSecret' });
            const roStrictFail = validateSchema(
                roSchema,
                { roPlain : 'inject', name : 'Ada', secretUnion : 'bad' },
                { from : 'json', mode : 'strict' }
            );
            const mutableRoInput: Record<string, any> = { roPlain : 'strip-me', name : 'Ada', secretUnion : 'validSecret' };
            const roStripMutate = validateSchema( roSchema, mutableRoInput, { from : 'json', mode : 'strip', mutate : true });
            const roUnionStrip = validateSchema( roUnionSchema, { a : 'ok', b : 'ro-injected' }, { from : 'json', mode : 'strip' });

            // Direct validators.props with readOnly + hasDefault (both valid & failing default)
            const roDefData: Record<string, any> = {};
            const roDefCtx: any = { mode : 'strip', from : 'json', errors : [], root : roDefData, success : true };
            validators.props(
                { roDef : 'ignored' },
                roDefData,
                '',
                roDefCtx,
                [[ 'roDef', true, ( v: any ) => ( v === undefined ? 'sys' : v ), true, true ]]
            );
            const roBadDefData: Record<string, any> = {};
            const roBadDefCtx: any = { mode : 'strip', from : 'json', errors : [], root : roBadDefData, success : true };
            validators.props(
                {},
                roBadDefData,
                '',
                roBadDefCtx,
                [[
                    'roBad',
                    true,
                    ( _v: any, p: string, c: any ) =>
                    {
                        c.success = false;
                        c.errors.push({ path : p, error : 'MinLength<10>', value : 'short' });

                        return 'short';
                    },
                    true,
                    true
                ]]
            );

            // Direct validators.secret branches
            const secCtx1: any = { mode : 'strict', errors : [], root : {}, success : true };
            validators.secret( '  trimmed-sec  ', 'p', secCtx1, () => { throw new Error( 'leak trimmed-sec' ) });
            const secCtx2: any = { mode : 'strict', errors : [], root : {}, success : true };
            validators.secret( 'raw-sec', 'p', secCtx2, () => { throw 'str-err raw-sec' });
            const secCtx3: any = { mode : 'strict', errors : [], root : {}, success : true };
            validators.secret( '   ', 'p', secCtx3, () => { throw new Error( 'ws-err' ) });
            const secCtx4: any = { mode : 'strict', errors : [], root : {}, success : true };
            validators.secret( 42, 'p', secCtx4, () => { throw new Error( 'num-err' ) });
            const secCtx5: any = { mode : 'strict', errors : [], root : {}, success : true };
            validators.secret( '  tok_inner  ', 'p', secCtx5, ( _v: any, p: string, c: any ) =>
            {
                c.success = false;
                c.errors.push({ path : p, error : 'failed tok_inner', value : 'tok_inner' });

                return 'tok_inner';
            });

            // Direct validateSchema with from: 'headers' and from: 'formData'
            const mutableHdrInput: Record<string, any> = {
                'content-length' : '42',
                xflatkey         : 'flat',
                tags             : 'a, b',
                origins          : 'o1, o2',
                extra            : 'drop'
            };
            const hdrStripRes = validateSchema( hdrSchema, mutableHdrInput, { from : 'headers', mode : 'strip', mutate : true });
            const hdrStrictRes = validateSchema( hdrSchema, { 'content-length' : '42', extra : 'bad' }, { from : 'headers', mode : 'strict' });
            const hdrInvalidInput = validateSchema( hdrSchema, 123, { from : 'headers' });
            const hdrNestedRes = validateSchema( nestedHdrSchema, { nested : new Headers({ 'content-length' : '10' }) }, { from : 'headers' });
            const hdrAddRes = validateSchema( hdrAdditionalSchema, { Host : 'ex.com', 'x-num' : '5' }, { from : 'headers' });
            const hdrPatRes = validateSchema( hdrPatternSchema, { Host : 'ex.com', 'x-rate' : '10' }, { from : 'headers' });
            const hdrRecOk = validateSchema( pureRecordSchema, { 'X-A' : '1' }, { from : 'headers' });
            const hdrRecFail = validateSchema( pureRecordSchema, 123, { from : 'headers' });

            const fdNestedRes = validateSchema( fdObjSchema, nestedFormDataLike, { from : 'formData' });
            const fdObjFail = validateSchema( fdObjSchema, 123, { from : 'formData' });
            const fdRecOk = validateSchema( pureRecordSchema, recordFd, { from : 'formData' });
            const fdRecFail = validateSchema( pureRecordSchema, 123, { from : 'formData' });

            // Direct AOT runtime helpers: unionProbe ReadOnly strip, additionalProps/patternProps headers, validators.record
            const probeCtx: any = {
                mode       : 'strip',
                from       : 'json',
                unionProbe : { stripped : 0, matched : 1 },
                errors     : [],
                root       : {},
                success    : true
            };
            validators.props({ ro : 'injected' }, {}, '', probeCtx, [[ 'ro', true, ( v: any ) => v, false, true ]]);

            const addOut: Record<string, any> = {};
            const hdrHelperCtx: any = { mode : 'strict', from : 'headers', errors : [], root : {}, success : true };
            validators.additionalProps({ host : 'ex.com', 'x-num' : 5 }, addOut, '', hdrHelperCtx, [ 'host' ], ( v: any ) => v );

            const patOut: Record<string, any> = {};
            validators.patternProps(
                { host : 'ex.com', 'x-rate' : 10 },
                patOut,
                '',
                hdrHelperCtx,
                [ 'host' ],
                [[ /^x-/, ( v: any ) => v ]]
            );

            const recFdCtx: any = { mode : 'strict', from : 'formData', errors : [], root : {}, success : true };
            const directRecFdOk = validators.record( recordFd, '', recFdCtx, ( v: any ) => Number( v ));
            const recFdFailCtx: any = { mode : 'strict', from : 'formData', errors : [], root : {}, success : true };
            validators.record( 123, '', recFdFailCtx, ( v: any ) => v );

            const recHdrCtx: any = { mode : 'strict', from : 'headers', errors : [], root : {}, success : true };
            const directRecHdrOk = validators.record({ 'X-A' : '1' }, '', recHdrCtx, ( v: any ) => Number( v ));
            const recHdrFailCtx: any = { mode : 'strict', from : 'headers', errors : [], root : {}, success : true };
            validators.record( 123, '', recHdrFailCtx, ( v: any ) => v );

            // Assert
            expect( probeCtx.unionProbe ).toEqual({ stripped : 1, matched : 0 });
            expect( addOut ).toEqual({ 'x-num' : 5 });
            expect( patOut ).toEqual({ 'x-rate' : 10 });
            expect( directRecFdOk ).toEqual({ n : 7 });
            expect( recFdFailCtx.success ).toBe( false );
            expect( directRecHdrOk ).toEqual({ 'x-a' : 1 });
            expect( recHdrFailCtx.success ).toBe( false );
            expect( Object.keys( cappedFd ).length ).toBe( 10000 );
            expect( mergedHdr['x-merge']).toEqual([ 'a', 'b', 'c', 'd' ]);
            expect( badKeyHdr ).toBeUndefined();
            expect( cookiesHdr ).toEqual({ 'set-cookie' : [ 'c1=1', 'c2=2' ], 'x-ok' : 'yes' });
            expect( plainProtoHdr ).toEqual({ 'x-str' : 'val' });

            expect( roInMemory.success ).toBe( true );
            expect( roStrictFail.success ).toBe( false );
            expect( JSON.stringify( roStrictFail.errors )).not.toContain( 'bad' );
            expect( roStripMutate ).toMatchObject({
                success : true,
                data    : { name : 'Ada', secretUnion : 'validSecret' }
            });
            expect( 'roPlain' in mutableRoInput ).toBe( false );
            expect( roUnionStrip ).toMatchObject({ success : true, data : { a : 'ok' } });
            expect( roDefData ).toEqual({ roDef : 'sys' });
            expect( roBadDefCtx.success ).toBe( false );
            expect( 'roBad' in roBadDefData ).toBe( false );

            expect( secCtx1.errors[0].error ).toBe( 'leak [REDACTED]' );
            expect( secCtx2.errors[0].error ).toBe( 'str-err [REDACTED]' );
            expect( secCtx3.errors[0].error ).toBe( 'ws-err' );
            expect( secCtx4.errors[0].error ).toBe( 'num-err' );
            expect( secCtx5.errors[0].error ).toBe( 'failed [REDACTED]' );

            expect( hdrStripRes ).toMatchObject({
                success : true,
                data    : {
                    contentLength : 42,
                    xFlatKey      : 'flat',
                    tags          : [ 'a', 'b' ],
                    origins       : new Set([ 'o1', 'o2' ])
                }
            });
            expect( hdrStrictRes.success ).toBe( false );
            expect( hdrInvalidInput.success ).toBe( false );
            expect( hdrNestedRes ).toMatchObject({ success : true, data : { nested : { contentLength : 10 } } });
            expect( hdrAddRes ).toMatchObject({ success : true, data : { host : 'ex.com', 'x-num' : 5 } });
            expect( hdrPatRes ).toMatchObject({ success : true, data : { host : 'ex.com', 'x-rate' : 10 } });
            expect( hdrRecOk ).toMatchObject({ success : true, data : { 'x-a' : 1 } });
            expect( hdrRecFail.success ).toBe( false );

            expect( fdNestedRes ).toMatchObject({ success : true, data : { name : 'Ada', nested : { ok : true } } });
            expect( fdObjFail.success ).toBe( false );
            expect( fdRecOk ).toMatchObject({ success : true, data : { n : 7 } });
            expect( fdRecFail.success ).toBe( false );
        });
    });

    describe( 'Tier 2C: AOT clone<T>() / cloner<T>() and prune<T>() / pruner<T>()', () =>
    {
        let mod: Record<string, any>;

        beforeAll( async() =>
        {
            mod = await emitAndImport( `
                import { clone, cloner, prune, pruner } from '../src/index.js';

                export class CustomPoint
                {
                    public x : number;
                    public y : number;

                    public constructor( x: number, y: number )
                    {
                        this.x = x;
                        this.y = y;
                    }

                    public sum(): number
                    {
                        return this.x + this.y;
                    }
                }

                export interface RichEntity
                {
                    id         : string
                    created    : Date
                    endpoint   : URL
                    matcher    : RegExp
                    buf        : Buffer
                    ab         : ArrayBuffer
                    sab        : SharedArrayBuffer
                    dv         : DataView
                    bytes      : Uint8Array
                    floats     : Float64Array
                    blob       : Blob
                    file       : File
                    tags       : Set<{ label : string }>
                    lookup     : Map<string, { score : number }>
                    tuple      : [ { a : number }, { b : number }?, ...Array<{ c : number }> ]
                    point      : CustomPoint
                    optional?  : { nested : string }
                    nullable   : { val : number } | null
                    tagged     : { kind : 'x', x : number } | { kind : 'y', y : string }
                    competing  : { a : string, b : string } | { a : string }
                    dynamic    : {
                        fixed : string
                        [key: \`meta_\${string}\`] : { flag : boolean }
                    }
                }

                export interface TreeNode
                {
                    name      : string
                    children? : TreeNode[]
                }

                export const cloneRich = cloner<RichEntity>();
                export const pruneRich = pruner<RichEntity>();
                export const cloneTree = ( t: TreeNode ) => clone<TreeNode>( t );
                export const pruneTree = ( t: TreeNode ) => prune<TreeNode>( t );
                export const cloneUnknown = ( v: unknown ) => clone<unknown>( v );
                export const prunePrimitive = ( v: string ) => prune<string>( v );
            `, 'temp_tier2c_clone_prune' );
        });

        it( 'deep-clones all built-ins, collections, classes, unions, and recursive structures while dropping undeclared keys', () =>
        {
            // Arrange
            const sab = new SharedArrayBuffer( 4 );
            new Uint8Array( sab ).set([ 1, 2, 3, 4 ]);
            const ab = new Uint8Array([ 9, 8, 7, 6 ]).buffer;
            const re = /abc/gi;
            re.lastIndex = 2;

            const original: any = {
                id        : 'ent_1',
                created   : new Date( '2026-01-01T00:00:00.000Z' ),
                endpoint  : new URL( 'https://example.com/api' ),
                matcher   : re,
                buf       : Buffer.from([ 10, 20 ]),
                ab,
                sab,
                dv        : new DataView( ab ),
                bytes     : new Uint8Array([ 5, 6 ]),
                floats    : new Float64Array([ 1.5, 2.5 ]),
                blob      : new Blob([ 'blob' ], { type : 'text/plain' }),
                file      : new File([ 'file' ], 'doc.txt', { type : 'text/plain', lastModified : 12345 }),
                tags      : new Set([{ label : 'core', extraTagProp : true }]),
                lookup    : new Map([[ 'k1', { score : 99, extraMapProp : 'drop' } ]]),
                tuple     : [ { a : 1, dropA : 1 }, { b : 2, dropB : 2 }, { c : 3, dropC : 3 } ],
                point     : new mod.CustomPoint( 3, 4 ),
                optional  : { nested : 'yes', extraOpt : 'drop' },
                nullable  : null,
                tagged    : { kind : 'x', x : 10, extraTagged : 'drop' },
                competing : { a : 'hello', b : 'world', extraComp : 'drop' },
                dynamic   : {
                    fixed     : 'keep',
                    meta_one  : { flag : true, extraMeta : 'drop' },
                    unmatched : 'drop-me'
                },
                rootExtra : 'drop-root'
            };

            // Act
            const cloned = mod.cloneRich( original );

            // Assert
            expect( cloned ).not.toBe( original );
            expect( 'rootExtra' in cloned ).toBe( false );
            expect( cloned.created ).not.toBe( original.created );
            expect( cloned.created.getTime()).toBe( original.created.getTime());
            expect( cloned.endpoint ).not.toBe( original.endpoint );
            expect( cloned.endpoint.href ).toBe( 'https://example.com/api' );
            expect( cloned.matcher ).not.toBe( original.matcher );
            expect( cloned.matcher.lastIndex ).toBe( 2 );
            expect( cloned.buf ).not.toBe( original.buf );
            expect( cloned.buf.equals( original.buf )).toBe( true );
            expect( cloned.ab ).not.toBe( original.ab );
            expect( cloned.sab ).not.toBe( original.sab );
            expect( new Uint8Array( cloned.sab )).toEqual( new Uint8Array([ 1, 2, 3, 4 ]));
            expect( cloned.dv ).not.toBe( original.dv );
            expect( cloned.bytes ).not.toBe( original.bytes );
            expect( cloned.floats ).not.toBe( original.floats );
            expect( cloned.blob ).not.toBe( original.blob );
            expect( cloned.file ).not.toBe( original.file );
            expect( cloned.file.name ).toBe( 'doc.txt' );
            expect( cloned.file.lastModified ).toBe( 12345 );
            expect([ ...cloned.tags ][0]).toEqual({ label : 'core' });
            expect( cloned.lookup.get( 'k1' )).toEqual({ score : 99 });
            expect( cloned.tuple ).toEqual([ { a : 1 }, { b : 2 }, { c : 3 } ]);
            expect( cloned.point ).not.toBe( original.point );
            expect( cloned.point ).toBeInstanceOf( mod.CustomPoint );
            expect( cloned.point.sum()).toBe( 7 );
            expect( cloned.optional ).toEqual({ nested : 'yes' });
            expect( cloned.nullable ).toBeNull();
            expect( cloned.tagged ).toEqual({ kind : 'x', x : 10 });
            expect( cloned.competing ).toEqual({ a : 'hello', b : 'world' });
            expect( cloned.dynamic ).toEqual({ fixed : 'keep', meta_one : { flag : true } });
        });

        it( 'prunes excess keys in place on nested objects, Sets, Maps, tuples, unions, and recursive trees', () =>
        {
            // Arrange
            const tree: any = {
                name      : 'root',
                extraRoot : 1,
                children  : [
                    { name : 'child-1', extraChild : 2 },
                    { name : 'child-2', children : [{ name : 'leaf', extraLeaf : 3 }] }
                ]
            };

            // Act
            const pruned = mod.pruneTree( tree );
            const clonedTree = mod.cloneTree( tree );
            const prim = mod.prunePrimitive( 'unchanged' );

            // Assert
            expect( pruned ).toBe( tree );
            expect( pruned ).toEqual({
                name     : 'root',
                children : [
                    { name : 'child-1' },
                    { name : 'child-2', children : [{ name : 'leaf' }] }
                ]
            });
            expect( clonedTree ).not.toBe( tree );
            expect( clonedTree ).toEqual( pruned );
            expect( prim ).toBe( 'unchanged' );
        });

        it( 'covers clone-runtime helpers including cycle-safe cloneAny, setSafeProp, and dispatchUnion', () =>
        {
            // Arrange
            const cyclicArr: any[] = [ 1 ];
            cyclicArr.push( cyclicArr );

            const cyclicSet = new Set<any>();
            cyclicSet.add( cyclicSet );

            const cyclicMap = new Map<any, any>();
            cyclicMap.set( 'self', cyclicMap );

            const nullProto = Object.create( null );
            nullProto.a = 1;
            nullProto.self = nullProto;

            const sab = new SharedArrayBuffer( 2 );
            new Uint8Array( sab ).set([ 7, 8 ]);

            const exoticBag: Record<string, any> = {
                d   : new Date( 1000 ),
                u   : new URL( 'https://a.dev' ),
                r   : /x/g,
                f   : new File([ 'a' ], 'a.txt' ),
                bl  : new Blob([ 'b' ]),
                buf : Buffer.from([ 1 ]),
                ab  : new Uint8Array([ 2 ]).buffer,
                sab,
                dv  : new DataView( new ArrayBuffer( 2 )),
                u8  : new Uint8Array([ 3 ]),
                arr : cyclicArr,
                set : cyclicSet,
                map : cyclicMap,
                np  : nullProto,
                n   : null,
                p   : 42
            };
            exoticBag.self = exoticBag;

            class ExtraCarrier
            {
                public known = 1;
                public extra = { nested : 2 };
            }

            // Act
            const bagClone = mod.cloneUnknown( exoticBag );
            const directBagClone = cloneAny( exoticBag );
            const safeObj: Record<string, any> = {};
            setSafeProp( safeObj, '__proto__', 'safe-proto' );
            setSafeProp( safeObj, 'constructor', 'safe-ctor' );
            setSafeProp( safeObj, 'prototype', 'safe-prototype' );
            setSafeProp( safeObj, 'normal', 'ok' );

            const instClone = cloneClassInstance(
                new ExtraCarrier(),
                ( src, dst ) => { dst.known = src.known },
                new Set([ 'known' ])
            );

            const unionNoMatch = dispatchUnion({ z : 1 }, [
                { match : () => false, run : () => 'bad' }
            ]);
            const unionFastMatch = dispatchUnion( 'str', [
                { match : v => typeof v === 'string', run : v => `${v}!` }
            ]);
            const unionScored = dispatchUnion({ a : 1, b : undefined, c : 2 }, [
                { match : () => true, run : () => 'arm1', scoreKeys : [ 'a', 'b' ] },
                { match : () => true, run : () => 'arm2', scoreKeys : [ 'a', 'c' ] },
                { match : () => true, run : () => 'arm3', scoreKeys : [ 'a' ] }
            ]);

            // Assert
            expect( bagClone ).not.toBe( exoticBag );
            expect( bagClone.arr[1]).toBe( bagClone.arr );
            expect( bagClone.set.has( bagClone.set )).toBe( true );
            expect( bagClone.map.get( 'self' )).toBe( bagClone.map );
            expect( Object.getPrototypeOf( bagClone.np )).toBeNull();
            expect( bagClone.np.self ).toBe( bagClone.np );

            expect( Object.getOwnPropertyDescriptor( safeObj, '__proto__' )?.value ).toBe( 'safe-proto' );
            expect( Object.getOwnPropertyDescriptor( safeObj, 'constructor' )?.value ).toBe( 'safe-ctor' );
            expect( safeObj.normal ).toBe( 'ok' );

            expect( instClone ).toBeInstanceOf( ExtraCarrier );
            expect( instClone.extra ).toEqual({ nested : 2 });
            expect( instClone.extra ).not.toBe(( new ExtraCarrier()).extra );

            expect( unionNoMatch ).toEqual({ z : 1 });
            expect( unionFastMatch ).toBe( 'str!' );
            expect( unionScored ).toBe( 'arm2' );

            // Direct helper sanity checks
            expect( directBagClone ).not.toBe( exoticBag );
            expect( directBagClone.self ).toBe( directBagClone );
            expect( Object.getOwnPropertyDescriptor( safeObj, 'prototype' )?.value ).toBe( 'safe-prototype' );
            expect( cloneDate( new Date( 5 ))).toEqual( new Date( 5 ));
            expect( cloneUrl( new URL( 'https://x.dev' )).href ).toBe( 'https://x.dev/' );
            expect( cloneRegExp( /a/i ).flags ).toBe( 'i' );
            expect( cloneBuffer( Buffer.from([ 4 ]))[0]).toBe( 4 );
            expect( cloneBinary( new ArrayBuffer( 4 ), 'ArrayBuffer' ).byteLength ).toBe( 4 );
            expect( cloneBinary( new SharedArrayBuffer( 4 ), 'SharedArrayBuffer' ).byteLength ).toBe( 4 );
            expect( cloneBinary( new DataView( new ArrayBuffer( 4 ), 1, 2 ), 'DataView' ).byteLength ).toBe( 2 );
            expect( cloneBinary( new Uint16Array([ 9 ]), 'Uint16Array' )[0]).toBe( 9 );
            expect( cloneBlob( new Blob([ 'x' ])).size ).toBe( 1 );
            expect( cloneFile( new File([ 'x' ], 'x.txt' )).name ).toBe( 'x.txt' );
            expect( cloneSet( new Set([ 1 ]), x => x + 1 )).toEqual( new Set([ 2 ]));
            expect( cloneMap( new Map([[ 'k', 1 ]]), k => k, v => v + 1 ).get( 'k' )).toBe( 2 );
            expect( cloneAny( 'prim' )).toBe( 'prim' );
        });
    });

    describe( 'Tier 2D: AOT random<T>() and randomGenerator<T>()', () =>
    {
        let mod: Record<string, any>;

        beforeAll( async() =>
        {
            mod = await emitAndImport( `
                import {
                    random,
                    randomGenerator,
                    is,
                    constraint,
                    format,
                    transform,
                    tag
                } from '../src/index.js';

                export enum StatusEnum
                {
                    Draft     = 'draft',
                    Published = 'published'
                }

                export interface MockProfile
                {
                    id         : string & format.UUID
                    email      : string & format.Email
                    website    : string & format.URL
                    ipv4       : string & format.IPv4
                    ipv6       : string & format.IPv6
                    createdDate: string & format.Date
                    createdAt  : string & format.DateTime
                    alarmTime  : string & format.Time
                    ttl        : string & format.Duration
                    objectId   : string & format.ObjectId
                    code       : string & constraint.Pattern<'^(?:USR|ADM)-[0-9]{3,5}$'>
                    template   : \`item_\${number}_ok\`
                    upperTag   : Uppercase<string> & constraint.MinLength<3> & constraint.MaxLength<6>
                    trimmed    : string & transform.Trim & transform.Lowercase
                    age        : number & constraint.Integer & constraint.Minimum<18> & constraint.Maximum<99>
                    ratio      : number & constraint.ExclusiveMinimum<0> & constraint.ExclusiveMaximum<1>
                    stepVal    : number & constraint.MultipleOf<0.25> & constraint.Minimum<1> & constraint.Maximum<5>
                    bigId      : bigint & constraint.Minimum<100n> & constraint.Maximum<500n> & constraint.MultipleOf<10n>
                    status     : StatusEnum
                    flags      : [ boolean, string, number? ]
                    uniqueNums : Array<number & constraint.Integer & constraint.Minimum<1> & constraint.Maximum<50>> & constraint.MinItems<2> & constraint.MaxItems<4> & constraint.UniqueItems
                    taggedArr  : string[] & constraint.Contains<'required-item'> & constraint.MinContains<1> & constraint.MaxContains<2>
                    tagSet     : Set<string> & constraint.MinItems<2> & constraint.MaxItems<3>
                    scoreMap   : Map<string, number> & constraint.MinProperties<1> & constraint.MaxProperties<2>
                    dynRecord  : Record<string, number> & constraint.MinProperties<2> & constraint.MaxProperties<3>
                    liveDate   : Date
                    liveUrl    : URL
                    liveRegex  : RegExp
                    liveBuf    : Buffer
                    liveBytes  : Uint8Array
                    liveBlob   : Blob
                    liveFile   : File
                    role?      : string & tag.Default<'user'>
                }

                export interface RecursiveCategory
                {
                    title : string & constraint.MinLength<2>
                    sub?  : RecursiveCategory[]
                }

                export const genProfileOnce = ( seed?: number ) => random<MockProfile>( seed );
                export const profileGenerator = randomGenerator<MockProfile>( 1337 );
                export const unseededGenerator = randomGenerator<MockProfile>();
                export const isValidProfile = ( v: unknown ) => is<MockProfile>( v );

                export const genCategory = randomGenerator<RecursiveCategory>( 7 );
                export const isValidCategory = ( v: unknown ) => is<RecursiveCategory>( v );
            `, 'temp_tier2d_random_generator' );
        });

        it( 'generates deterministic, constraint-valid MockProfile fixtures across 20 seeds that pass is<MockProfile>()', () =>
        {
            // Arrange
            const firstRun = mod.genProfileOnce( 2026 );
            const secondRun = mod.genProfileOnce( 2026 );
            const unseeded = mod.genProfileOnce();
            const streamA1 = mod.profileGenerator();
            const streamA2 = mod.profileGenerator();
            const overrideSeed = mod.profileGenerator( 2026 );
            const unseededGenSample = mod.unseededGenerator();

            // Act & Assert
            expect( firstRun.id ).toBe( secondRun.id );
            expect( firstRun.email ).toBe( secondRun.email );
            expect( firstRun.code ).toBe( secondRun.code );
            expect( firstRun.age ).toBe( secondRun.age );
            expect( firstRun.bigId ).toBe( secondRun.bigId );
            expect( streamA1.id ).not.toBe( streamA2.id );
            expect( overrideSeed.id ).toBe( firstRun.id );

            expect( mod.isValidProfile( firstRun )).toBe( true );
            expect( mod.isValidProfile( unseeded )).toBe( true );
            expect( mod.isValidProfile( unseededGenSample )).toBe( true );

            for( let seed = 1; seed <= 20; seed++ )
            {
                const sample = mod.genProfileOnce( seed );
                expect( mod.isValidProfile( sample )).toBe( true );
            }
        });

        it( 'terminates cleanly on recursive types via depth-bounded generation and passes is<RecursiveCategory>()', () =>
        {
            // Arrange & Act
            for( let seed = 1; seed <= 10; seed++ )
            {
                const cat = mod.genCategory( seed );

                // Assert
                expect( mod.isValidCategory( cat )).toBe( true );
            }
        });

        it( 'covers all runtime branches in random-runtime.ts (numeric/bigint bounds, formats, regex sampler, collections, binaries)', () =>
        {
            // Arrange
            const rng = createRng( 99 );
            const unseededRng = createRng();
            const genWithSeed = createRandomGenerator( r => randBool( r ), 10 );

            // Act & Assert
            expect( typeof unseededRng()).toBe( 'number' );
            expect( typeof genWithSeed()).toBe( 'boolean' );
            expect( typeof genWithSeed( 10 )).toBe( 'boolean' );
            expect( randInt( rng, 10, 5 )).toBe( 10 );

            // randNumber branches: step + exclMin + min + exclMax + max, float bounds, hi <= lo
            expect( randNumber( rng, { step : 0.5, exclMin : 1, min : 2, exclMax : 5, max : 4 })).toBeGreaterThanOrEqual( 2 );
            expect( randNumber( rng, { integer : true })).toBeGreaterThanOrEqual( 0 );
            expect( randNumber( rng, { integer : true, min : 5, max : 5 })).toBe( 5 );
            expect( randNumber( rng, { exclMin : 2, min : 3, exclMax : 8, max : 7 })).toBeGreaterThan( 3 );
            expect( randNumber( rng, { exclMin : 2, exclMax : 4 })).toBeGreaterThan( 2 );
            expect( randNumber( rng, { min : 10, max : 5 })).toBe( 10 );
            expect( randNumber( rng )).toBeGreaterThanOrEqual( 0 );

            // randBigInt branches: exclMin, min, exclMax, max, step with negative/non-aligned lo, large span
            expect( randBigInt( rng, { exclMin : 5n, min : 10n, exclMax : 30n, max : 25n, step : 4n }) % 4n ).toBe( 0n );
            expect( randBigInt( rng, { exclMin : 10n, min : 5n, exclMax : 20n, max : 30n })).toBeGreaterThan( 10n );
            expect( randBigInt( rng, { min : 0n, max : 50000n, step : 1n })).toBeGreaterThanOrEqual( 0n );
            expect( randBigInt( rng, { min : 10n, max : 5n, step : 3n })).toBe( 12n );
            expect( randBigInt( rng, { min : 0n, max : 50000n })).toBeGreaterThanOrEqual( 0n );
            expect( randBigInt( rng, { min : 10n, max : 5n })).toBe( 10n );
            expect( randBigInt( rng )).toBeGreaterThanOrEqual( 0n );

            // All randFormat cases
            const formats = [
                'uuid', 'email', 'idn-email', 'url', 'uri', 'iri',
                'uri-reference', 'iri-reference', 'uri-template',
                'hostname', 'idn-hostname', 'ipv4', 'ipv6',
                'date', 'date-time', 'time', 'duration',
                'byte', 'objectId', 'regex', 'custom-unknown-format'
            ];

            for( const fmt of formats )
            {
                expect( randFormat( rng, fmt ).length ).toBeGreaterThan( 0 );
            }

            // randFromPattern comprehensive grammar branches:
            // alternations, escapes inside classes & groups, lookaheads, non-capturing, nested parens,
            // negated char classes (normal & all-excluded), empty class, \d \w \s \D \W \S \t \n \r \z \b \B \x41 \xZZ \u0042 \uZZZZ,
            // dot wildcard, quantifiers ? * + {2} {2,} {2,4} {bad} and lazy +?
            const allPrintableNegated = `[^${'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.:/@'.replace( /[-\\^\]]/g, '\\$&' )}]`;
            expect( randFromPattern( rng, '^([a-z]|\\d)+$' )).toMatch( /^([a-z]|\d)+$/ );
            expect( randFromPattern( rng, '^(?=foo)(?!bar)(?:([ab\\]]+))\\b\\B$' )).toMatch( /^[ab\]]+$/ );
            expect( randFromPattern( rng, '[\\d\\w\\s\\D\\W\\S\\t\\n\\r\\q][^abc][]' ).length ).toBeGreaterThanOrEqual( 2 );
            expect( randFromPattern( rng, allPrintableNegated )).toBe( 'a' );
            expect( randFromPattern( rng, '\\d\\w\\s\\D\\W\\S\\t\\n\\r\\q\\x41\\xZZ\\u0042\\uZZZZ.' ).length ).toBe( 15 );
            expect( randFromPattern( rng, 'a?b*?c+?d{2}e{1,}f{1,2}g{bad}h{unclosed' ).length ).toBeGreaterThan( 0 );

            // randString mappings & transforms
            expect( randString( rng, { pattern : '^abc$', transforms : [ 'Uppercase' ] })).toBe( 'ABC' );
            expect( randString( rng, { format : 'uuid', mapping : 'Lowercase' })).toHaveLength( 36 );
            expect( randString( rng, { minLength : 0, maxLength : 0, transforms : [ 'Capitalize', 'Uncapitalize', 'trim', 'unknown' ] })).toBe( '' );
            expect( randString( rng, { minLength : 3, maxLength : 3, transforms : [ 'Capitalize', 'Uncapitalize' ] })).toHaveLength( 3 );
            expect( randString( rng ).length ).toBeGreaterThanOrEqual( 4 );

            // randArray: default opts, maxContains, unique exhaustion, and containsGen without maxContains
            expect( randArray( rng, () => 1 ).length ).toBeGreaterThanOrEqual( 1 );
            const withMaxContains = randArray( rng, () => 'other', {
                containsGen : () => 'needle',
                minContains : 1,
                maxContains : 2,
                minItems    : 3,
                maxItems    : 3
            });
            expect( withMaxContains ).toContain( 'needle' );
            const exhaustedUnique = randArray( rng, r => randBool( r ), { minItems : 4, maxItems : 4, unique : true });
            expect( exhaustedUnique.length ).toBe( 2 );
            const withContainsDefault = randArray( rng, () => 'other', { containsGen : () => 'needle', minItems : 2, maxItems : 2 });
            expect( withContainsDefault ).toContain( 'needle' );

            // randSet, randMap, randRecord (including default args, explicit max bounds, and duplicate key collision skip)
            expect( randSet( rng, r => randString( r )).size ).toBeGreaterThanOrEqual( 1 );
            expect( randSet( rng, r => randString( r ), 1, 2 ).size ).toBeGreaterThanOrEqual( 1 );
            expect( randSet( rng, () => 'constant', 2 ).size ).toBe( 1 );
            expect( randMap( rng, r => randString( r ), () => 1 ).size ).toBeGreaterThanOrEqual( 1 );
            expect( randMap( rng, r => randString( r ), () => 1, 1, 2 ).size ).toBeGreaterThanOrEqual( 1 );
            expect( randMap( rng, () => 'sameKey', () => 1, 2 ).size ).toBe( 1 );
            const recTarget: Record<string, any> = { existing : 1 };
            let keyCall = 0;
            randRecord( rng, () => ( keyCall++ === 0 ? 'existing' : `k_${keyCall}` ), () => 42, recTarget );
            expect( Object.keys( recTarget ).length ).toBeGreaterThanOrEqual( 1 );
            const boundedRec = randRecord( rng, r => randString( r ), () => 9, {}, 1, 2 );
            expect( Object.keys( boundedRec ).length ).toBeGreaterThanOrEqual( 1 );

            // Built-in leaf generators
            expect( randDate( rng )).toBeInstanceOf( Date );
            expect( randUrl( rng )).toBeInstanceOf( URL );
            expect( randRegExp( rng )).toBeInstanceOf( RegExp );
            expect( Buffer.isBuffer( randBuffer( rng ))).toBe( true );
            expect( randBinary( rng, 'ArrayBuffer' )).toBeInstanceOf( ArrayBuffer );
            expect( randBinary( rng, 'SharedArrayBuffer' )).toBeInstanceOf( SharedArrayBuffer );
            expect( randBinary( rng, 'DataView' )).toBeInstanceOf( DataView );
            expect( randBinary( rng, 'Int32Array' )).toBeInstanceOf( Int32Array );
            expect( randBlob( rng )).toBeInstanceOf( Blob );
            expect( randFile( rng )).toBeInstanceOf( File );
        });
    });
});
