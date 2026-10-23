import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import ts from 'typescript';
import { emitAndImport, emitAndRequire } from './helpers/compile.js';
import
{
    is as macroIs,
    assert as macroAssert,
    assertGuard as macroAssertGuard,
    validate as macroValidate,
    validator as macroValidator,
    standardSchema as macroStandardSchema,
    jsonSchema as macroJsonSchema,
    parse as macroParse,
    parser as macroParser,
    safeParse as macroSafeParse,
    stringify as macroStringify,
    serializer as macroSerializer,
    safeSerialize as macroSafeSerialize,
    compileSchema,
    getOrCompileSchema,
    validateSchema,
    isSchema,
    assertSchema,
    assertGuardSchema,
    createStandardSchema,
    createValidator,
    groupErrorsByPath,
    toZodIssues,
    ZodLikeError,
    toStandardSchemaIssues,
    coerceQueryNumber,
    coerceQueryBoolean,
    coerceQueryDate,
    coerceJsonDate,
    convertPropertyCasing
}
    from '../src/index.js';
import
{
    is,
    validate,
    assert,
    assertGuard,
    validators,
    parseQueryString,
    hasUniqueItems,
    deepEqual,
    childPath,
    indexPath,
    isIndexSegment,
    tokenizePath,
    joinPathSegments,
    resolvePath,
    getValueAtPath,
    hasPath,
    makeTransformContext,
    applyNodeTransform,
    TransformWalkError,
    isSafeRegexSource,
    createSafeRegex,
    getCachedPattern,
    testRegex,
    type ValidationContext
}
    from '../src/runtime/index.js';
import
{
    shouldTransformFile,
    createBundlerTransformer,
    typecheckerVite,
    typecheckerRollup,
    typecheckerWebpack,
    typecheckerEsbuild,
    typecheckerPlugin
}
    from '../src/unplugin.js';
import initPlugin from '../src/plugin.js';

describe( 'Comprehensive Positive & Negative Verification Suite', () =>
{
    let aot: Record<string, any>;
    let cjsAot: Record<string, any>;

    beforeAll( async () =>
    {
        const code = `
            import {
                is,
                assert,
                assertGuard,
                validate,
                validator,
                standardSchema,
                jsonSchema,
                parse,
                parser,
                safeParse,
                stringify,
                serializer,
                safeSerialize,
                constraint,
                format,
                transform,
                tag,
                type Tag,
                type WithModifiers,
                ParseError,
                SerializationError,
                type ResolveDefaults
            } from '../src/index.js';

            export { ParseError, SerializationError };

            export enum Role {
                Admin = 'ADMIN',
                User = 'USER',
                Guest = 'GUEST'
            }

            export enum Priority {
                Low = 1,
                Medium = 2,
                High = 3
            }

            export class DomainToken {
                constructor( public readonly raw: string ) {}
            }

            export function hasValidChecksum( v: string ): boolean {
                return v.startsWith( 'chk_' ) && v.length >= 6;
            }

            export function appendBang( v: string ): string {
                return v + '!';
            }

            // 1. Primitives, Literals, Enums & Template Literals
            export interface PrimitiveMatrix {
                str: string;
                num: number;
                bool: boolean;
                big: bigint;
                nul: null;
                undef: undefined;
                litStr: 'fixed';
                litNum: 42;
                litBool: true;
                litBig: 99n;
                role: Role;
                priority: Priority;
                finiteTpl: \`\${'get' | 'post'}_\${'users' | 'items'}\`;
                patternTpl: \`usr_\${number}_\${string}\`;
            }

            // 2. Constraints Matrix
            export interface ConstrainedObject {
                intRange: number & constraint.Minimum<10> & constraint.Maximum<20> & constraint.MultipleOf<2>;
                exclNum: number & constraint.ExclusiveMinimum<0> & constraint.ExclusiveMaximum<10>;
                code: string & constraint.MinLength<4> & constraint.MaxLength<8> & constraint.Pattern<'^[A-Z0-9]+$'>;
                exactLen: string & constraint.Length<5, 5>;
                affix: \`pre_\${string}_suf\`;
                email: string & constraint.Format<'email'>;
                uuid: string & constraint.Format<'uuid'>;
                ipv4: string & constraint.Format<'ipv4'>;
                dateStr: string & constraint.Format<'date'>;
                dateTimeStr: string & constraint.Format<'date-time'>;
                tags: ( string & constraint.MinLength<2> )[] & constraint.MinItems<2> & constraint.MaxItems<4> & constraint.UniqueItems;
                scores: number[] & constraint.Contains<number & constraint.Minimum<100>> & constraint.MinContains<2> & constraint.MaxContains<3>;
                meta: Record<string, number> & constraint.MinProperties<1> & constraint.MaxProperties<3> & constraint.PropertyNames<\`k_\${string}\`>;
                checksum: string & constraint.Custom<typeof hasValidChecksum>;
                needsToken?: boolean & constraint.Requires<'token'>;
                token?: string & constraint.MinLength<6>;
            }

            export interface InterfaceWithConstraint extends constraint.MinProperties<2> {
                a: string;
                b?: number;
                c?: boolean;
            }

            // 3. Exotic, Binary & Collection Types
            export interface ExoticPayload {
                createdAt: Date;
                endpoint: URL;
                bytes: Uint8Array;
                uniqueIds: Set<string & constraint.MinLength<2>>;
                readonlyNums: ReadonlySet<number & constraint.Minimum<1>>;
                lookup: Map<string & constraint.MinLength<2>, number & constraint.Minimum<0>>;
                readonlyLookup: ReadonlyMap<string, boolean>;
            }

            export interface BinaryViewsPayload {
                clamped: Uint8ClampedArray;
                int16: Int16Array;
                float64: Float64Array;
                big64: BigInt64Array;
                rawBuf: ArrayBuffer;
                view: DataView;
                matcher: RegExp;
            }

            export interface NominalHolder {
                token: DomainToken;
                callback: ( x: number ) => string;
                pending: Promise<number>;
                sym: symbol;
            }

            // 4. Variadic Tuples, Intersections & Modifiers
            export type VariadicTuple = [
                string & constraint.MinLength<2>,
                ( number & constraint.Minimum<0> )?,
                ...boolean[]
            ];

            export type MergedAccount =
                & { id: string; role: 'member' | 'owner' }
                & { active: boolean; score?: number & constraint.Minimum<0> };

            // 5. Discriminated & Specificity Unions
            export type PaymentMethod =
                | { kind: 'card'; cardNumber: string & constraint.Length<16, 16>; cvv: number & constraint.Range<100, 999> }
                | { kind: 'bank'; iban: string & constraint.MinLength<10>; bic: string }
                | { kind: 'crypto'; wallet: \`0x\${string}\` & constraint.MinLength<6>; chainId: number };

            export type CompetingShapes =
                | { a: string; b: number; c: boolean }
                | { a: string; b: number }
                | Record<string, number>
                | { a: string };

            // 6. Recursive & Mutually Recursive Types
            export interface TreeNode {
                id: string & constraint.MinLength<1>;
                value: number & constraint.Minimum<0>;
                children: TreeNode[];
            }

            export interface CategoryNode {
                name: string & constraint.MinLength<2>;
                items: ItemNode[];
            }

            export interface ItemNode {
                sku: string & constraint.Pattern<'^[A-Z]+-[0-9]+$'>;
                parent?: CategoryNode;
            }

            // 7. Defaults, Transforms & Tags
            export interface TransformedInput {
                username: string & transform.Trim & transform.LowerCase & constraint.MinLength<3>;
                country?: string & transform.Trim & transform.UpperCase & tag.Default<'US'>;
                age?: number & transform.ToNumber & constraint.Range<18, 120> & tag.Default<21>;
                newsletter?: boolean & transform.ToBoolean & tag.Default<false>;
                joined: Date & transform.ToDate;
                note?: string & transform.Custom<typeof appendBang> & tag<'sanitized'> & tag.Default<'hello'>;
            }

            // Exported AOT functions
            export const validatePrimitives = ( v: unknown, opts?: any ) => validate<PrimitiveMatrix>( v, opts );
            export const isPrimitives = ( v: unknown ) => is<PrimitiveMatrix>( v );
            export const parsePrimitives = ( s: string ) => parse<PrimitiveMatrix>( s );
            export const safeParsePrimitives = ( s: string ) => safeParse<PrimitiveMatrix>( s );
            export const stringifyPrimitives = ( v: PrimitiveMatrix ) => stringify<PrimitiveMatrix>( v );
            export const safeSerializePrimitives = ( v: PrimitiveMatrix ) => safeSerialize<PrimitiveMatrix>( v );

            export const validateConstrained = ( v: unknown, opts?: any ) => validate<ConstrainedObject>( v, opts );
            export const parseConstrained = ( s: string ) => parse<ConstrainedObject>( s );
            export const safeParseConstrained = ( s: string ) => safeParse<ConstrainedObject>( s );
            export const safeParseConstrainedStrip = ( s: string ) => safeParse<ConstrainedObject>( s, { mode: 'strip' } );
            export const stringifyConstrained = ( v: ConstrainedObject ) => stringify<ConstrainedObject>( v );
            export const schemaConstrained = jsonSchema<ConstrainedObject>();

            export const validateInterfaceConstraint = ( v: unknown ) => validate<InterfaceWithConstraint>( v );
            export const parseInterfaceConstraint = ( s: string ) => safeParse<InterfaceWithConstraint>( s );

            export const validateExotic = ( v: unknown, opts?: any ) => validate<ExoticPayload>( v, opts );
            export const parseExotic = ( s: string ) => parse<ExoticPayload>( s );
            export const safeParseExotic = ( s: string ) => safeParse<ExoticPayload>( s );
            export const stringifyExotic = ( v: ExoticPayload ) => stringify<ExoticPayload>( v );
            export const safeSerializeExotic = ( v: ExoticPayload ) => safeSerialize<ExoticPayload>( v );
            export const schemaExotic = jsonSchema<ExoticPayload>();

            export const validateBinaryViews = ( v: unknown, opts?: any ) => validate<BinaryViewsPayload>( v, opts );
            export const safeSerializeBinaryViews = ( v: BinaryViewsPayload ) => safeSerialize<BinaryViewsPayload>( v );

            export const validateNominal = ( v: unknown ) => validate<NominalHolder>( v );

            export const validateTuple = ( v: unknown ) => validate<VariadicTuple>( v );
            export const parseTuple = ( s: string ) => safeParse<VariadicTuple>( s );
            export const stringifyTuple = ( v: VariadicTuple ) => safeSerialize<VariadicTuple>( v );
            export const schemaTuple = jsonSchema<VariadicTuple>();

            export const validateMerged = ( v: unknown, opts?: any ) => validate<MergedAccount>( v, opts );
            export const assertMerged = ( v: unknown, opts?: any ) => assert<MergedAccount>( v, opts );
            export const assertGuardMerged = ( v: unknown, opts?: any ) => assertGuard<MergedAccount>( v, opts );
            export const parseMergedStrict = ( s: string ) => safeParse<MergedAccount>( s, { mode: 'strict' } );
            export const parseMergedStrip = ( s: string ) => safeParse<MergedAccount>( s, { mode: 'strip' } );
            export const parseMergedRelaxed = ( s: string ) => safeParse<MergedAccount>( s, { mode: 'relaxed' } );
            export const parseMergedQuery = ( s: string ) => safeParse<MergedAccount>( s, { from: 'query' } );
            export const parseMergedReviver = ( s: string, reviver: any ) => safeParse<MergedAccount>( s, { reviver } );
            export const stringifyMerged = ( v: MergedAccount ) => safeSerialize<MergedAccount>( v );
            export const stringifyMergedQuery = ( v: MergedAccount ) => safeSerialize<MergedAccount>( v, { to: 'query' } );
            export const stringifyMergedReplacer = ( v: MergedAccount, replacer: any ) => safeSerialize<MergedAccount>( v, { replacer } );

            export const isScalarNum = ( v: unknown, opts?: any ) => is<number & constraint.Minimum<10>>( v, opts );
            export const assertScalarNum = ( v: unknown, opts?: any ) => assert<number & constraint.Minimum<10>>( v, opts );
            export const assertGuardScalarNum = ( v: unknown, opts?: any ) => assertGuard<number & constraint.Minimum<10>>( v, opts );
            export const parseScalarString = ( s: string ) => safeParse<number & constraint.Minimum<10>>( s, { from: 'string' } );

            export interface NullableRecord {
                id: string & constraint.MinLength<2>;
                nickname: string | null;
                pair: [string, number];
            }
            export const schemaDraft07 = jsonSchema<NullableRecord>( 'draft-07' );
            export const schema2020 = jsonSchema<NullableRecord>( 'draft-2020-12' );
            export const schemaOpenApi30 = jsonSchema<NullableRecord>( 'openapi-3.0' );
            export const schemaOpenApi31 = jsonSchema<NullableRecord>( 'openapi-3.1' );

            export const validatePayment = ( v: unknown, opts?: any ) => validate<PaymentMethod>( v, opts );
            export const parsePayment = ( s: string ) => safeParse<PaymentMethod>( s );
            export const stringifyPayment = ( v: PaymentMethod ) => safeSerialize<PaymentMethod>( v );
            export const stdPayment = standardSchema<PaymentMethod>();

            export const validateCompeting = ( v: unknown, opts?: any ) => validate<CompetingShapes>( v, opts );
            export const parseCompetingStrip = ( s: string ) => safeParse<CompetingShapes>( s, { mode: 'strip' } );
            export const stringifyCompetingStrip = ( v: CompetingShapes ) => safeSerialize<CompetingShapes>( v, { mode: 'strip' } );

            export const validateTree = ( v: unknown, opts?: any ) => validate<TreeNode>( v, opts );
            export const parseTree = ( s: string ) => safeParse<TreeNode>( s );
            export const stringifyTree = ( v: TreeNode ) => safeSerialize<TreeNode>( v );
            export const schemaTree = jsonSchema<TreeNode>();

            export const validateCategory = ( v: unknown ) => validate<CategoryNode>( v );
            export const parseCategory = ( s: string ) => safeParse<CategoryNode>( s );
            export const stringifyCategory = ( v: CategoryNode ) => safeSerialize<CategoryNode>( v );

            export const validateTransformed = ( v: unknown, opts?: any ) => validate<TransformedInput>( v, opts );
            export const parseTransformedJson = ( s: string, opts?: any ) => safeParse<TransformedInput>( s, opts );
            export const parseTransformedQuery = ( s: string, opts?: any ) => safeParse<TransformedInput>( s, { from: 'query', ...opts } );
            export const stringifyTransformed = ( v: ResolveDefaults<TransformedInput> ) => safeSerialize<ResolveDefaults<TransformedInput>>( v );

            export const reusablePaymentValidator = validator<PaymentMethod>({ mode: 'strip' });
            export const reusableTreeParser = parser<TreeNode>({ mode: 'strip' });
            export const reusableTreeSerializer = serializer<TreeNode>({ mode: 'strip' });

            // 15. WithModifiers, Tag<T, C, V, Msg>, format.* Shorthands, & Custom Error Messages
            export interface RawCustomer {
                id: string;
                profile: {
                    email: string;
                    age: number;
                };
            }
            export type DecoratedCustomer = WithModifiers<RawCustomer, {
                'id': format.UUID & constraint.Message<'Invalid customer UUID'>;
                'profile.email': format.Email & transform.LowerCase & transform.Trim;
                'profile.age': Tag<number, 'minimum', 18, 'Customer must be 18+'>;
            }>;

            export const validateDecoratedCustomer = ( v: unknown ) => validate<DecoratedCustomer>( v );
            export const parseDecoratedCustomer = ( s: string ) => safeParse<DecoratedCustomer>( s );
            export const stringifyDecoratedCustomer = ( v: DecoratedCustomer ) => safeSerialize<DecoratedCustomer>( v );
            export const schemaDecoratedCustomer = jsonSchema<DecoratedCustomer>();

            // 16. TypeScript Utility Types, Generics, keyof, Indexed Access, & Branded Primitives
            export type BrandedSku = string & { readonly __brand: unique symbol } & constraint.Pattern<'^SKU-[0-9]{4}$'>;
            export interface BaseProduct {
                sku: BrandedSku;
                title: string & constraint.MinLength<2>;
                price: number & constraint.Minimum<0>;
                internalNotes?: string;
            }
            export type PublicProduct = Omit<BaseProduct, 'internalNotes'> & Required<Pick<BaseProduct, 'sku' | 'title'>>;
            export type ProductPatch = Partial<Readonly<Pick<BaseProduct, 'title' | 'price'>>>;
            export type ProductFieldKey = keyof PublicProduct;
            export type ProductSkuType = BaseProduct['sku'];
            export interface Paginated<T> {
                items: T[] & constraint.MinItems<1>;
                total: number & constraint.Minimum<1>;
                meta: Record<'region' | 'currency', string & constraint.MinLength<2>>;
                sortBy: ProductFieldKey;
            }

            export const validatePaginatedProducts = ( v: unknown ) => validate<Paginated<PublicProduct>>( v );
            export const parsePaginatedProducts = ( s: string ) => safeParse<Paginated<PublicProduct>>( s );
            export const stringifyPaginatedProducts = ( v: Paginated<PublicProduct> ) => safeSerialize<Paginated<PublicProduct>>( v );
            export const schemaPaginatedProducts = jsonSchema<Paginated<PublicProduct>>();
            export const validateProductPatch = ( v: unknown ) => validate<ProductPatch>( v );
            export const validateProductSku = ( v: unknown ) => validate<ProductSkuType>( v );

            // 17. unionResolution: 'declaration-order' vs 'specificity'
            export const validateCompetingDeclOrder = validator<CompetingShapes>({ mode: 'strip', unionResolution: 'declaration-order' });
            export const parseCompetingDeclOrder = ( s: string ) => safeParse<CompetingShapes>( s, { mode: 'strip', unionResolution: 'declaration-order' } );
            export const stringifyCompetingDeclOrder = ( v: CompetingShapes ) => safeSerialize<CompetingShapes>( v, { mode: 'strip', unionResolution: 'declaration-order' } );
        `;

        aot = await emitAndImport( code, '__temp_comprehensive_positive_negative__.ts' );
        cjsAot = emitAndRequire( code, '__temp_comprehensive_positive_negative_cjs__.ts' );
    }, 30000 );

    beforeEach(() =>
    {
        vi.clearAllMocks();
    });

    afterEach(() =>
    {
        vi.restoreAllMocks();
    });

    describe( '1. Primitives, Literals, Native Enums & Template Literals', () =>
    {
        function makeValidPrimitives()
        {
            return {
                str        : 'hello',
                num        : -123.45,
                bool       : false,
                big        : 9007199254740993n,
                nul        : null,
                undef      : undefined,
                litStr     : 'fixed' as const,
                litNum     : 42 as const,
                litBool    : true as const,
                litBig     : 99n as const,
                role       : 'ADMIN',
                priority   : 2,
                finiteTpl  : 'post_items' as const,
                patternTpl : 'usr_105_alice' as const
            };
        }

        it( 'accepts valid primitives, literals, enums, and template literals across validate and is', () =>
        {
            // Arrange
            const valid = makeValidPrimitives();

            // Act
            const res = aot.validatePrimitives( valid );
            const guardRes = aot.isPrimitives( valid );

            // Assert
            expect( res.success ).toBe( true );
            expect( res.data ).toEqual( valid );
            expect( guardRes ).toBe( true );
        });

        it( 'accepts Infinity and -Infinity for number but rejects NaN', () =>
        {
            // Arrange
            const posInf = { ...makeValidPrimitives(), num : Infinity };
            const negInf = { ...makeValidPrimitives(), num : -Infinity };
            const nanVal = { ...makeValidPrimitives(), num : NaN };

            // Act & Assert
            expect( aot.validatePrimitives( posInf ).success ).toBe( true );
            expect( aot.validatePrimitives( negInf ).success ).toBe( true );
            expect( aot.validatePrimitives( nanVal ).success ).toBe( false );
            expect( aot.validatePrimitives( nanVal ).errors[0].path ).toBe( 'num' );
        });

        it( 'rejects every single mistyped primitive, literal, enum, and template literal with exact error paths', () =>
        {
            // Arrange
            const base = makeValidPrimitives();
            const negativeCases: [ string, Record<string, unknown>, string ][] =
            [
                [ 'str as number', { ...base, str : 123 }, 'str' ],
                [ 'num as numeric string (strict no-coercion)', { ...base, num : '-123.45' }, 'num' ],
                [ 'bool as string "false"', { ...base, bool : 'false' }, 'bool' ],
                [ 'big as standard number', { ...base, big : 99 }, 'big' ],
                [ 'nul as undefined', { ...base, nul : undefined }, 'nul' ],
                [ 'undef as null', { ...base, undef : null }, 'undef' ],
                [ 'litStr wrong literal', { ...base, litStr : 'other' }, 'litStr' ],
                [ 'litNum wrong number', { ...base, litNum : 43 }, 'litNum' ],
                [ 'litBool false instead of true', { ...base, litBool : false }, 'litBool' ],
                [ 'litBig wrong bigint', { ...base, litBig : 100n }, 'litBig' ],
                [ 'role invalid enum string', { ...base, role : 'SUPERADMIN' }, 'role' ],
                [ 'priority invalid enum number', { ...base, priority : 99 }, 'priority' ],
                [ 'finiteTpl invalid combination', { ...base, finiteTpl : 'delete_users' }, 'finiteTpl' ],
                [ 'patternTpl non-numeric middle segment', { ...base, patternTpl : 'usr_abc_alice' }, 'patternTpl' ]
            ];

            for( const [ label, invalidInput, expectedPath ] of negativeCases )
            {
                // Act
                const res = aot.validatePrimitives( invalidInput );

                // Assert
                expect( res.success, `Expected failure for ${label}` ).toBe( false );
                expect( res.errors[0].path, `Path mismatch for ${label}` ).toBe( expectedPath );
                expect( aot.isPrimitives( invalidInput ), `is<T> should fail for ${label}` ).toBe( false );
            }
        });
    });

    describe( '2. Numeric, String, Array, & Object Constraints (Positive & Negative Matrix)', () =>
    {
        function makeValidConstrained()
        {
            return {
                intRange    : 14,
                exclNum     : 5,
                code        : 'AUTH1',
                exactLen    : 'abcde',
                affix       : 'pre_mid_suf',
                email       : 'dev@example.com',
                uuid        : '550e8400-e29b-41d4-a716-446655440000',
                ipv4        : '192.168.1.254',
                dateStr     : '2024-02-29',
                dateTimeStr : '2024-02-29T12:30:00Z',
                tags        : [ 'ts', 'aot', 'fast' ],
                scores      : [ 50, 100, 250 ],
                meta        : { k_one : 1, k_two : 2 },
                checksum    : 'chk_999',
                needsToken  : true,
                token       : 'secret_jwt_token'
            };
        }

        it( 'accepts valid constrained payloads across validate, parse, stringify, and jsonSchema', () =>
        {
            // Arrange
            const valid = makeValidConstrained();

            // Act
            const valRes = aot.validateConstrained( valid );
            const json = aot.stringifyConstrained( valid );
            const parseRes = aot.safeParseConstrained( json );
            const schemaRes = validateSchema( aot.schemaConstrained, valid );

            // Assert
            expect( valRes.success ).toBe( true );
            expect( parseRes.success ).toBe( true );
            expect( parseRes.data ).toEqual( valid );
            expect( schemaRes.success ).toBe( true );
        });

        it( 'accepts omitted Requires trigger when needsToken is absent even without token', () =>
        {
            // Arrange
            const validWithoutToken: Record<string, unknown> = { ...makeValidConstrained() };
            delete validWithoutToken.needsToken;
            delete validWithoutToken.token;

            // Act
            const valRes = aot.validateConstrained( validWithoutToken, 'strip' );
            const parseRes = aot.safeParseConstrainedStrip( JSON.stringify( validWithoutToken ));

            // Assert
            expect( valRes.success ).toBe( true );
            expect( parseRes.success ).toBe( true );
        });

        it( 'rejects every single constraint violation across validate, safeParse, and validateSchema', () =>
        {
            // Arrange
            const base = makeValidConstrained();
            const negativeCases: [ string, Record<string, unknown>, string, RegExp ][] =
            [
                [ 'intRange below Minimum<10>', { ...base, intRange : 8 }, 'intRange', /Minimum<10>/ ],
                [ 'intRange above Maximum<20>', { ...base, intRange : 22 }, 'intRange', /Maximum<20>/ ],
                [ 'intRange violating MultipleOf<2>', { ...base, intRange : 15 }, 'intRange', /MultipleOf<2>/ ],
                [ 'exclNum at ExclusiveMinimum<0> bound', { ...base, exclNum : 0 }, 'exclNum', /ExclusiveMinimum<0>/ ],
                [ 'exclNum at ExclusiveMaximum<10> bound', { ...base, exclNum : 10 }, 'exclNum', /ExclusiveMaximum<10>/ ],
                [ 'code shorter than MinLength<4>', { ...base, code : 'AB1' }, 'code', /MinLength<4>/ ],
                [ 'code longer than MaxLength<8>', { ...base, code : 'ABCDEFGHI' }, 'code', /MaxLength<8>/ ],
                [ 'code failing Pattern', { ...base, code : 'auth_1' }, 'code', /Pattern/ ],
                [ 'exactLen length 4 instead of 5', { ...base, exactLen : 'abcd' }, 'exactLen', /MinLength<5>/ ],
                [ 'exactLen length 6 instead of 5', { ...base, exactLen : 'abcdef' }, 'exactLen', /MaxLength<5>/ ],
                [ 'affix missing pre_ or _suf', { ...base, affix : 'bad_mid_suf' }, 'affix', /pre_.*_suf|Pattern/ ],
                [ 'email malformed', { ...base, email : 'not-an-email' }, 'email', /Format<email>/ ],
                [ 'uuid malformed', { ...base, uuid : '1234-5678' }, 'uuid', /Format<uuid>/ ],
                [ 'ipv4 octet > 255', { ...base, ipv4 : '192.168.1.256' }, 'ipv4', /Format<ipv4>/ ],
                [ 'dateStr non-leap Feb 29', { ...base, dateStr : '2023-02-29' }, 'dateStr', /Format<date>/ ],
                [ 'dateTimeStr invalid hour 25', { ...base, dateTimeStr : '2024-02-29T25:00:00Z' }, 'dateTimeStr', /Format<date-time>/ ],
                [ 'tags fewer than MinItems<2>', { ...base, tags : [ 'ts' ] }, 'tags', /MinItems<2>/ ],
                [ 'tags more than MaxItems<4>', { ...base, tags : [ 'a1', 'b2', 'c3', 'd4', 'e5' ] }, 'tags', /MaxItems<4>/ ],
                [ 'tags duplicate items violating UniqueItems', { ...base, tags : [ 'ts', 'aot', 'ts' ] }, 'tags', /UniqueItems/ ],
                [ 'tags element shorter than MinLength<2>', { ...base, tags : [ 'ts', 'x' ] }, 'tags[1]', /MinLength<2>/ ],
                [ 'scores fewer than MinContains<2> matches >= 100', { ...base, scores : [ 50, 120, 80 ] }, 'scores', /Contains/ ],
                [ 'scores more than MaxContains<3> matches >= 100', { ...base, scores : [ 100, 200, 300, 400 ] }, 'scores', /Contains/ ],
                [ 'meta empty violating MinProperties<1>', { ...base, meta : {} }, 'meta', /MinProperties<1>/ ],
                [ 'meta 4 keys violating MaxProperties<3>', { ...base, meta : { k_1 : 1, k_2 : 2, k_3 : 3, k_4 : 4 } }, 'meta', /MaxProperties<3>/ ],
                [ 'meta key violating PropertyNames<k_${string}>', { ...base, meta : { bad_key : 1 } }, 'meta.bad_key', /PropertyNames|k_/ ],
                [ 'checksum failing Custom validator', { ...base, checksum : 'bad_123' }, 'checksum', /Custom<hasValidChecksum>/ ],
                [ 'Requires missing token when needsToken is present', (() => 
                {
                    const c: any = { ...base }; delete c.token;

                    return c; 
                })(), 'needsToken', /Requires/ ]
            ];

            for( const [ label, invalidPayload, expectedPath, expectedErrPattern ] of negativeCases )
            {
                // Act
                const valRes = aot.validateConstrained( invalidPayload, 'strip' );
                const parseRes = aot.safeParseConstrainedStrip( JSON.stringify( invalidPayload ));

                // Assert
                expect( valRes.success, `validate should fail for: ${label}` ).toBe( false );
                expect( valRes.errors[0].path, `validate path for: ${label}` ).toBe( expectedPath );
                expect( valRes.errors[0].error, `validate code for: ${label}` ).toMatch( expectedErrPattern );

                expect( parseRes.success, `safeParse should fail for: ${label}` ).toBe( false );

                if( !parseRes.success )
                {
                    expect( parseRes.error.path, `parse path for: ${label}` ).toBe( expectedPath );
                    expect( parseRes.error.message, `parse message for: ${label}` ).toMatch( expectedErrPattern );
                }
            }
        });

        it( 'enforces interface-level extends constraint.MinProperties<2> in both positive and negative cases', () =>
        {
            // Positive: 2 properties present
            expect( aot.validateInterfaceConstraint({ a : 'ok', b : 1 }).success ).toBe( true );
            expect( aot.parseInterfaceConstraint( '{"a":"ok","c":true}' ).success ).toBe( true );

            // Negative: only 1 property present
            const badVal = aot.validateInterfaceConstraint({ a : 'only_one' });
            expect( badVal.success ).toBe( false );
            expect( badVal.errors[0].error ).toBe( 'MinProperties<2>' );

            const badParse = aot.parseInterfaceConstraint( '{"a":"only_one"}' );
            expect( badParse.success ).toBe( false );
            expect( badParse.error.message ).toMatch( /MinProperties<2>/ );
        });
    });

    describe( '3. Exotic, Binary, Collection, & Nominal Class Types (Positive & Negative)', () =>
    {
        function makeValidExotic()
        {
            return {
                createdAt      : new Date( '2025-01-15T10:20:30.000Z' ),
                endpoint       : new URL( 'https://api.example.com/v1/users?active=true' ),
                bytes          : new Uint8Array([ 10, 20, 30 ]),
                uniqueIds      : new Set([ 'id_1', 'id_2' ]),
                readonlyNums   : new Set([ 1, 2, 3 ]),
                lookup         : new Map([[ 'alpha', 10 ], [ 'beta', 20 ]]),
                readonlyLookup : new Map([[ 'enabled', true ]])
            };
        }

        function makeValidBinaryViews()
        {
            const rawBuf = new Uint8Array([ 1, 2, 3, 4 ]).buffer;

            return {
                clamped : new Uint8ClampedArray([ 0, 128, 255 ]),
                int16   : new Int16Array([ -100, 0, 100 ]),
                float64 : new Float64Array([ 1.5, -2.25 ]),
                big64   : new BigInt64Array([ -10n, 20n ]),
                rawBuf,
                view    : new DataView( rawBuf ),
                matcher : /^[a-z0-9_-]+$/
            };
        }

        it( 'validates, serializes, and parses exotic & binary types round-trip', () =>
        {
            // Arrange
            const valid = makeValidExotic();
            const validViews = makeValidBinaryViews();

            // Act
            const valRes = aot.validateExotic( valid );
            const serRes = aot.safeSerializeExotic( valid );
            const viewsValRes = aot.validateBinaryViews( validViews );
            const viewsSerRes = aot.safeSerializeBinaryViews( validViews );

            // Assert
            expect( valRes.success ).toBe( true );
            expect( serRes.success ).toBe( true );
            expect( viewsValRes.success ).toBe( true );
            expect( viewsSerRes.success ).toBe( true );

            const parsed = aot.safeParseExotic( serRes.data );
            expect( parsed.success ).toBe( true );
            expect( parsed.data.createdAt ).toEqual( valid.createdAt );
            expect( parsed.data.endpoint ).toBeInstanceOf( URL );
            expect( parsed.data.endpoint.href ).toBe( valid.endpoint.href );
            expect( Array.from( parsed.data.bytes )).toEqual([ 10, 20, 30 ]);
            expect( parsed.data.uniqueIds ).toEqual( valid.uniqueIds );
            expect( parsed.data.lookup ).toEqual( valid.lookup );
        });

        it( 'rejects invalid exotic, binary, and collection inputs in validate, parse, and safeSerialize', () =>
        {
            // Arrange
            const base = makeValidExotic();
            const baseViews = makeValidBinaryViews();

            // Negative validate cases
            expect( aot.validateExotic({ ...base, createdAt : new Date( 'invalid' ) }).success ).toBe( false );
            expect( aot.validateExotic({ ...base, endpoint : 'https://example.com' }).success ).toBe( false );
            expect( aot.validateExotic({ ...base, endpoint : 'not a valid url' }, { from : 'json' }).success ).toBe( false );
            expect( aot.validateBinaryViews({ ...baseViews, matcher : 'plain_no_slashes' }, { from : 'json' }).success ).toBe( false );
            expect( aot.validateBinaryViews({ ...baseViews, int16 : new Uint8Array([ 1, 2 ]) }).success ).toBe( false );
            expect( aot.validateExotic({ ...base, uniqueIds : new Set([ 'a' ]) }).errors[0].path ).toBe( 'uniqueIds[0]' );
            expect( aot.validateExotic({ ...base, lookup : new Map([[ 'x', 10 ]]) }).errors[0].path ).toBe( 'lookup.key(x)' );
            expect( aot.validateExotic({ ...base, lookup : new Map([[ 'validKey', -5 ]]) }).errors[0].path ).toBe( 'lookup[validKey]' );

            // Negative serialize cases
            expect( aot.safeSerializeExotic({ ...base, createdAt : new Date( 'invalid' ) as any }).success ).toBe( false );
            expect( aot.safeSerializeExotic({ ...base, endpoint : ':::bad-url' as any }).success ).toBe( false );
            expect( aot.safeSerializeBinaryViews({ ...baseViews, matcher : 'not-a-regex' as any }).success ).toBe( false );

            // Negative parse cases
            const validJsonObj = JSON.parse( aot.stringifyExotic( base ));
            expect( aot.safeParseExotic( JSON.stringify({ ...validJsonObj, endpoint : ':::invalid-url' })).success ).toBe( false );
            expect( aot.safeParseExotic( JSON.stringify({ ...validJsonObj, createdAt : 'not-a-valid-date' })).success ).toBe( false );
            expect( aot.safeParseExotic( JSON.stringify({ ...validJsonObj, bytes : 12345 })).success ).toBe( false );
        });

        it( 'enforces nominal class instanceof, Function, Promise, and symbol checks', () =>
        {
            // Positive
            const validNominal = {
                token    : new aot.DomainToken( 'tok_123' ),
                callback : ( x: number ) => String( x ),
                pending  : Promise.resolve( 42 ),
                sym      : Symbol( 'id' )
            };
            expect( aot.validateNominal( validNominal ).success ).toBe( true );

            // Negative: structural clone of DomainToken (plain object, not instanceof DomainToken)
            const structuralFake = {
                ...validNominal,
                token : { raw : 'tok_123' }
            };
            const fakeRes = aot.validateNominal( structuralFake );
            expect( fakeRes.success ).toBe( false );
            expect( fakeRes.errors[0].path ).toBe( 'token' );
            expect( fakeRes.errors[0].error ).toBe( 'Type<DomainToken>' );

            // Negative: non-function, non-Promise, non-symbol
            expect( aot.validateNominal({ ...validNominal, callback : 'not-fn' }).errors[0].path ).toBe( 'callback' );
            expect( aot.validateNominal({ ...validNominal, pending : { then : true } }).errors[0].path ).toBe( 'pending' );
            expect( aot.validateNominal({ ...validNominal, sym : 'not-symbol' }).errors[0].path ).toBe( 'sym' );
        });
    });

    describe( '4. Variadic Tuples, Intersections, & Unknown-Property Modes (strict / strip / relaxed)', () =>
    {
        it( 'validates, parses, and serializes variadic & optional tuples [string, number?, ...boolean[]]', () =>
        {
            // Positive cases: 1 element (optional omitted), 2 elements, 4 elements (with rest booleans)
            for( const validTuple of [ [ 'ab' ], [ 'ab', 0 ], [ 'ab', 42, true, false, true ] ])
            {
                expect( aot.validateTuple( validTuple ).success ).toBe( true );
                expect( validateSchema( aot.schemaTuple, validTuple ).success ).toBe( true );

                const ser = aot.stringifyTuple( validTuple );
                expect( ser.success ).toBe( true );

                const parsed = aot.parseTuple( ser.data );
                expect( parsed.success ).toBe( true );
                expect( parsed.data ).toEqual( validTuple );
            }

            // Negative cases: empty tuple, short first string, negative optional number, non-boolean rest element
            const negativeTuples: [ unknown, string ][] =
            [
                [ [], '' ],
                [ [ 'a' ], '[0]' ],
                [ [ 'ab', -1 ], '[1]' ],
                [ [ 'ab', 10, true, 'not-bool' ], '[3]' ]
            ];

            for( const [ badTuple, expectedPath ] of negativeTuples )
            {
                const valRes = aot.validateTuple( badTuple );
                expect( valRes.success ).toBe( false );
                expect( valRes.errors[0].path ).toBe( expectedPath );

                const parseRes = aot.parseTuple( JSON.stringify( badTuple ));
                expect( parseRes.success ).toBe( false );
            }
        });

        it( 'enforces strict, strip, and relaxed unknown-key modes on merged object intersections without mutating input when mutate: false', () =>
        {
            // Arrange
            const inputWithExtra = { id : 'u1', role : 'owner', active : true, score : 10, rogue : 'drop_me' };

            // Act & Assert: strict mode rejects extra property
            const strictRes = aot.validateMerged( inputWithExtra, 'strict' );
            expect( strictRes.success ).toBe( false );
            expect( strictRes.errors[0].error ).toBe( 'PropertyNotAllowed<rogue>' );
            expect( aot.parseMergedStrict( JSON.stringify( inputWithExtra )).success ).toBe( false );

            // Act & Assert: strip mode drops extra property without mutating original input
            const stripRes = aot.validateMerged( inputWithExtra, 'strip' );
            expect( stripRes.success ).toBe( true );
            expect( stripRes.data ).toEqual({ id : 'u1', role : 'owner', active : true, score : 10 });
            expect( inputWithExtra.rogue ).toBe( 'drop_me' );

            const stripParse = aot.parseMergedStrip( JSON.stringify( inputWithExtra ));
            expect( stripParse.success ).toBe( true );
            expect( stripParse.data ).toEqual({ id : 'u1', role : 'owner', active : true, score : 10 });

            // Act & Assert: relaxed mode preserves extra property
            const relaxedRes = aot.validateMerged( inputWithExtra, 'relaxed' );
            expect( relaxedRes.success ).toBe( true );
            expect( relaxedRes.data ).toEqual( inputWithExtra );
            expect( aot.parseMergedRelaxed( JSON.stringify( inputWithExtra )).data ).toEqual( inputWithExtra );
        });
    });

    describe( '5. Discriminated Unions, Specificity Ordering, & Lossless Best-Fit Strip Probing', () =>
    {
        it( 'dispatches discriminated unions on literal tag and reports targeted arm errors on failure', () =>
        {
            // Positive arms
            const card = { kind : 'card', cardNumber : '1234567812345678', cvv : 123 };
            const bank = { kind : 'bank', iban : 'DE89370400440532013000', bic : 'COBADEFFXXX' };
            const crypto = { kind : 'crypto', wallet : '0xabc123', chainId : 1 };

            for( const validArm of [ card, bank, crypto ])
            {
                expect( aot.validatePayment( validArm ).success ).toBe( true );
                const ser = aot.stringifyPayment( validArm );
                expect( ser.success ).toBe( true );
                expect( aot.parsePayment( ser.data ).data ).toEqual( validArm );
            }

            // Negative: known tag 'card', invalid field cvv = 99 (reports 'cvv' directly!)
            const badCard = { kind : 'card', cardNumber : '1234567812345678', cvv : 99 };
            const badCardRes = aot.validatePayment( badCard );
            expect( badCardRes.success ).toBe( false );
            expect( badCardRes.errors[0].path ).toBe( 'cvv' );
            expect( badCardRes.errors[0].error ).toBe( 'Minimum<100>' );

            // Standard Schema v1 issues mapping
            const stdRes = aot.stdPayment['~standard'].validate( badCard );
            expect( stdRes.issues ).toBeDefined();
            expect( stdRes.issues[0].path ).toEqual([ 'cvv' ]);
        });

        it( 'selects the most specific lossless union arm in strip mode across validate, parse, and stringify', () =>
        {
            // Arrange: CompetingShapes has { a, b, c } | { a, b } | Record<string, number> | { a }
            const threeProp = { a : 'x', b : 1, c : true, extra : 'ignored' };
            const twoProp = { a : 'x', b : 1 };
            const numRecord = { x : 1, y : 2, z : 3 };

            // Act & Assert: 3-prop input in strip mode picks { a, b, c } (strips only 1 key 'extra' vs 2+ keys)
            expect( aot.validateCompeting( threeProp, 'strip' ).data ).toEqual({ a : 'x', b : 1, c : true });
            expect( aot.parseCompetingStrip( JSON.stringify( threeProp )).data ).toEqual({ a : 'x', b : 1, c : true });
            expect( JSON.parse( aot.stringifyCompetingStrip( threeProp ).data )).toEqual({ a : 'x', b : 1, c : true });

            // 2-prop input matches { a, b } with 0 stripped keys
            expect( aot.validateCompeting( twoProp, 'strip' ).data ).toEqual( twoProp );

            // Record<string, number> matches numRecord without losing keys
            expect( aot.validateCompeting( numRecord, 'strip' ).data ).toEqual( numRecord );

            // Negative: matches no arm
            expect( aot.validateCompeting({ a : 123, b : 'wrong' }, 'strip' ).success ).toBe( false );
            expect( aot.parseCompetingStrip( '{"a":123,"b":"wrong"}' ).success ).toBe( false );
        });
    });

    describe( '6. Recursive & Mutually Recursive Types Across All Engines (Positive & Negative)', () =>
    {
        it( 'validates, parses, serializes, and JSON-Schema checks deep recursive trees and rejects deep leaf errors', () =>
        {
            // Arrange: valid 3-level tree
            const validTree = {
                id       : 'root',
                value    : 10,
                children : [
                    { id : 'child_1', value : 20, children : [] },
                    {
                        id       : 'child_2',
                        value    : 30,
                        children : [
                            { id : 'grandchild_1', value : 40, children : [] }
                        ]
                    }
                ]
            };

            // Act & Assert: Positive
            expect( aot.validateTree( validTree ).success ).toBe( true );
            expect( validateSchema( aot.schemaTree, validTree ).success ).toBe( true );

            const ser = aot.stringifyTree( validTree );
            expect( ser.success ).toBe( true );

            const parsed = aot.parseTree( ser.data );
            expect( parsed.success ).toBe( true );
            expect( parsed.data ).toEqual( validTree );

            // Arrange: Negative deep leaf violation at children[1].children[0].value = -5
            const invalidTree = structuredClone( validTree );
            invalidTree.children[1].children[0].value = -5;

            // Act & Assert: Negative across all engines
            const valFail = aot.validateTree( invalidTree );
            expect( valFail.success ).toBe( false );
            expect( valFail.errors[0].path ).toBe( 'children[1].children[0].value' );
            expect( valFail.errors[0].error ).toBe( 'Minimum<0>' );

            const parseFail = aot.parseTree( JSON.stringify( invalidTree ));
            expect( parseFail.success ).toBe( false );
            expect( parseFail.error.path ).toBe( 'children[1].children[0].value' );
            expect( parseFail.error.message ).toMatch( /Minimum<0>/ );

            const schemaFail = validateSchema( aot.schemaTree, invalidTree );
            expect( schemaFail.success ).toBe( false );
            expect( schemaFail.errors[0].path ).toBe( 'children[1].children[0].value' );
        });

        it( 'validates, parses, and serializes mutually recursive CategoryNode <-> ItemNode graphs', () =>
        {
            // Arrange: positive mutually recursive structure
            const validCat = {
                name  : 'Electronics',
                items : [
                    {
                        sku    : 'TV-100',
                        parent : {
                            name  : 'HomeCinema',
                            items : [ { sku : 'SPK-200' } ]
                        }
                    }
                ]
            };

            // Act & Assert: Positive
            expect( aot.validateCategory( validCat ).success ).toBe( true );
            const ser = aot.stringifyCategory( validCat );
            expect( ser.success ).toBe( true );
            expect( aot.parseCategory( ser.data ).data ).toEqual( validCat );

            // Negative: nested item SKU fails pattern
            const badCat = structuredClone( validCat );
            badCat.items[0].parent!.items[0].sku = 'bad_sku';

            const valFail = aot.validateCategory( badCat );
            expect( valFail.success ).toBe( false );
            expect( valFail.errors[0].path ).toBe( 'items[0].parent.items[0].sku' );

            const parseFail = aot.parseCategory( JSON.stringify( badCat ));
            expect( parseFail.success ).toBe( false );
            expect( parseFail.error.path ).toBe( 'items[0].parent.items[0].sku' );
        });
    });

    describe( '7. Defaults, Transforms, Custom Tag Hooks, Casing & Query Strings (Positive & Negative)', () =>
    {
        it( 'applies defaults, built-in transforms, custom transforms, and tag hooks in both validate and parse', () =>
        {
            // Arrange
            const rawInput = {
                username : '  Alice_Dev  ',
                joined   : '2025-03-01T00:00:00.000Z'
            };

            const tagHook = ( val: unknown, ctx: { tags? : string[] }) =>
            {
                if( ctx.tags?.includes( 'sanitized' ) && typeof val === 'string' )
                {
                    return `[clean:${val}]`;
                }

                return val;
            };

            // Act
            const valRes = aot.validateTransformed( rawInput, { transform : tagHook });
            const parseRes = aot.parseTransformedJson( JSON.stringify( rawInput ), { transform : tagHook });

            // Assert
            const expected = {
                username   : 'alice_dev',
                country    : 'US',
                age        : 21,
                newsletter : false,
                joined     : new Date( '2025-03-01T00:00:00.000Z' ),
                note       : '[clean:hello!]'
            };
            expect( valRes.success ).toBe( true );
            expect( valRes.data ).toEqual( expected );
            expect( parseRes.success ).toBe( true );
            expect( parseRes.data ).toEqual( expected );
        });

        it( 'rejects post-transform constraint failures (e.g. Trim reduces length below MinLength<3>, ToNumber out of range)', () =>
        {
            // Trim turns '  ab  ' into 'ab' (length 2 < MinLength<3>)
            const shortAfterTrim = { username : '  ab  ', joined : '2025-03-01T00:00:00.000Z' };
            const valFail1 = aot.validateTransformed( shortAfterTrim );
            expect( valFail1.success ).toBe( false );
            expect( valFail1.errors[0].path ).toBe( 'username' );
            expect( valFail1.errors[0].error ).toBe( 'MinLength<3>' );

            const parseFail1 = aot.parseTransformedJson( JSON.stringify( shortAfterTrim ));
            expect( parseFail1.success ).toBe( false );
            expect( parseFail1.error.path ).toBe( 'username' );

            // ToNumber turns '15' into 15 (< Minimum<18>)
            const underage = { username : 'bob_user', age : '15', joined : '2025-03-01T00:00:00.000Z' };
            expect( aot.validateTransformed( underage ).errors[0].path ).toBe( 'age' );
            expect( aot.parseTransformedJson( JSON.stringify( underage )).error.path ).toBe( 'age' );

            // ToNumber rejects partial numeric string '25px'
            const nanAge = { username : 'bob_user', age : '25px', joined : '2025-03-01T00:00:00.000Z' };
            expect( aot.validateTransformed( nanAge ).errors[0].path ).toBe( 'age' );
            expect( aot.parseTransformedJson( JSON.stringify( nanAge )).error.path ).toBe( 'age' );
        });

        it( 'round-trips query strings and rejects leading "?" or malformed query values', () =>
        {
            // Positive query parse with defaults and coercions
            const qs = 'username=%20%20Charlie%20%20&country=de&age=30&newsletter=1&joined=2025-04-01T00%3A00%3A00.000Z';
            const parsedQs = aot.parseTransformedQuery( qs );
            expect( parsedQs.success ).toBe( true );
            expect( parsedQs.data ).toEqual({
                username   : 'charlie',
                country    : 'DE',
                age        : 30,
                newsletter : true,
                joined     : new Date( '2025-04-01T00:00:00.000Z' ),
                note       : 'hello!'
            });

            // Negative: leading '?' is rejected by parseQueryString
            const leadingQ = aot.parseTransformedQuery( '?username=charlie&joined=2025-04-01T00:00:00Z' );
            expect( leadingQ.success ).toBe( false );
            expect( leadingQ.error.message ).toMatch( /Invalid query/ );
        });

        it( 'converts property casing deeply while preserving URLs, Dates, RegExps, Maps, Sets, and TypedArrays', () =>
        {
            // Arrange
            const url = new URL( 'https://example.com/path' );
            const date = new Date( 1700000000000 );
            const bytes = new Uint8Array([ 1, 2 ]);
            const input = {
                first_name   : 'Ada',
                home_url     : url,
                created_at   : date,
                raw_bytes    : bytes,
                nested_items : [ { item_id : 1 }, { item_id : 2 } ]
            };

            // Act
            const camel = convertPropertyCasing( input, 'camelCase' );
            const snake = convertPropertyCasing( camel, 'snake_case' );

            // Assert
            expect( camel ).toEqual({
                firstName   : 'Ada',
                homeUrl     : url,
                createdAt   : date,
                rawBytes    : bytes,
                nestedItems : [ { itemId : 1 }, { itemId : 2 } ]
            });
            expect( snake ).toEqual( input );
        });
    });

    describe( '8. Reusable validator<T>(), parser<T>(), serializer<T>(), safeParse<T>(), & safeSerialize<T>()', () =>
    {
        it( 'supports callable validator, .is, .assert, .assertGuard, and ~standard on validator<T>()', () =>
        {
            // Arrange
            const v = aot.reusablePaymentValidator;
            const validWithExtra = { kind : 'crypto', wallet : '0x1234', chainId : 10, extra : 'stripped' };
            const invalid = { kind : 'crypto', wallet : 'bad_prefix', chainId : 10 };

            // Act & Assert: Positive
            expect( v( validWithExtra ).data ).toEqual({ kind : 'crypto', wallet : '0x1234', chainId : 10 });
            expect( v.is( validWithExtra )).toBe( true );
            expect( v.assert( validWithExtra )).toEqual({ kind : 'crypto', wallet : '0x1234', chainId : 10 });
            expect(() => v.assertGuard( validWithExtra )).not.toThrow();
            expect( v['~standard'].validate( validWithExtra ).value ).toEqual({ kind : 'crypto', wallet : '0x1234', chainId : 10 });

            // Act & Assert: Negative
            expect( v( invalid ).success ).toBe( false );
            expect( v.is( invalid )).toBe( false );
            expect(() => v.assert( invalid )).toThrow( /Validation Error/ );
            expect(() => v.assertGuard( invalid )).toThrow( /Validation Error/ );
            expect( v['~standard'].validate( invalid ).issues ).toBeDefined();
        });

        it( 'supports reusable parser<T>() and serializer<T>() with strip mode and error throwing on invalid data', () =>
        {
            // Arrange
            const treeWithExtra = {
                id       : 'n1',
                value    : 5,
                extra    : 'removed',
                children : [ { id : 'n2', value : 10, extra2 : true, children : [] } ]
            };

            // Act
            const json = aot.reusableTreeSerializer( treeWithExtra );
            const parsed = aot.reusableTreeParser( json );

            // Assert
            expect( parsed ).toEqual({
                id       : 'n1',
                value    : 5,
                children : [ { id : 'n2', value : 10, children : [] } ]
            });

            // Negative: parser throws ParseError, serializer throws SerializationError
            expect(() => aot.reusableTreeParser( '{"id":"","value":5,"children":[]}' )).toThrow( aot.ParseError );
            expect(() => aot.reusableTreeSerializer({ id : 'n1', value : 'not-a-number' as any, children : [] })).toThrow( aot.SerializationError );
        });
    });

    describe( '9. Runtime JSON Schema Compiler (Draft-04 / 07 / 2019-09 / 2020-12 Positive & Negative)', () =>
    {
        it( 'validates and rejects complex multi-keyword JSON Schemas including dynamic refs, conditional applicators, and contentSchema', () =>
        {
            // Arrange: A rich schema combining 2020-12 features
            const rawComplexSchema = {
                type           : 'object' as const,
                $dynamicAnchor : 'Node',
                required       : [ 'id', 'kind', 'tuple', 'encodedConfig' ],
                properties     : {
                    id    : { type : 'string' as const, minLength : 2 },
                    kind  : { enum : [ 'leaf', 'branch' ] },
                    tuple : {
                        type             : 'array' as const,
                        prefixItems      : [ { type : 'string' as const }, { type : 'number' as const, exclusiveMinimum : 0 } ],
                        unevaluatedItems : false
                    },
                    encodedConfig : {
                        type             : 'string' as const,
                        contentEncoding  : 'base64',
                        contentMediaType : 'application/json',
                        contentSchema    : {
                            type       : 'object' as const,
                            required   : [ 'enabled' ],
                            properties : { enabled : { type : 'boolean' as const } }
                        }
                    },
                    children : {
                        type  : 'array' as const,
                        items : { $dynamicRef : '#Node' }
                    }
                },
                dependentRequired : {
                    children : [ 'branchTag' ]
                },
                if                    : { properties : { kind : { const : 'branch' } }, required : [ 'kind' ] },
                then                  : { required : [ 'children' ], properties : { branchTag : { type : 'string' as const } } },
                else                  : { not : { required : [ 'children' ] } },
                unevaluatedProperties : false
            };

            const complexSchema = compileSchema( rawComplexSchema );
            const validBase64 = Buffer.from( JSON.stringify({ enabled : true })).toString( 'base64' );

            const validLeaf = {
                id            : 'leaf_1',
                kind          : 'leaf',
                tuple         : [ 'ok', 1 ],
                encodedConfig : validBase64
            };

            const validBranch = {
                id            : 'branch_1',
                kind          : 'branch',
                branchTag     : 'main',
                tuple         : [ 'root', 99 ],
                encodedConfig : validBase64,
                children      : [ validLeaf ]
            };

            // Act & Assert: Positive (both raw schema helpers and compiled validator)
            expect( is( complexSchema, validLeaf )).toBe( true );
            expect( isSchema( rawComplexSchema, validBranch )).toBe( true );
            expect( assert( complexSchema, validBranch )).toEqual( validBranch );
            expect( assertSchema( rawComplexSchema, validBranch )).toEqual( validBranch );

            // Act & Assert: Negative cases
            // 1. Branch missing required 'children' (from `then` clause)
            const branchNoChildren = { ...validLeaf, kind : 'branch' };
            expect( validate( complexSchema, branchNoChildren ).errors[0].error ).toBe( 'Required<children>' );

            // 2. Leaf having 'children' (violating `else: { not: { required: ['children'] } }`)
            const leafWithChildren = { ...validLeaf, children : [], branchTag : 't' };
            expect( validate( complexSchema, leafWithChildren ).errors[0].error ).toBe( 'Schema<not>' );

            // 3. Branch with 'children' but missing dependentRequired 'branchTag'
            const branchNoTag: Record<string, unknown> = { ...validBranch };
            delete branchNoTag.branchTag;
            expect( validate( complexSchema, branchNoTag ).errors[0].error ).toBe( 'Required<branchTag>' );

            // 4. Tuple with extra 3rd item violating `unevaluatedItems: false`
            const badTuple = { ...validLeaf, tuple : [ 'ok', 1, 'extra' ] };
            expect( validate( complexSchema, badTuple ).errors[0].error ).toMatch( /UnevaluatedItem|AdditionalItem/ );

            // 5. Extra top-level property violating `unevaluatedProperties: false`
            const badExtra = { ...validLeaf, rogueProp : 123 };
            expect( validate( complexSchema, badExtra ).errors[0].error ).toMatch( /UnevaluatedProperty|PropertyNotAllowed/ );

            // 6. encodedConfig with valid base64 & valid JSON, but failing `contentSchema` (enabled is number instead of boolean)
            const badContentSchema = {
                ...validLeaf,
                encodedConfig : Buffer.from( JSON.stringify({ enabled : 123 })).toString( 'base64' )
            };
            expect( validate( complexSchema, badContentSchema ).errors[0].error ).toMatch( /ContentSchema|Type<boolean>/ );
        });
    });

    describe( '10. Exhaustive 21-Format Validator Matrix (Positive & Negative)', () =>
    {
        function checkFormat( fmt: string, val: string ): boolean
        {
            const ctx: ValidationContext = { success : true, errors : [], mode : 'strict' };
            validators.format( val, 'f', ctx, fmt );

            return ctx.success;
        }

        const formatMatrix: [ string, string[], string[] ][] =
        [
            [
                'email',
                [ 'user@example.com', 'first.last+tag@sub.domain.co.uk' ],
                [ '', 'plainaddress', '@missing-local.com', 'user@', 'user@.com', 'a'.repeat( 65 ) + '@example.com' ]
            ],
            [
                'idn-email',
                [ 'Pelé@example.com', 'δοκιμή@παράδειγμα.δοκιμή' ],
                [ '', 'no-at-symbol', '@nowhere', 'user@bad..domain' ]
            ],
            [
                'uuid',
                [ '550e8400-e29b-41d4-a716-446655440000', '00000000-0000-0000-0000-000000000000' ],
                [ '', '550e8400e29b41d4a716446655440000', '550e8400-e29b-41d4-a716-44665544000g', 'not-a-uuid' ]
            ],
            [
                'url',
                [ 'https://example.com', 'http://localhost:8080/path?q=1#hash' ],
                [ '', 'not a url', 'http://', '://missing-scheme' ]
            ],
            [
                'uri',
                [ 'https://example.com/a/b', 'urn:isbn:0451450523', 'mailto:user@example.com' ],
                [ '', 'relative/path', 'http://ex ample.com', '123:invalid-scheme' ]
            ],
            [
                'uri-reference',
                [ 'https://example.com/path', '/relative/path?x=1', '#fragment-only', '' ],
                [ 'http://bad space.com', 'path with spaces' ]
            ],
            [
                'uri-template',
                [ 'https://api.example.com/users/{id}', '/search{?q,page}' ],
                [ '/users/{id', '/users/id}', '/users/{a{b}}' ]
            ],
            [
                'iri',
                [ 'https://example.com/über', 'https://παράδειγμα.δοκιμή/οδός' ],
                [ '', '/relative/iri', 'https://bad space.com' ]
            ],
            [
                'iri-reference',
                [ 'https://example.com/über', '/über/pfad', '' ],
                [ 'https://bad space.com' ]
            ],
            [
                'ipv4',
                [ '0.0.0.0', '127.0.0.1', '255.255.255.255' ],
                [ '', '256.0.0.1', '192.168.1', '192.168.1.1.1', '192.168.1.-1', 'abc.def.ghi.jkl' ]
            ],
            [
                'ipv6',
                [ '::1', '2001:db8::8a2e:370:7334', 'fe80::1ff:fe23:4567:890a' ],
                [ '', '2001::db8::1', 'gggg::1', '1:2:3:4:5:6:7:8:9', '127.0.0.1' ]
            ],
            [
                'hostname',
                [ 'example.com', 'sub-domain.example.co.uk', 'localhost' ],
                [ '', '-leading-hyphen.com', 'trailing-hyphen-.com', 'bad_underscore.com', 'a'.repeat( 64 ) + '.com' ]
            ],
            [
                'idn-hostname',
                [ 'example.com', 'bücher.de', 'παράδειγμα.δοκιμή' ],
                [ '', '-bad.com', 'bad-.com', 'space in host.com' ]
            ],
            [
                'date',
                [ '2024-02-29', '2025-12-31', '1970-01-01' ],
                [ '', '2023-02-29', '2024-04-31', '2024-13-01', '2024-00-10', '2024/01/01' ]
            ],
            [
                'date-time',
                [ '2024-02-29T23:59:59Z', '2025-06-15T08:30:00.123+02:00', '2025-01-01T00:00:00-05:00' ],
                [ '', '2023-02-29T10:00:00Z', '2024-01-01 10:00:00Z', '2024-01-01T24:00:00Z', '2024-01-01T10:60:00Z', '2024-01-01T10:00:00+24:00' ]
            ],
            [
                'time',
                [ '00:00:00Z', '23:59:59.999+01:00', '12:30:45-04:30' ],
                [ '', '24:00:00Z', '12:60:00Z', '12:00:61Z', '12:00:00', '12:00:00+25:00' ]
            ],
            [
                'duration',
                [ 'P1Y2M3DT4H5M6S', 'PT15M', 'P4W', 'P3D' ],
                [ '', 'P', 'PT', '1Y2M', 'P1D2Y', 'P1Y2M3DT', 'PT0.5S' ]
            ],
            [
                'byte',
                [ '', 'SGVsbG8=', 'YWJjZA==' ],
                [ 'abc', 'SGVsbG8===', 'not_base64!' ]
            ],
            [
                'regex',
                [ '^[a-z0-9]+$', '\\d{2,4}' ],
                [ '[unclosed', '(a+)+$' ]
            ],
            [
                'objectId',
                [ '507f1f77bcf86cd799439011', '000000000000000000000000' ],
                [ '', '507f1f77bcf86cd79943901', '507f1f77bcf86cd7994390111', '507f1f77bcf86cd79943901z' ]
            ],
            [
                'password',
                [ 'any-secret-password', '' ],
                []
            ]
        ];

        it( 'accepts all valid format strings and rejects all invalid format strings across all 21 formats', () =>
        {
            for( const [ fmt, positives, negatives ] of formatMatrix )
            {
                for( const pos of positives )
                {
                    expect( checkFormat( fmt, pos ), `Format "${fmt}" should accept "${pos}"` ).toBe( true );
                }

                for( const neg of negatives )
                {
                    expect( checkFormat( fmt, neg ), `Format "${fmt}" should reject "${neg}"` ).toBe( false );
                }
            }
        });
    });

    describe( '11. Security, Prototype Pollution, Cyclic Structures & Adversarial Inputs', () =>
    {
        it( 'prevents prototype pollution across parseQueryString, convertPropertyCasing, and schema validation', () =>
        {
            // Arrange
            const maliciousQs = '__proto__[polluted]=yes&constructor[prototype][polluted]=yes&safeKey=ok';

            // Act
            const parsedQs = parseQueryString( maliciousQs );
            const cased = convertPropertyCasing(
                JSON.parse( '{"__proto__":{"polluted":"yes"},"constructor":1,"prototype":2,"user_name":"ada"}' ),
                'camelCase'
            );

            // Assert
            expect(({} as any ).polluted ).toBeUndefined();
            expect( parsedQs.safeKey ).toBe( 'ok' );
            expect(( cased as any ).userName ).toBe( 'ada' );
        });

        it( 'handles cyclic object graphs safely in deepEqual and hasUniqueItems without infinite recursion', () =>
        {
            // Arrange
            const cycleA1: any = { id : 1 };
            cycleA1.self = cycleA1;

            const cycleA2: any = { id : 1 };
            cycleA2.self = cycleA2;

            const cycleB: any = { id : 2 };
            cycleB.self = cycleB;

            // Act & Assert
            expect( deepEqual( cycleA1, cycleA2 )).toBe( true );
            expect( deepEqual( cycleA1, cycleB )).toBe( false );
            expect( hasUniqueItems([ cycleA1, cycleB ])).toBe( true );
            expect( hasUniqueItems([ cycleA1, cycleA2 ])).toBe( false );
        });
    });

    describe( '12. Direct assert<T>, assertGuard<T>, from:"string", to:"query", reviver/replacer, & Multi-Target jsonSchema<T>', () =>
    {
        it( 'verifies assert<T>, assertGuard<T>, and is<T> including root-replacement guard rejection', () =>
        {
            // Positive object assert & assertGuard
            const validObj = { id : 'u1', role : 'owner', active : true, score : 5 };
            expect( aot.assertMerged( validObj )).toEqual( validObj );
            expect(() => aot.assertGuardMerged( validObj )).not.toThrow();

            // Negative object assert & assertGuard
            const invalidObj = { id : 'u1', role : 'invalid', active : true };
            expect(() => aot.assertMerged( invalidObj )).toThrow( /Validation Error/ );
            expect(() => aot.assertGuardMerged( invalidObj )).toThrow( /Validation Error/ );

            // Root-level coercion ("42" -> 42): assert<number> succeeds and returns 42,
            // while is<number> returns false and assertGuard<number> throws because a type guard cannot replace a primitive root binding!
            expect( aot.assertScalarNum( '42', { from : 'query' })).toBe( 42 );
            expect( aot.isScalarNum( 42 )).toBe( true );
            expect( aot.isScalarNum( '42', { from : 'query' })).toBe( false );
            expect(() => aot.assertGuardScalarNum( 42 )).not.toThrow();
            expect(() => aot.assertGuardScalarNum( '42', { from : 'query' })).toThrow( /Validation Error/ );

            // Negative scalar below Minimum<10>
            expect(() => aot.assertScalarNum( '5', { from : 'query' })).toThrow( /Minimum<10>/ );
        });

        it( 'verifies parse<T> with from:"string" / reviver and stringify<T> with to:"query" / replacer (Positive & Negative)', () =>
        {
            // from: 'string' positive & negative
            expect( aot.parseScalarString( '25' )).toEqual({ success : true, data : 25 });
            expect( aot.parseScalarString( '5' ).success ).toBe( false );
            expect( aot.parseScalarString( 'not_num' ).success ).toBe( false );

            // to: 'query' & from: 'query' round-trip + negative
            const validAccount = { id : 'acc_1', role : 'member' as const, active : true, score : 100 };
            const qsRes = aot.stringifyMergedQuery( validAccount );
            expect( qsRes.success ).toBe( true );
            expect( qsRes.data ).toContain( 'id=acc_1' );
            expect( aot.parseMergedQuery( qsRes.data )).toEqual({ success : true, data : validAccount });
            expect( aot.stringifyMergedQuery({ id : 'acc_1', role : 'bad' as any, active : true }).success ).toBe( false );

            // reviver & replacer positive & negative
            const revived = aot.parseMergedReviver(
                '{"id":"u1","role":"owner","active":true,"score":10}',
                ( k: string, v: unknown ) => ( k === 'score' && typeof v === 'number' ? v * 2 : v )
            );
            expect( revived.success ).toBe( true );
            expect( revived.data.score ).toBe( 20 );

            const revivedNegative = aot.parseMergedReviver(
                '{"id":"u1","role":"owner","active":true,"score":10}',
                ( k: string, v: unknown ) => ( k === 'score' ? -99 : v )
            );
            expect( revivedNegative.success ).toBe( false );

            const replaced = aot.stringifyMergedReplacer(
                validAccount,
                ( k: string, v: unknown ) => ( k === 'id' ? 'redacted' : v )
            );
            expect( replaced.success ).toBe( true );
            expect( JSON.parse( replaced.data ).id ).toBe( 'redacted' );
        });

        it( 'emits valid draft-07, 2020-12, openapi-3.0, and openapi-3.1 schemas via jsonSchema<T>() and validates positive & negative inputs', () =>
        {
            // Assert target-specific schema shapes
            expect( aot.schemaDraft07.$schema ).toBeUndefined();
            expect( Array.isArray( aot.schemaDraft07.properties.pair.items )).toBe( true );
            expect( aot.schema2020.$schema ).toContain( '2020-12' );
            expect( Array.isArray( aot.schema2020.properties.pair.prefixItems )).toBe( true );
            expect( aot.schemaOpenApi30.properties.nickname.nullable ).toBe( true );
            expect( aot.schemaOpenApi31.$schema ).toContain( 'openapis.org/oas/3.1' );
            expect( Array.isArray( aot.schemaOpenApi31.properties.pair.prefixItems )).toBe( true );

            // Validate positive & negative inputs against all 4 generated schemas
            for( const schema of [ aot.schemaDraft07, aot.schema2020, aot.schemaOpenApi30, aot.schemaOpenApi31 ])
            {
                expect( isSchema( schema, { id : 'ok', nickname : null, pair : [ 'a', 1 ] })).toBe( true );
                expect( isSchema( schema, { id : 'ok', nickname : 'Ada', pair : [ 'b', 2 ] })).toBe( true );
                expect( isSchema( schema, { id : 'x', nickname : null, pair : [ 'a', 1 ] })).toBe( false );
                expect( isSchema( schema, { id : 'ok', nickname : 123, pair : [ 'a', 1 ] })).toBe( false );
                expect( isSchema( schema, { id : 'ok', nickname : null, pair : [ 'a', 'not-num' ] })).toBe( false );
            }
        });
    });

    describe( '13. Exported Runtime Helpers, Error Formatters, Coercions, Path, & Regex Utilities (Positive & Negative)', () =>
    {
        it( 'verifies assertGuardSchema, assertGuard, getOrCompileSchema, createStandardSchema, and createValidator', () =>
        {
            const schema = {
                type       : 'object' as const,
                required   : [ 'count' ],
                properties : { count : { type : 'number' as const, minimum : 1 } }
            };
            const compiled = getOrCompileSchema<{ count : number }>( schema );

            // Positive
            expect(() => assertGuardSchema( schema, { count : 5 })).not.toThrow();
            expect(() => assertGuard( compiled, { count : 5 })).not.toThrow();

            // Negative
            expect(() => assertGuardSchema( schema, { count : 0 })).toThrow( /Validation Error/ );
            expect(() => assertGuard( compiled, { count : 0 })).toThrow( /Validation Error/ );

            // createStandardSchema & createValidator positive and negative
            const std = createStandardSchema<{ count : number }>( compiled );
            expect( std['~standard'].validate({ count : 3 })).toEqual({ value : { count : 3 } });
            const stdFail = std['~standard'].validate({ count : -1 }) as { issues? : readonly unknown[] };
            expect( stdFail.issues ).toBeDefined();

            const reusable = createValidator<{ count : number }>( compiled );
            expect( reusable.is({ count : 10 })).toBe( true );
            expect( reusable.is({ count : 0 })).toBe( false );
        });

        it( 'verifies groupErrorsByPath, toZodIssues, ZodLikeError, and toStandardSchemaIssues', () =>
        {
            const rawErrors =
            [
                { path : 'users[0].email', value : 'bad', error : 'Format<email>', message : 'Invalid email' },
                { path : 'users[0].email', value : 'bad', error : 'MinLength<5>' },
                { path : '', value : null, error : 'Type<Object>' }
            ];

            const grouped = groupErrorsByPath( rawErrors );
            expect( grouped['users[0].email']).toEqual({
                value  : 'bad',
                errors : [ 'Format<email>', 'MinLength<5>' ]
            });
            expect( grouped['']).toEqual({
                value  : null,
                errors : [ 'Type<Object>' ]
            });

            const zodIssues = toZodIssues( rawErrors );
            expect( zodIssues[0].path ).toEqual([ 'users', 0, 'email' ]);
            expect( zodIssues[0].message ).toBe( 'Format<email>' );
            expect( zodIssues[0].received ).toBe( 'bad' );

            const zodErr = new ZodLikeError( rawErrors );
            expect( zodErr.name ).toBe( 'ZodError' );
            expect( zodErr.issues.length ).toBe( 3 );

            const stdIssues = toStandardSchemaIssues( rawErrors );
            expect( stdIssues[0].path ).toEqual([ 'users', 0, 'email' ]);
            expect( stdIssues[2].path ).toBeUndefined();
        });

        it( 'verifies coerceQueryNumber, coerceQueryBoolean, coerceQueryDate, and coerceJsonDate (Positive & Negative)', () =>
        {
            // Positive coercions
            expect( coerceQueryNumber( '42.5' )).toBe( 42.5 );
            expect( coerceQueryBoolean( 'true' )).toBe( true );
            expect( coerceQueryBoolean( '0' )).toBe( false );
            expect( coerceQueryDate( '2025-01-01T00:00:00Z' )).toBeInstanceOf( Date );
            expect( coerceJsonDate( '2025-01-01T00:00:00Z' )).toBeInstanceOf( Date );

            // Negative coercions (returns uncoerced value on invalid input)
            expect( coerceQueryNumber( '' )).toBe( '' );
            expect( coerceQueryNumber( '42px' )).toBe( '42px' );
            expect( coerceQueryBoolean( 'maybe' )).toBe( 'maybe' );
            expect( coerceQueryDate( 'not-a-date' )).toBe( 'not-a-date' );
            expect( coerceJsonDate( 12345 )).toBe( 12345 );
        });

        it( 'verifies path helpers (childPath, indexPath, isIndexSegment, tokenizePath, joinPathSegments, resolvePath, getValueAtPath, hasPath), transform helpers, and regex helpers', () =>
        {
            // Path helpers positive & negative
            expect( childPath( 'user', 'name' )).toBe( 'user.name' );
            expect( indexPath( 'items', 2 )).toBe( 'items[2]' );
            expect( isIndexSegment( '[0]' )).toBe( true );
            expect( isIndexSegment( 'name' )).toBe( false );
            expect( tokenizePath( 'users[0].name' )).toEqual([ 'users', '[0]', 'name' ]);
            expect( joinPathSegments([ 'users', '[0]', 'name' ])).toBe( 'users[0].name' );
            expect( resolvePath( 'users[0].name', '../role' )).toBe( 'users[0].role' );
            expect( resolvePath( 'users[0].name', 'absolute.path' )).toBe( 'absolute.path' );

            const tree = { users : [ { name : 'Ada', role : undefined } ] };
            expect( getValueAtPath( tree, 'users[0].name' )).toBe( 'Ada' );
            expect( getValueAtPath( tree, 'users[9].missing' )).toBeUndefined();
            expect( hasPath( tree, 'users[0].name' )).toBe( true );
            expect( hasPath( tree, 'users[0].role' )).toBe( false );
            expect( hasPath( tree, 'users[9].name' )).toBe( false );

            const tCtx = makeTransformContext( 'users[0].name', 'string', [ 'trimmed' ], tree );
            expect( tCtx.path ).toBe( 'users[0].name' );
            expect( tCtx.type ).toBe( 'string' );
            expect( tCtx.tags ).toEqual([ 'trimmed' ]);
            expect(
                applyNodeTransform( '  hi  ', 'name', ( v, ctx ) => ( ctx.type === 'string' ? String( v ).trim() : v ), 'string', [], tree )
            ).toBe( 'hi' );
            expect( new TransformWalkError( 'name', 'CustomFail' )).toBeInstanceOf( Error );

            // Regex helpers positive & negative
            expect( isSafeRegexSource( '^[a-z0-9]+$' )).toBe( true );
            expect( isSafeRegexSource( '(a+)+$' )).toBe( false );
            expect( createSafeRegex( '^ok$' )).toBeInstanceOf( RegExp );
            expect(() => createSafeRegex( '(a+)+$' )).toThrow( /Unsafe regular expression/ );
            expect( getCachedPattern( '^cached$' )).toBe( getCachedPattern( '^cached$' ));
            expect( getCachedPattern( '(a+)+$' )).toBeUndefined();
            expect( testRegex( /^ok$/, 'ok' )).toBe( true );
            expect( testRegex( /^ok$/, 'no' )).toBe( false );
        });
    });

    describe( '14. CommonJS E2E Parity, Untransformed Macro Guards, Bundler Unplugin, & IDE Plugin', () =>
    {
        it( 'executes CommonJS (emitAndRequire) E2E identically to ESM for both positive and negative cases', () =>
        {
            const validTree = {
                id       : 'cjs_root',
                value    : 1,
                children : [ { id : 'cjs_leaf', value : 2, children : [] } ]
            };
            const invalidTree = {
                id       : 'cjs_root',
                value    : -10,
                children : []
            };

            // Positive CJS
            expect( cjsAot.validateTree( validTree ).success ).toBe( true );
            const ser = cjsAot.stringifyTree( validTree );
            expect( ser.success ).toBe( true );
            expect( cjsAot.parseTree( ser.data ).data ).toEqual( validTree );

            // Negative CJS
            expect( cjsAot.validateTree( invalidTree ).success ).toBe( false );
            expect( cjsAot.parseTree( JSON.stringify( invalidTree )).success ).toBe( false );
        });

        it( 'throws descriptive TRANSFORMER_MISSING errors when any of the 13 AOT macros are called without the compiler transformer', () =>
        {
            const untransformedCalls: [ string, () => unknown ][] =
            [
                [ 'is', () => macroIs<string>( 'a' ) ],
                [ 'assert', () => macroAssert<string>( 'a' ) ],
                [ 'assertGuard', () => macroAssertGuard<string>( 'a' ) ],
                [ 'validate', () => macroValidate<string>( 'a' ) ],
                [ 'validator', () => macroValidator<string>() ],
                [ 'standardSchema', () => macroStandardSchema<string>() ],
                [ 'jsonSchema', () => macroJsonSchema<string>() ],
                [ 'parse', () => macroParse<string>( '"a"' ) ],
                [ 'parser', () => macroParser<string>() ],
                [ 'safeParse', () => macroSafeParse<string>( '"a"' ) ],
                [ 'stringify', () => macroStringify<string>( 'a' ) ],
                [ 'serializer', () => macroSerializer<string>() ],
                [ 'safeSerialize', () => macroSafeSerialize<string>( 'a' ) ]
            ];

            for( const [ name, invoke ] of untransformedCalls )
            {
                expect( invoke, `${name} should throw when untransformed` ).toThrow( /Typechecker transformer was not applied/ );
            }
        });

        it( 'verifies unplugin bundler helpers (shouldTransformFile, createBundlerTransformer, and bundler factories) and IDE plugin init', () =>
        {
            const codeWithMacro = 'import { validate } from "@webergency-utils/typechecker"; validate<User>(x);';

            // shouldTransformFile(code, id) positive & negative
            expect( shouldTransformFile( codeWithMacro, '/app/src/user.ts' )).toBe( true );
            expect( shouldTransformFile( codeWithMacro, '/app/node_modules/pkg/index.ts' )).toBe( false );
            expect( shouldTransformFile( codeWithMacro, '/app/src/styles.css' )).toBe( false );
            expect( shouldTransformFile( 'const x = 1 + 2;', '/app/src/plain.ts' )).toBe( false );

            // Bundler plugin factories
            expect( typecheckerVite()).toBeDefined();
            expect( typecheckerRollup()).toBeDefined();
            expect( typecheckerWebpack()).toBeDefined();
            expect( typecheckerEsbuild()).toBeDefined();
            expect( typecheckerPlugin()).toBeDefined();
            expect( createBundlerTransformer()).toBeDefined();

            // IDE Language Service plugin factory
            const pluginFactory = initPlugin({ typescript : ts });
            expect( typeof pluginFactory.create ).toBe( 'function' );
        });
    });

    describe( '15. WithModifiers<T, M>, Tag<T, C, V, Msg>, format.* Shorthands, & Custom Error Messages (Positive & Negative)', () =>
    {
        it( 'enforces WithModifiers, Tag<T, C, V, Msg>, format.UUID, format.Email, and custom messages across validate, parse, stringify, and jsonSchema', () =>
        {
            const validRaw = {
                id      : '550e8400-e29b-41d4-a716-446655440000',
                profile : {
                    email : '  ADA@EXAMPLE.COM  ',
                    age   : 25
                }
            };

            // Positive validate & parse (with LowerCase + Trim transforms on nested path)
            const vRes = aot.validateDecoratedCustomer( structuredClone( validRaw ));
            expect( vRes.success ).toBe( true );
            expect( vRes.data.profile.email ).toBe( 'ada@example.com' );

            const pRes = aot.parseDecoratedCustomer( JSON.stringify( validRaw ));
            expect( pRes.success ).toBe( true );
            expect( pRes.data.profile.email ).toBe( 'ada@example.com' );

            // Positive stringify & jsonSchema
            const sRes = aot.stringifyDecoratedCustomer( vRes.data );
            expect( sRes.success ).toBe( true );
            expect( isSchema( aot.schemaDecoratedCustomer, vRes.data )).toBe( true );

            // Negative: invalid UUID surfaces custom constraint.Message<'Invalid customer UUID'>
            const badUuid = aot.validateDecoratedCustomer({
                id      : 'not-a-uuid',
                profile : { email : 'ada@example.com', age : 25 }
            });
            expect( badUuid.success ).toBe( false );
            expect( badUuid.errors[0].path ).toBe( 'id' );
            expect( badUuid.errors[0].error ).toBe( 'Invalid customer UUID' );

            // Negative: underage surfaces custom Tag<number, 'minimum', 18, 'Customer must be 18+'>
            const badAge = aot.validateDecoratedCustomer({
                id      : '550e8400-e29b-41d4-a716-446655440000',
                profile : { email : 'ada@example.com', age : 16 }
            });
            expect( badAge.success ).toBe( false );
            expect( badAge.errors[0].path ).toBe( 'profile.age' );
            expect( badAge.errors[0].error ).toBe( 'Customer must be 18+' );

            // Negative: invalid email after trim/lowercase fails in validate and parse, and non-string email fails in stringify
            expect( aot.parseDecoratedCustomer( JSON.stringify({
                id      : '550e8400-e29b-41d4-a716-446655440000',
                profile : { email : '   not-an-email   ', age : 25 }
            })).success ).toBe( false );
            expect( aot.stringifyDecoratedCustomer({
                id      : '550e8400-e29b-41d4-a716-446655440000',
                profile : { email : 12345 as any, age : 25 }
            }).success ).toBe( false );
        });
    });

    describe( '16. TypeScript Utility Types (Pick, Omit, Partial, Required, Readonly, Record), Generics, keyof, Indexed Access, & Branded Primitives', () =>
    {
        it( 'validates, parses, serializes, and JSON-Schema checks generic Paginated<PublicProduct>, ProductPatch, keyof, and BrandedSku (Positive & Negative)', () =>
        {
            const validPage = {
                items  : [ { sku : 'SKU-1024', title : 'Mechanical Keyboard', price : 149.99 } ],
                total  : 1,
                meta   : { region : 'EU', currency : 'EUR' },
                sortBy : 'price'
            };

            // Positive across all 4 engines
            expect( aot.validatePaginatedProducts( validPage ).success ).toBe( true );
            const ser = aot.stringifyPaginatedProducts( validPage );
            expect( ser.success ).toBe( true );
            expect( aot.parsePaginatedProducts( ser.data ).data ).toEqual( validPage );
            expect( isSchema( aot.schemaPaginatedProducts, validPage )).toBe( true );

            // Positive & negative for Partial<Readonly<Pick<...>>> and indexed access BaseProduct['sku']
            expect( aot.validateProductPatch({}).success ).toBe( true );
            expect( aot.validateProductPatch({ title : 'Updated' }).success ).toBe( true );
            expect( aot.validateProductPatch({ title : 'A' }).success ).toBe( false );
            expect( aot.validateProductSku( 'SKU-9999' ).success ).toBe( true );
            expect( aot.validateProductSku( 'BAD-9999' ).success ).toBe( false );

            // Negative: Omit<'internalNotes'> rejects internalNotes in strict mode
            expect( aot.validatePaginatedProducts({
                ...validPage,
                items : [ { ...validPage.items[0], internalNotes : 'secret' } ]
            }).success ).toBe( false );

            // Negative: keyof PublicProduct rejects 'internalNotes' as sortBy
            expect( aot.validatePaginatedProducts({
                ...validPage,
                sortBy : 'internalNotes'
            }).success ).toBe( false );

            // Negative: Record<'region' | 'currency', ...> rejects missing 'currency'
            expect( aot.validatePaginatedProducts({
                ...validPage,
                meta : { region : 'EU' }
            }).success ).toBe( false );

            // Negative: BrandedSku pattern violation in validate and parse, and keyof sortBy violation in stringify
            const badSkuPage = {
                ...validPage,
                items : [ { sku : 'INVALID', title : 'Keyboard', price : 100 } ]
            };
            expect( aot.validatePaginatedProducts( badSkuPage ).success ).toBe( false );
            expect( aot.parsePaginatedProducts( JSON.stringify( badSkuPage )).success ).toBe( false );
            expect( aot.stringifyPaginatedProducts({ ...validPage, sortBy : 'internalNotes' }).success ).toBe( false );
        });
    });

    describe( '17. Custom from Coercion Callback, unionResolution:"declaration-order", Real Bundler Transform E2E, & IDE Static Diagnostics E2E', () =>
    {
        it( 'supports custom from(val, ctx) coercion callback in validate<T> and contrasts unionResolution:"declaration-order" vs "specificity"', () =>
        {
            // Custom from coercion callback: is<T> rejects root-level replacement, whereas validate<T> accepts and returns coerced data
            const coercedOk = aot.isScalarNum( '42', {
                from : ( val: unknown, ctx: { kind : string }) => ( ctx.kind === 'number' && typeof val === 'string' ? Number( val ) : val )
            });
            expect( coercedOk ).toBe( false );

            const validatedCoerced = aot.validateMerged(
                { id : 'u1', role : 'owner', active : 'yes', score : '50' },
                {
                    from : ( val: unknown, ctx: { kind : string }) =>
                    {
                        if( ctx.kind === 'boolean' && val === 'yes' ){ return true }

                        if( ctx.kind === 'number' && typeof val === 'string' ){ return Number( val ) }

                        return val;
                    }
                }
            );
            expect( validatedCoerced.success ).toBe( true );
            expect( validatedCoerced.data ).toEqual({ id : 'u1', role : 'owner', active : true, score : 50 });

            const validatedCoercedFail = aot.validateMerged(
                { id : 'u1', role : 'owner', active : 'no-match', score : '50' },
                {
                    from : ( val: unknown ) => val
                }
            );
            expect( validatedCoercedFail.success ).toBe( false );

            // unionResolution: 'declaration-order' picks the first declared arm { a: string } in strip mode and strips b & c
            const input = { a : 'hello', b : 'world', c : 42 };
            expect( aot.validateCompetingDeclOrder( structuredClone( input )).data ).toEqual({ a : 'hello' });
            expect( aot.parseCompetingDeclOrder( JSON.stringify( input )).data ).toEqual({ a : 'hello' });
            expect( JSON.parse( aot.stringifyCompetingDeclOrder( input ).data )).toEqual({ a : 'hello' });
        });

        it( 'executes real bundler createBundlerTransformer().transform() and IDE plugin getSemanticDiagnostics() for positive and negative cases', () =>
        {
            const bundler = createBundlerTransformer({ transpile : true });
            const virtualFile = '/Users/tomaskorenko/Projects/Github/webergency-utils/typechecker/src/__virtual_bundler_e2e__.ts';
            const validMacroSource = `
                import { is } from './index.js';
                export const checkStr = ( x: unknown ) => is<string>( x );
            `;

            // Positive bundler transform: expands is<string>(x) into __tcRuntime.is(__val_..., x, undefined)
            const transformed = bundler.transform( validMacroSource, virtualFile );
            expect( transformed ).not.toBeNull();
            expect( transformed!.code ).toContain( '__tcRuntime.is(' );
            expect( transformed!.code ).toContain( 'validators.string(' );
            bundler.invalidate( virtualFile );

            // Negative bundler transform: returns null for non-typechecker files
            expect( bundler.transform( 'export const x = 1;', '/app/src/plain.ts' )).toBeNull();

            // IDE Language Service plugin: positive (no error on valid literal) & negative (diagnostic 90001 on invalid literal)
            const ideFile = '/Users/tomaskorenko/Projects/Github/webergency-utils/typechecker/src/__virtual_ide_e2e__.ts';
            const ideSource = `
                import type { Minimum } from './index.js';
                type AdultAge = number & Minimum<18>;
                export const validAge: AdultAge = 25;
                export const invalidAge: AdultAge = 12;
            `;
            const sourceFile = ts.createSourceFile( ideFile, ideSource, ts.ScriptTarget.ES2022, true );
            const defaultHost = ts.createCompilerHost({ target : ts.ScriptTarget.ES2022, module : ts.ModuleKind.ESNext, moduleResolution : ts.ModuleResolutionKind.Bundler, strict : true });
            const customHost: ts.CompilerHost = {
                ...defaultHost,
                getSourceFile : ( fileName, languageVersion ) => ( fileName === ideFile ? sourceFile : defaultHost.getSourceFile( fileName, languageVersion )),
                fileExists    : fileName => ( fileName === ideFile ? true : defaultHost.fileExists( fileName )),
                readFile      : fileName => ( fileName === ideFile ? ideSource : defaultHost.readFile( fileName ))
            };
            const program = ts.createProgram([ ideFile ], { target : ts.ScriptTarget.ES2022, module : ts.ModuleKind.ESNext, moduleResolution : ts.ModuleResolutionKind.Bundler, strict : true }, customHost );
            const baseLs = {
                getSemanticDiagnostics : () => [],
                getProgram             : () => program
            } as unknown as ts.LanguageService;

            const plugin = initPlugin({ typescript : ts }).create({
                languageService     : baseLs,
                languageServiceHost : {} as ts.LanguageServiceHost,
                project             : {} as any,
                serverHost          : {} as any,
                config              : {}
            });

            const diags = plugin.getSemanticDiagnostics( ideFile );
            expect( diags.length ).toBe( 1 );
            expect( diags[0].code ).toBe( 90001 );
            expect( String( diags[0].messageText )).toContain( '12' );
        });
    });
});
