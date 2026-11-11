import { ResolveDefaults, ParseOutput, SerializeInput } from './runtime/tags.js';
import { getOrCompileSchema, compileSchema } from './runtime/schema-compiler.js';
import {
    is as runIs,
    assert as runAssert,
    assertGuard as runAssertGuard,
    validate as runValidate,
    groupErrorsByPath,
    toZodIssues,
    ZodLikeError,
    toStandardSchemaIssues
} from './runtime/validators.js';
import { ParseError } from './runtime/parse-runtime.js';
import { SerializationError } from './runtime/serializer-runtime.js';
import type {
    IValidation,
    IValidationSuccess,
    IValidationFailure,
    IValidationError,
    ValidationMode,
    UnionResolution,
    GuardOptions,
    AssertGuardOptions,
    ValidationOptions,
    AssertOptions,
    ValidationContext,
    FromCoercionContext,
    CoercionKind,
    PathContext,
    JsonSchema,
    JsonSchemaObject,
    JsonSchemaType,
    JsonSchemaTypescriptType,
    JsonSchemaTarget,
    JsonSchemaOptions,
    SchemaValidator,
    CompiledSchema,
    CompiledValidator,
    SchemaAnnotationFrame,
    StandardSchemaV1
} from './runtime/validators.js';
import type {
    SafeParseResult,
    SafeParseSuccess,
    SafeParseFailure,
    CompiledParser,
    RuntimeParseOptions,
    FormDataLike,
    HeadersLike,
    HeadersInput,
    ParseInput,
    ParseSource
} from './runtime/parse-runtime.js';
import type {
    SafeSerializeResult,
    SafeSerializeSuccess,
    SafeSerializeFailure,
    CompiledSerializer,
    RuntimeSerializeOptions,
    BigIntWireFormat
} from './runtime/serializer-runtime.js';
import type { CompiledCloner, CompiledPruner } from './runtime/clone-runtime.js';
import type { CompiledRandomGenerator, Rng } from './runtime/random-runtime.js';
import type { JsonReviver, JsonReplacer, TransformFn, TransformContext } from './runtime/transform.js';
import type { CasingFormat } from './runtime/casing.js';

const TRANSFORMER_MISSING =
    'Typechecker transformer was not applied. Register { "transform": "@webergency-utils/typechecker/transformer" } in tsconfig plugins (requires ts-patch).';

/** Type guard for `T`. Mutates in place; root-level coercion that replaces the value fails the guard. */
export function is<T>( _input: unknown, _options?: ValidationMode | GuardOptions ): _input is ResolveDefaults<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** Validates and returns the (possibly coerced) value. Use `from` when conversion is needed. */
export function assert<T>( _input: unknown, _options?: ValidationMode | AssertOptions ): ResolveDefaults<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** Asserts `input` is `T`. Mutates in place; root-level coercion that replaces the value throws. */
export function assertGuard<T>( _input: unknown, _options?: ValidationMode | AssertGuardOptions ): asserts _input is ResolveDefaults<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

export function validate<T>( _input: unknown, _options?: ValidationMode | ValidationOptions ): IValidation<ResolveDefaults<T>>
{
    throw new Error( TRANSFORMER_MISSING );
}

export function jsonSchema<T>( _options?: JsonSchemaTarget | JsonSchemaOptions ): JsonSchema
{
    throw new Error( TRANSFORMER_MISSING );
}

/** Standard Schema v1 (~standard) compliant schema wrapper for type `T`. */
export function standardSchema<T>( _options?: ValidationMode | ValidationOptions ): StandardSchemaV1<T, ResolveDefaults<T>>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Compiles a reusable validator object for type `T` with `.validate()`, `.is()`, `.assert()`, `.assertGuard()`, and `['~standard']`. */
export function validator<T>( _options?: ValidationMode | ValidationOptions ): CompiledValidator<ResolveDefaults<T>, T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** Schema type-predicate. Mutates in place; root-level coercion that replaces the value fails. */
export function isSchema<T = unknown>( schema: JsonSchema | boolean, input: unknown, options?: ValidationMode | GuardOptions ): input is T
{
    return runIs( getOrCompileSchema( schema ), input, options );
}

/** Validates `input` against a JSON Schema value and returns the (possibly coerced) data. */
export function assertSchema<T = unknown>( schema: JsonSchema | boolean, input: unknown, options?: ValidationMode | AssertOptions ): T
{
    return runAssert( getOrCompileSchema( schema ), input, options );
}

/** Schema assertion guard. Mutates in place; root-level coercion that replaces the value throws. */
export function assertGuardSchema<T = unknown>( schema: JsonSchema | boolean, input: unknown, options?: ValidationMode | AssertGuardOptions ): asserts input is T
{
    runAssertGuard( getOrCompileSchema( schema ), input, options );
}

/** Validates `input` against a JSON Schema value. */
export function validateSchema<T = unknown>( schema: JsonSchema | boolean, input: unknown, options?: ValidationMode | ValidationOptions ): IValidation<T>
{
    return runValidate( getOrCompileSchema( schema ), input, options );
}

export {
    getOrCompileSchema,
    compileSchema,
    groupErrorsByPath,
    toZodIssues,
    ZodLikeError,
    toStandardSchemaIssues,
    ParseError,
    SerializationError
};

export type {
    IValidation,
    IValidationSuccess,
    IValidationFailure,
    IValidationError,
    ValidationMode,
    UnionResolution,
    GuardOptions,
    AssertGuardOptions,
    ValidationOptions,
    AssertOptions,
    ValidationContext,
    FromCoercionContext,
    CoercionKind,
    PathContext,
    JsonSchema,
    JsonSchemaObject,
    JsonSchemaType,
    JsonSchemaTypescriptType,
    JsonSchemaTarget,
    JsonSchemaOptions,
    SchemaValidator,
    CompiledSchema,
    CompiledValidator,
    SchemaAnnotationFrame,
    StandardSchemaV1,
    SafeParseResult,
    SafeParseSuccess,
    SafeParseFailure,
    CompiledParser,
    RuntimeParseOptions,
    FormDataLike,
    HeadersLike,
    HeadersInput,
    ParseInput,
    ParseSource,
    SafeSerializeResult,
    SafeSerializeSuccess,
    SafeSerializeFailure,
    CompiledSerializer,
    RuntimeSerializeOptions,
    BigIntWireFormat,
    CompiledCloner,
    CompiledPruner,
    CompiledRandomGenerator,
    Rng,
    JsonReviver,
    JsonReplacer,
    TransformFn,
    TransformContext
};

export * from './runtime/tags.js';
export * from './runtime/casing.js';

export type SerializationMode = ValidationMode;
export type SerializeFormat = 'json' | 'query';

export interface SerializerOptions
{
    mode?            : SerializationMode
    format?          : SerializeFormat
    to?              : SerializeFormat
    unionResolution? : UnionResolution
    propertyCasing?  : CasingFormat
    bigintAs?        : BigIntWireFormat
    replacer?        : JsonReplacer
    transform?       : TransformFn | TransformFn[]
}

export interface ParseOptions
{
    mode?            : ValidationMode
    from?            : ParseSource
    unionResolution? : UnionResolution
    propertyCasing?  : CasingFormat
    reviver?         : JsonReviver
    transform?       : TransformFn | TransformFn[]
}

export type FormDataParseOptions = ParseOptions & { from : 'formData' };
export type HeadersParseOptions = ParseOptions & { from : 'headers' };
export type TextParseOptions = ParseOptions & { from? : 'json' | 'query' | 'string' };

/** AOT Macro: Compiles a fast serializer function for type `T`. */
export function serializer<T>( _options?: ValidationMode | SerializerOptions ): CompiledSerializer<SerializeInput<T>>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Validates and serializes `input` as type `T`. */
export function stringify<T>( _input: SerializeInput<T>, _options?: ValidationMode | SerializerOptions ): string
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Non-throwing single-pass validation and serialization into `{ success, data, error }`. */
export function safeSerialize<T>( _input: SerializeInput<T>, _options?: ValidationMode | SerializerOptions ): SafeSerializeResult
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Single-pass parses and validates `input` into type `T`. */
export function parse<T>( _input: FormDataLike, _options: FormDataParseOptions ): ParseOutput<T>;
export function parse<T>( _input: HeadersInput, _options: HeadersParseOptions ): ParseOutput<T>;
export function parse<T>( _input: string, _options?: ValidationMode | TextParseOptions ): ParseOutput<T>;
export function parse<T>( _input: ParseInput, _options?: ValidationMode | ParseOptions ): ParseOutput<T>;
export function parse<T>( _input: ParseInput, _options?: ValidationMode | ParseOptions ): ParseOutput<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Compiles a fast reusable parser function for type `T`. */
export function parser<T>( _options: FormDataParseOptions ): CompiledParser<ParseOutput<T>, FormDataLike>;
export function parser<T>( _options: HeadersParseOptions ): CompiledParser<ParseOutput<T>, HeadersInput>;
export function parser<T>( _options?: ValidationMode | TextParseOptions ): CompiledParser<ParseOutput<T>, string>;
export function parser<T>( _options?: ValidationMode | ParseOptions ): CompiledParser<ParseOutput<T>, ParseInput>;
export function parser<T>( _options?: ValidationMode | ParseOptions ): CompiledParser<ParseOutput<T>, any>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Non-throwing single-pass parse and validation into `{ success, data, error }`. */
export function safeParse<T>( _input: FormDataLike, _options: FormDataParseOptions ): SafeParseResult<ParseOutput<T>>;
export function safeParse<T>( _input: HeadersInput, _options: HeadersParseOptions ): SafeParseResult<ParseOutput<T>>;
export function safeParse<T>( _input: string, _options?: ValidationMode | TextParseOptions ): SafeParseResult<ParseOutput<T>>;
export function safeParse<T>( _input: unknown, _options?: ValidationMode | ParseOptions ): SafeParseResult<ParseOutput<T>>;
export function safeParse<T>( _input: unknown, _options?: ValidationMode | ParseOptions ): SafeParseResult<ParseOutput<T>>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Deep-clones `input` using a type-specialized cloner for `T` (omitting undeclared object properties). */
export function clone<T>( _input: T ): T
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Compiles a fast reusable deep-cloner function for type `T`. */
export function cloner<T>(): CompiledCloner<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Strips undeclared excess object properties from `input` in place according to type `T` and returns `input`. */
export function prune<T>( _input: T ): T
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Compiles a fast reusable in-place excess-property pruner function for type `T`. */
export function pruner<T>(): CompiledPruner<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Generates a valid arbitrary/mock value of type `T` honoring type & JSDoc constraints (deterministic when `seed` is passed). */
export function random<T>( _seed?: number ): ResolveDefaults<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Compiles a reusable arbitrary/mock generator function for type `T`. */
export function randomGenerator<T>( _defaultSeed?: number ): CompiledRandomGenerator<ResolveDefaults<T>>
{
    throw new Error( TRANSFORMER_MISSING );
}
