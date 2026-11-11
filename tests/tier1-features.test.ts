import { describe, it, expect, beforeAll } from 'vitest';
import ts from 'typescript';
import * as path from 'path';
import { emitAndImport, compileAndTransform, getCachedCompilerHost } from './helpers/compile.js';
import { collectStaticConstraintDiagnostics } from '../src/transformer.js';
import {
    createParser,
    checkParseOptions,
    parseJson,
    coerceBigIntProp,
    coerceBigIntRoot,
    ParseError
} from '../src/runtime/parse-runtime.js';
import {
    createSerializer,
    checkSerializeOptions,
    applyJsonReplacer,
    SerializationError
} from '../src/runtime/serializer-runtime.js';
import { validateSchema } from '../src/index.js';

describe( 'Tier 1 Features', () =>
{
    describe( 'Tier 1.1: CompiledParser<T> and CompiledSerializer<T>', () =>
    {
        let mod: Record<string, any>;

        beforeAll( async() =>
        {
            mod = await emitAndImport( `
                import { parser, serializer, constraint, format, tag } from '../src/index.js';

                export interface Account
                {
                    id     : string & format.UUID
                    handle : string & constraint.MinLength<3>
                    score? : number & tag.Default<10>
                    tags   : string[]
                }

                export const parseAccount = parser<Account>({ mode : 'strict' });
                export const parseAccountQuery = parser<Account>({ from : 'query', mode : 'strip' });
                export const serializeAccount = serializer<Account>({ mode : 'strict' });
                export const serializeAccountQuery = serializer<Account>({ format : 'query', mode : 'strip' });
            `, 'temp_tier1_1_compiled_codecs' );
        });

        it( 'supports callable, .parse, .safe, .safeParse, ~standard, and runtime overrides on CompiledParser<T>', () =>
        {
            // Arrange
            const validPayload = JSON.stringify({
                id     : '550e8400-e29b-41d4-a716-446655440000',
                handle : 'alice',
                tags   : [ 'admin', 'core' ]
            });
            const invalidPayload = JSON.stringify({
                id     : '550e8400-e29b-41d4-a716-446655440000',
                handle : 'al',
                tags   : [ 'ok', 123 ]
            });

            // Act
            const direct = mod.parseAccount( validPayload );
            const viaMethod = mod.parseAccount.parse( validPayload );
            const safeOk = mod.parseAccount.safe( validPayload );
            const safeAlias = mod.parseAccount.safeParse( invalidPayload );
            const stdOk = mod.parseAccount['~standard'].validate( validPayload );
            const stdFail = mod.parseAccount['~standard'].validate( invalidPayload );
            const stdRootFail = mod.parseAccount['~standard'].validate( 42 );
            const transformed = mod.parseAccount( validPayload, {
                transform : ( val: unknown, ctx: { path : string }) => ( ctx.path === 'handle' ? String( val ).toUpperCase() : val )
            });
            const queryOk = mod.parseAccountQuery.safe( 'id=550e8400-e29b-41d4-a716-446655440000&handle=bob&tags=one&extra=ignored' );

            // Assert
            expect( direct ).toEqual({
                id     : '550e8400-e29b-41d4-a716-446655440000',
                handle : 'alice',
                score  : 10,
                tags   : [ 'admin', 'core' ]
            });
            expect( viaMethod ).toEqual( direct );
            expect( safeOk ).toEqual({ success : true, data : direct });
            expect( safeAlias.success ).toBe( false );
            expect( safeAlias.error.path ).toBe( 'handle' );
            expect( mod.parseAccount['~standard'].version ).toBe( 1 );
            expect( mod.parseAccount['~standard'].vendor ).toBe( 'webergency-typechecker' );
            expect( stdOk ).toEqual({ value : direct });
            expect( stdFail.issues ).toEqual([{ message : 'MinLength<3>', path : ['handle'] }]);
            expect( stdRootFail.issues ).toEqual([{ message : 'Type<string>' }]);
            expect( transformed.handle ).toBe( 'ALICE' );
            expect( queryOk.success ).toBe( true );
            expect( queryOk.data.score ).toBe( 10 );
        });

        it( 'supports callable, .stringify, .safe, .safeSerialize, and runtime overrides on CompiledSerializer<T>', () =>
        {
            // Arrange
            const validAccount = {
                id     : '550e8400-e29b-41d4-a716-446655440000',
                handle : 'alice',
                score  : 25,
                tags   : ['pro']
            };
            const invalidAccount = {
                id     : '550e8400-e29b-41d4-a716-446655440000',
                handle : 'alice',
                score  : Number.POSITIVE_INFINITY,
                tags   : ['pro']
            };

            // Act
            const directJson = mod.serializeAccount( validAccount );
            const methodJson = mod.serializeAccount.stringify( validAccount );
            const safeOk = mod.serializeAccount.safe( validAccount );
            const safeBad = mod.serializeAccount.safeSerialize( invalidAccount );
            const replacedJson = mod.serializeAccount( validAccount, {
                replacer : ( key: string, val: unknown ) => ( key === 'handle' ? 'redacted' : val )
            });
            const querySafe = mod.serializeAccountQuery.safe({ ...validAccount, extra : 'drop' });

            // Assert
            expect( JSON.parse( directJson )).toEqual( validAccount );
            expect( methodJson ).toBe( directJson );
            expect( safeOk ).toEqual({ success : true, data : directJson });
            expect( safeBad.success ).toBe( false );
            expect( safeBad.error.path ).toBe( 'score' );
            expect( JSON.parse( replacedJson ).handle ).toBe( 'redacted' );
            expect( querySafe.success ).toBe( true );
            expect( querySafe.data ).not.toContain( 'extra' );
        });

        it( 'exercises createParser and createSerializer source helpers across option merging and path segments', () =>
        {
            // Arrange
            const rawParser = ( input: any, opts?: any ) =>
            {
                if( input === 'arr-err' ){ throw new ParseError( 'items[2]', 'Type<number>' ) }

                if( input === 'map-err' ){ throw new ParseError( 'bag[alpha]', 'Type<string>' ) }

                if( typeof input !== 'string' ){ throw new ParseError( '', 'Type<string>' ) }

                return `${input}:${opts?.transform ? 'tx' : 'plain'}`;
            };
            const pNoDef = createParser<string>( rawParser );
            const pStrDef = createParser<string>( rawParser, 'strict' );
            const pObjDef = createParser<string>( rawParser, { reviver : ( _k: string, v: any ) => v });

            const rawSer = ( input: any, opts?: any ) =>
            {
                if( typeof input !== 'string' ){ throw new SerializationError( 'name', 'Type<string>' ) }

                return JSON.stringify( opts?.transform ? `${input}!` : input );
            };
            const sNoDef = createSerializer<string>( rawSer );
            const sStrDef = createSerializer<string>( rawSer, 'strict' );
            const sObjDef = createSerializer<string>( rawSer, { transform : ( v: unknown ) => v });

            // Act
            const stdArrFail = pNoDef['~standard'].validate( 'arr-err' );
            const stdMapFail = pNoDef['~standard'].validate( 'map-err' );
            const stdRootFail = pNoDef['~standard'].validate( 123 );
            const stdOk = pNoDef['~standard'].validate( 'ok' );
            const mergedP1 = pStrDef( 'ok', { transform : v => v });
            const mergedP2 = pObjDef.safe( 'ok', { transform : v => v });
            const mergedS1 = sNoDef( 'hi' );
            const mergedS2 = sStrDef.stringify( 'hi', { transform : v => v });
            const mergedS3 = sObjDef.safe( 'hi', { transform : v => v });
            const safeFail = sNoDef.safeSerialize( 123 );

            // Assert
            expect( stdArrFail ).toEqual({ issues : [{ message : 'Type<number>', path : [ 'items', 2 ] }] });
            expect( stdMapFail ).toEqual({ issues : [{ message : 'Type<string>', path : [ 'bag', 'alpha' ] }] });
            expect( stdRootFail ).toEqual({ issues : [{ message : 'Type<string>' }] });
            expect( stdOk ).toEqual({ value : 'ok:plain' });
            expect( mergedP1 ).toBe( 'ok:tx' );
            expect( mergedP2 ).toEqual({ success : true, data : 'ok:tx' });
            expect( mergedS1 ).toBe( '"hi"' );
            expect( mergedS2 ).toBe( '"hi!"' );
            expect( mergedS3 ).toEqual({ success : true, data : '"hi!"' });
            expect( safeFail.success ).toBe( false );
        });
    });

    describe( 'Tier 1.2: JSDoc Constraint and OpenAPI Metadata Extraction', () =>
    {
        let mod: Record<string, any>;

        beforeAll( async() =>
        {
            mod = await emitAndImport( `
                import { validate, parse, jsonSchema, constraint } from '../src/index.js';

                /**
                 * Annotated product model
                 * @title ProductRecord
                 * @minProperties 2
                 * @maxProperties 10
                 */
                export interface AnnotatedProduct
                {
                    /**
                     * SKU code
                     * @title SKU
                     * @minLength 3
                     * @maxLength 8
                     * @pattern ^[A-Z0-9-]+$
                     * @example "SKU-01"
                     * @example "SKU-02"
                     */
                    sku: string

                    /**
                     * Unit price
                     * @minimum 0
                     * @exclusiveMinimum 0
                     * @maximum 1000
                     * @exclusiveMaximum 1000
                     * @multipleOf 0.5
                     * @example 19.5
                     */
                    price: number

                    /**
                     * Contact email
                     * @format email
                     * @deprecated Legacy contact field
                     */
                    contact?: string

                    /**
                     * Currency code
                     * @default "USD"
                     */
                    currency?: string

                    /**
                     * Unique keyword list
                     * @minItems 1
                     * @maxItems 4
                     * @uniqueItems
                     */
                    keywords: string[]

                    /**
                     * Explicit tag overrides JSDoc minimum 1 with Minimum<10>
                     * @minimum 1
                     */
                    stock: number & constraint.Minimum<10>

                    /**
                     * Featured numbers with min/max contains via JSDoc
                     * @minContains 1
                     * @maxContains 2
                     */
                    scores?: ( number | string )[] & constraint.Contains<number>
                }

                /**
                 * Temperature in Celsius
                 * @minimum -50
                 * @maximum 60
                 */
                export type Celsius = number;

                export const validateProduct = ( v: unknown ) => validate<AnnotatedProduct>( v );
                export const parseProduct = ( s: string ) => parse<AnnotatedProduct>( s );
                export const productSchema = jsonSchema<AnnotatedProduct>();
                export const validateCelsius = ( v: unknown ) => validate<Celsius>( v );
                export const parseCelsius = ( s: string ) => parse<Celsius>( s );
                export const celsiusSchema = jsonSchema<Celsius>();
            `, 'temp_tier1_2_jsdoc' );
        });

        it( 'emits OpenAPI metadata and constraint keywords in jsonSchema from JSDoc comments', () =>
        {
            // Arrange
            const schema = mod.productSchema;
            const props = schema.properties;

            // Act & Assert
            expect( schema.title ).toBe( 'ProductRecord' );
            expect( schema.description ).toBe( 'Annotated product model' );
            expect( schema.minProperties ).toBe( 2 );
            expect( schema.maxProperties ).toBe( 10 );

            expect( props.sku.title ).toBe( 'SKU' );
            expect( props.sku.description ).toBe( 'SKU code' );
            expect( props.sku.minLength ).toBe( 3 );
            expect( props.sku.maxLength ).toBe( 8 );
            expect( props.sku.pattern ).toBe( '^[A-Z0-9-]+$' );
            expect( props.sku.examples ).toEqual([ 'SKU-01', 'SKU-02' ]);

            expect( props.price.exclusiveMinimum ).toBe( 0 );
            expect( props.price.exclusiveMaximum ).toBe( 1000 );
            expect( props.price.multipleOf ).toBe( 0.5 );
            expect( props.price.examples ).toEqual([19.5]);

            expect( props.contact.format ).toBe( 'email' );
            expect( props.contact.deprecated ).toBe( true );
            expect( props.currency.default ).toBe( 'USD' );

            expect( props.keywords.minItems ).toBe( 1 );
            expect( props.keywords.maxItems ).toBe( 4 );
            expect( props.keywords.uniqueItems ).toBe( true );
            expect( props.stock.minimum ).toBe( 10 );
            expect( props.scores.minContains ).toBe( 1 );
            expect( props.scores.maxContains ).toBe( 2 );

            expect( mod.celsiusSchema ).toMatchObject({
                type        : 'number',
                description : 'Temperature in Celsius',
                minimum     : -50,
                maximum     : 60
            });
        });

        it( 'enforces JSDoc constraints and @default across validate and parse with explicit tag precedence', () =>
        {
            // Arrange
            const validRaw = {
                sku      : 'SKU-01',
                price    : 25.5,
                contact  : 'ops@example.com',
                keywords : [ 'fast', 'typed' ],
                stock    : 12,
                scores   : [ 'x', 1, 2 ]
            };

            // Act
            const vOk = mod.validateProduct( validRaw );
            const pOk = mod.parseProduct( JSON.stringify( validRaw ));
            const vStockPrecedence = mod.validateProduct({ ...validRaw, stock : 5 });
            const pBadPattern = () => mod.parseProduct( JSON.stringify({ ...validRaw, sku : 'bad!' }));
            const vDupItems = mod.validateProduct({ ...validRaw, keywords : [ 'dup', 'dup' ] });
            const cOk = mod.validateCelsius( -25 );
            const cFail = mod.validateCelsius( -80 );
            const cParseOk = mod.parseCelsius( '-15' );

            // Assert
            expect( vOk.success ).toBe( true );
            expect( vOk.data.currency ).toBe( 'USD' );
            expect( pOk.currency ).toBe( 'USD' );
            expect( vStockPrecedence.success ).toBe( false );
            expect( vStockPrecedence.errors[0].error ).toBe( 'Minimum<10>' );
            expect( pBadPattern ).toThrow( 'Pattern' );
            expect( vDupItems.success ).toBe( false );
            expect( cOk.success ).toBe( true );
            expect( cFail.success ).toBe( false );
            expect( cParseOk ).toBe( -15 );
        });

        it( 'reports static diagnostics on literal violations against JSDoc tags', () =>
        {
            // Arrange
            const file = path.resolve( './temp_tier1_2_static_jsdoc.ts' );
            const code = `
                interface Config
                {
                    /** @minimum 10 */
                    port: number;
                    /** @minLength 5 */
                    env: string;
                }
                const bad: Config = { port: 3, env: 'dev' };
            `;
            const opts: ts.CompilerOptions = {
                target           : ts.ScriptTarget.ES2022,
                module           : ts.ModuleKind.NodeNext,
                moduleResolution : ts.ModuleResolutionKind.NodeNext,
                strict           : true,
                skipLibCheck     : true,
                types            : ['node']
            };
            const virtualFiles = new Map([[ file, code ]]);
            const host = getCachedCompilerHost( opts, virtualFiles );
            const program = ts.createProgram([file], opts, host );
            const sf = program.getSourceFile( file )!;

            // Act
            const diags = collectStaticConstraintDiagnostics( sf, program.getTypeChecker());

            // Assert
            expect( diags.length ).toBe( 2 );
            expect( diags.map( d => String( d.messageText )).join( ' | ' )).toContain( 'Minimum<10>' );
            expect( diags.map( d => String( d.messageText )).join( ' | ' )).toContain( 'MinLength<5>' );
        });
    });

    describe( 'Tier 1.3: Zero-Allocation Wire Property Casing (propertyCasing)', () =>
    {
        let mod: Record<string, any>;

        beforeAll( async() =>
        {
            mod = await emitAndImport( `
                import { parse, stringify, jsonSchema, constraint, tag } from '../src/index.js';

                export interface BillingProfile
                {
                    userId          : string
                    billingAddress? : string
                    taxNumber?      : string & constraint.Requires<'billingAddress'>
                    retryCount?     : number & tag.Default<3>
                    nestedMeta      : {
                        createdAt : string
                    }
                }

                export type WebhookEvent =
                    | { eventType : 'user_created'; userId : string }
                    | { eventType : 'invoice_paid'; invoiceTotal : number };

                export const parseSnakeStrict = ( s: string ) => parse<BillingProfile>( s, { mode : 'strict', propertyCasing : 'snake_case' });
                export const parseSnakeStrip = ( s: string ) => parse<BillingProfile>( s, { mode : 'strip', propertyCasing : 'snake_case' });
                export const parseSnakeQuery = ( s: string ) => parse<BillingProfile>( s, { from : 'query', propertyCasing : 'snake_case' });
                export const serializeSnake = ( v: BillingProfile ) => stringify<BillingProfile>( v, { mode : 'strict', propertyCasing : 'snake_case' });
                export const serializeSnakeQuery = ( v: BillingProfile ) => stringify<BillingProfile>( v, { format : 'query', propertyCasing : 'snake_case' });
                export const schemaSnake = jsonSchema<BillingProfile>({ propertyCasing : 'snake_case' });

                export const parseEventSnake = ( s: string ) => parse<WebhookEvent>( s, { mode : 'strict', propertyCasing : 'snake_case' });
                export const serializeEventSnake = ( v: WebhookEvent ) => stringify<WebhookEvent>( v, { mode : 'strict', propertyCasing : 'snake_case' });
            `, 'temp_tier1_3_property_casing' );
        });

        it( 'maps wire snake_case keys to TypeScript camelCase properties in parse, stringify, and jsonSchema', () =>
        {
            // Arrange
            const wireJson = JSON.stringify({
                user_id     : 'u_1',
                nested_meta : { created_at : '2026-01-01' }
            });

            // Act
            const parsed = mod.parseSnakeStrict( wireJson );
            const roundTrip = mod.serializeSnake( parsed );
            const queryOut = mod.serializeSnakeQuery( parsed );
            const queryParsed = mod.parseSnakeQuery( queryOut );

            // Assert
            expect( parsed ).toEqual({
                userId     : 'u_1',
                retryCount : 3,
                nestedMeta : { createdAt : '2026-01-01' }
            });
            expect( JSON.parse( roundTrip )).toEqual({
                user_id     : 'u_1',
                retry_count : 3,
                nested_meta : { created_at : '2026-01-01' }
            });
            expect( queryOut ).toContain( 'user_id=u_1' );
            expect( queryOut ).toContain( 'nested_meta%5Bcreated_at%5D=2026-01-01' );
            expect( queryParsed ).toEqual( parsed );

            expect( mod.schemaSnake.properties ).toHaveProperty( 'user_id' );
            expect( mod.schemaSnake.properties ).toHaveProperty( 'nested_meta' );
            expect( mod.schemaSnake.required ).toEqual([ 'user_id', 'nested_meta' ]);
            expect( mod.schemaSnake.properties.tax_number.requires ).toBe( 'billing_address' );
        });

        it( 'enforces strict unknown-key rejection, Requires wire paths, and discriminated unions under propertyCasing', () =>
        {
            // Arrange
            const camelLeak = JSON.stringify({
                user_id     : 'u_1',
                userId      : 'u_1',
                nested_meta : { created_at : '2026-01-01' }
            });
            const missingDep = JSON.stringify({
                user_id     : 'u_1',
                tax_number  : 'VAT-123',
                nested_meta : { created_at : '2026-01-01' }
            });
            const eventWire = JSON.stringify({
                event_type    : 'invoice_paid',
                invoice_total : 99.5
            });

            // Act
            const parsedEvent = mod.parseEventSnake( eventWire );
            const serializedEvent = mod.serializeEventSnake( parsedEvent );

            // Assert
            expect(() => mod.parseSnakeStrict( camelLeak )).toThrow( 'PropertyNotAllowed<userId>' );
            expect(() => mod.parseSnakeStrict( missingDep )).toThrow( 'Requires<billing_address>' );
            expect( parsedEvent ).toEqual({ eventType : 'invoice_paid', invoiceTotal : 99.5 });
            expect( JSON.parse( serializedEvent )).toEqual({ event_type : 'invoice_paid', invoice_total : 99.5 });
        });

        it( 'rejects colliding wire keys under propertyCasing at compile time across parse, stringify, and jsonSchema', () =>
        {
            // Arrange
            const collisionParse = `
                import { parse } from './src/index.js';
                interface Dup { userId: string; user_id: string }
                export const p = ( s: string ) => parse<Dup>( s, { propertyCasing: 'snake_case' } );
            `;
            const collisionSer = `
                import { stringify } from './src/index.js';
                interface Dup { userId: string; user_id: string }
                export const s = ( v: Dup ) => stringify<Dup>( v, { propertyCasing: 'snake_case' } );
            `;
            const collisionSchema = `
                import { jsonSchema } from './src/index.js';
                interface Dup { userId: string; user_id: string }
                export const j = jsonSchema<Dup>({ propertyCasing: 'snake_case' });
            `;

            // Act & Assert
            expect(() => compileAndTransform( collisionParse, 'temp_tier1_3_dup_parse' )).toThrow( /Casing conversion collision/ );
            expect(() => compileAndTransform( collisionSer, 'temp_tier1_3_dup_ser' )).toThrow( /Casing conversion collision/ );
            expect(() => compileAndTransform( collisionSchema, 'temp_tier1_3_dup_schema' )).toThrow( /Casing conversion collision/ );
        });
    });

    describe( 'Tier 1.4: Lossless BigInt JSON Wire Codec', () =>
    {
        let mod: Record<string, any>;

        beforeAll( async() =>
        {
            mod = await emitAndImport( `
                import { parse, stringify, jsonSchema } from '../src/index.js';

                export interface LedgerEntry
                {
                    id       : bigint
                    magic    : 9007199254740993n
                    amounts  : bigint[]
                    pair     : [ string, bigint ]
                    flags    : Set<bigint>
                    balances : Map<string, bigint>
                    nested   : { total : bigint }
                }

                export interface BigChain
                {
                    val  : bigint
                    next?: BigChain
                }

                export const parseRootBig = ( s: string ) => parse<bigint>( s );
                export const serializeRootBigStr = ( v: bigint ) => stringify<bigint>( v );
                export const serializeRootBigNum = ( v: bigint, replacer?: ( k: string, val: any ) => any ) =>
                    stringify<bigint>( v, { bigintAs : 'number', replacer });

                export const parseLedger = ( s: string ) => parse<LedgerEntry>( s );
                export const serializeLedgerStr = ( v: LedgerEntry ) => stringify<LedgerEntry>( v );
                export const serializeLedgerNum = ( v: LedgerEntry, replacer?: ( k: string, val: any ) => any ) =>
                    stringify<LedgerEntry>( v, { bigintAs : 'number', replacer });

                export const parseChain = ( s: string ) => parse<BigChain>( s );
                export const serializeChainNum = ( v: BigChain ) => stringify<BigChain>( v, { bigintAs : 'number' });
                export const magicSchema = jsonSchema<9007199254740993n>();
            `, 'temp_tier1_4_bigint_codec' );
        });

        it( 'round-trips >53-bit and 128-bit BigInt values losslessly in both string (default) and raw number JSON modes', () =>
        {
            // Arrange
            const huge64 = 9007199254740993n;
            const huge128 = 340282366920938463463374607431768211455n;
            const entry = {
                id       : huge128,
                magic    : huge64,
                amounts  : [ -9007199254740995n, 0n, huge128 ],
                pair     : [ 'tx', huge64 ] as [ string, bigint ],
                flags    : new Set([ huge64, huge128 ]),
                balances : new Map([[ 'cold', huge128 ]]),
                nested   : { total : huge64 }
            };

            // Act
            const jsonDefault = mod.serializeLedgerStr( entry );
            const jsonRawNum = mod.serializeLedgerNum( entry );
            const parsedFromStr = mod.parseLedger( jsonDefault );
            const parsedFromNum = mod.parseLedger( jsonRawNum );
            const rootStr = mod.serializeRootBigStr( huge128 );
            const rootNum = mod.serializeRootBigNum( huge128 );

            // Assert
            expect( jsonDefault ).toContain( `"${huge128.toString()}"` );
            expect( jsonRawNum ).toContain( ':340282366920938463463374607431768211455' );
            expect( parsedFromStr ).toEqual( entry );
            expect( parsedFromNum ).toEqual( entry );
            expect( rootStr ).toBe( `"${huge128.toString()}"` );
            expect( rootNum ).toBe( huge128.toString());
            expect( mod.parseRootBig( rootStr )).toBe( huge128 );
            expect( mod.parseRootBig( rootNum )).toBe( huge128 );
        });

        it( 'supports recursive BigInt structures, replacer preservation of raw >53-bit integers, and BigInt literal schemas', () =>
        {
            // Arrange
            const chain = {
                val  : 9007199254740993n,
                next : { val : 9007199254740999n }
            };

            // Act
            const rawChainJson = mod.serializeChainNum( chain );
            const parsedChain = mod.parseChain( rawChainJson );
            const replacedRoot = mod.serializeRootBigNum( 9007199254740993n, ( _k: string, v: unknown ) => v );
            const okSchema = validateSchema( mod.magicSchema, 9007199254740993n );
            const badLitSchema = validateSchema( mod.magicSchema, 9007199254740994n );
            const badTypeSchema = validateSchema( mod.magicSchema, 'not-bigint' );

            // Assert
            expect( parsedChain ).toEqual( chain );
            expect( replacedRoot ).toBe( '9007199254740993' );
            expect( okSchema.success ).toBe( true );
            expect( badLitSchema.success ).toBe( false );
            expect( badTypeSchema.success ).toBe( false );
        });

        it( 'covers source-level BigInt reviver, replacer, and runtime option guards directly', () =>
        {
            // Arrange
            const rawText = '{"big":9007199254740993,"big2":9007199254740995,"safe":42}';

            // Act
            const decoded = parseJson( rawText, true );
            const propBig = coerceBigIntProp( decoded, 'big', decoded.big, 'big' );
            const propBig2 = coerceBigIntProp( decoded, 'big2', decoded.big2, 'big2' );
            const propFallback = coerceBigIntProp( null, 'safe', 42, 'safe' );
            const unsafeFloat = Number( '9007199254740993' );
            const propNoSrc = () => coerceBigIntProp({}, 'missing', unsafeFloat, 'missing' );
            const rootBig = coerceBigIntRoot( ' 9007199254740993 ', unsafeFloat, '' );
            const rootFloatFail = () => coerceBigIntRoot( '1e25', 1e25, '' );
            const rootNonStrFail = () => coerceBigIntRoot( null, unsafeFloat, '' );

            const noReplacer = applyJsonReplacer( rawText );
            const withObjReplacer = applyJsonReplacer( rawText, ( key, val ) => ( key === 'safe' ? 100 : val ));
            const withRootReplacer = applyJsonReplacer( '9007199254740993', ( _key, val ) => val );
            const undefinedRoot = () => applyJsonReplacer( '{}', () => undefined );

            // Assert
            expect( propBig ).toBe( 9007199254740993n );
            expect( propBig2 ).toBe( 9007199254740995n );
            expect( propFallback ).toBe( 42n );
            expect( propNoSrc ).toThrow( ParseError );
            expect( rootBig ).toBe( 9007199254740993n );
            expect( rootFloatFail ).toThrow( ParseError );
            expect( rootNonStrFail ).toThrow( ParseError );

            expect( noReplacer ).toBe( rawText );
            expect( withObjReplacer ).toBe( '{"big":9007199254740993,"big2":9007199254740995,"safe":100}' );
            expect( withRootReplacer ).toBe( '9007199254740993' );
            expect( undefinedRoot ).toThrow( SerializationError );

            expect( checkParseOptions( null, 'strip', 'json', 'specificity' )).toBeNull();
            expect( checkParseOptions( 'strip', 'strip', 'json', 'specificity' )).toBeUndefined();
            expect( checkParseOptions( 123, 'strip', 'json', 'specificity' )).toBe( 123 );
            expect(() => checkParseOptions( 'strict', 'strip', 'json', 'specificity' )).toThrow( ParseError );
            expect(() => checkParseOptions({ mode : 'strict' }, 'strip', 'json', 'specificity' )).toThrow( ParseError );
            expect(() => checkParseOptions({ from : 'query' }, 'strip', 'json', 'specificity' )).toThrow( ParseError );
            expect(() => checkParseOptions({ unionResolution : 'declaration-order' }, 'strip', 'json', 'specificity' )).toThrow( ParseError );
            expect(() => checkParseOptions({ propertyCasing : 'snake_case' }, 'strip', 'json', 'specificity' )).toThrow( ParseError );
            expect( checkParseOptions({ mode : 'strip', from : 'json', unionResolution : 'specificity', propertyCasing : 'camelCase' }, 'strip', 'json', 'specificity', 'camelCase' )).toBeDefined();

            expect( checkSerializeOptions( null, 'strip', 'json', 'specificity' )).toBeNull();
            expect( checkSerializeOptions( 'strip', 'strip', 'json', 'specificity' )).toBeUndefined();
            expect( checkSerializeOptions( 123, 'strip', 'json', 'specificity' )).toBe( 123 );
            expect(() => checkSerializeOptions( 'strict', 'strip', 'json', 'specificity' )).toThrow( SerializationError );
            expect(() => checkSerializeOptions({ mode : 'strict' }, 'strip', 'json', 'specificity' )).toThrow( SerializationError );
            expect(() => checkSerializeOptions({ to : 'query' }, 'strip', 'json', 'specificity' )).toThrow( SerializationError );
            expect(() => checkSerializeOptions({ unionResolution : 'declaration-order' }, 'strip', 'json', 'specificity' )).toThrow( SerializationError );
            expect(() => checkSerializeOptions({ propertyCasing : 'snake_case' }, 'strip', 'json', 'specificity' )).toThrow( SerializationError );
            expect(() => checkSerializeOptions({ bigintAs : 'number' }, 'strip', 'json', 'specificity', undefined, 'string' )).toThrow( SerializationError );
            expect( checkSerializeOptions({ mode : 'strip', format : 'json', unionResolution : 'specificity', propertyCasing : 'camelCase', bigintAs : 'number' }, 'strip', 'json', 'specificity', 'camelCase', 'number' )).toBeDefined();
        });
    });
});
