import { ResolveDefaults } from './runtime/tags.js';
import { getOrCompileSchema, compileSchema } from './runtime/schema-compiler.js';
import {
    is as runIs,
    assert as runAssert,
    assertGuard as runAssertGuard,
    validate as runValidate
} from './runtime/validators.js';
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
    JsonSchema,
    JsonSchemaTarget,
    JsonSchemaOptions,
    StandardSchemaV1,
    CompiledValidator
} from './runtime/validators.js';
import type { SafeParseResult } from './runtime/parse-runtime.js';
import type { SafeSerializeResult } from './runtime/serializer-runtime.js';
import type { JsonReviver, JsonReplacer, TransformFn } from './runtime/transform.js';

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
export function isSchema( schema: JsonSchema, input: unknown, options?: ValidationMode | GuardOptions ): boolean
{
    return runIs( getOrCompileSchema( schema ), input, options );
}

/** Validates `input` against a JSON Schema value and returns the (possibly coerced) data. */
export function assertSchema<T = unknown>( schema: JsonSchema, input: unknown, options?: ValidationMode | AssertOptions ): T
{
    return runAssert( getOrCompileSchema( schema ), input, options );
}

/** Schema assertion guard. Mutates in place; root-level coercion that replaces the value throws. */
export function assertGuardSchema( schema: JsonSchema, input: unknown, options?: ValidationMode | AssertGuardOptions ): void
{
    runAssertGuard( getOrCompileSchema( schema ), input, options );
}

/** Validates `input` against a JSON Schema value. */
export function validateSchema<T = unknown>( schema: JsonSchema, input: unknown, options?: ValidationMode | ValidationOptions ): IValidation<T>
{
    return runValidate( getOrCompileSchema( schema ), input, options );
}

export { getOrCompileSchema, compileSchema };
export {
    validators,
    coerceQueryNumber,
    coerceQueryBoolean,
    coerceQueryDate,
    coerceJsonDate,
    groupErrorsByPath,
    toZodIssues,
    ZodLikeError,
    createStandardSchema,
    createValidator,
    toStandardSchemaIssues
} from './runtime/validators.js';
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
    StandardSchemaV1
} from './runtime/validators.js';
export * from './runtime/tags.js';
export * from './runtime/casing.js';
export * from './runtime/serializer-runtime.js';
export * from './runtime/parse-runtime.js';

export type { JsonReviver, JsonReplacer, TransformFn, TransformContext } from './runtime/transform.js';

export type SerializationMode = ValidationMode;
export type SerializeFormat = 'json' | 'query';
export type ParseSource = 'json' | 'query' | 'string';

export interface SerializerOptions
{
    mode?            : SerializationMode
    format?          : SerializeFormat
    to?              : SerializeFormat
    unionResolution? : UnionResolution
    replacer?        : JsonReplacer
    transform?       : TransformFn | TransformFn[]
}

export interface ParseOptions
{
    mode?            : ValidationMode
    from?            : ParseSource
    unionResolution? : UnionResolution
    reviver?         : JsonReviver
    transform?       : TransformFn | TransformFn[]
}

/** AOT Macro: Compiles a fast serializer function for type `T`. */
export function serializer<T>( _options?: ValidationMode | SerializerOptions ): ( input: T ) => string
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Validates and serializes `input` as type `T`. */
export function stringify<T>( _input: T, _options?: ValidationMode | SerializerOptions ): string
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Non-throwing single-pass validation and serialization into `{ success, data, error }`. */
export function safeSerialize<T>( _input: T, _options?: ValidationMode | SerializerOptions ): SafeSerializeResult
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Single-pass parses and validates `input` into type `T`. */
export function parse<T>( _input: string, _options?: ValidationMode | ParseOptions ): ResolveDefaults<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Compiles a fast reusable parser function for type `T`. */
export function parser<T>( _options?: ValidationMode | ParseOptions ): ( input: string ) => ResolveDefaults<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** AOT Macro: Non-throwing single-pass parse and validation into `{ success, data, error }`. */
export function safeParse<T>( _input: string, _options?: ValidationMode | ParseOptions ): SafeParseResult<ResolveDefaults<T>>
{
    throw new Error( TRANSFORMER_MISSING );
}
