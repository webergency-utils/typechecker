import { ResolveDefaults } from './runtime/tags.js';
import {
    getOrCompileSchema,
    is as runIs,
    assert as runAssert,
    assertGuard as runAssertGuard,
    validate as runValidate
} from './runtime/validators.js';
import type {
    IValidationError,
    ValidationMode,
    GuardOptions,
    AssertGuardOptions,
    ValidationOptions,
    AssertOptions
} from './runtime/validators.js';

export interface IValidation<T> {
    success : boolean
    data?   : T
    errors? : IValidationError[]
}

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

export function jsonSchema<T>(): any
{
    throw new Error( TRANSFORMER_MISSING );
}

/** Schema type-predicate. Mutates in place; root-level coercion that replaces the value fails. */
export function isSchema( schema: any, input: unknown, options?: ValidationMode | GuardOptions ): boolean
{
    return runIs( getOrCompileSchema( schema ), input, options );
}

/** Validates `input` against a JSON Schema value and returns the (possibly coerced) data. */
export function assertSchema<T = any>( schema: any, input: unknown, options?: ValidationMode | AssertOptions ): T
{
    return runAssert( getOrCompileSchema( schema ), input, options );
}

/** Schema assertion guard. Mutates in place; root-level coercion that replaces the value throws. */
export function assertGuardSchema( schema: any, input: unknown, options?: ValidationMode | AssertGuardOptions ): void
{
    runAssertGuard( getOrCompileSchema( schema ), input, options );
}

/** Validates `input` against a JSON Schema value. */
export function validateSchema<T = any>( schema: any, input: unknown, options?: ValidationMode | ValidationOptions ): IValidation<T>
{
    return runValidate( getOrCompileSchema( schema ), input, options );
}

export {
    getOrCompileSchema,
    compileSchema,
    validators,
    coerceQueryNumber,
    coerceQueryBoolean,
    coerceQueryDate,
    coerceJsonDate,
    groupErrorsByPath,
    toZodIssues,
    ZodLikeError
} from './runtime/validators.js';
export type {
    IValidationError,
    ValidationMode,
    GuardOptions,
    AssertGuardOptions,
    ValidationOptions,
    AssertOptions,
    ValidationContext,
    FromCoercionContext,
    CoercionKind,
    PathContext
} from './runtime/validators.js';
export * from './runtime/tags.js';
export * from './runtime/casing.js';
export * from './runtime/serializer-runtime.js';
export * from './runtime/parse-runtime.js';

export type SerializationMode = ValidationMode;
export type SerializeFormat = 'json' | 'query';
export type ParseSource = 'json' | 'query' | 'string';

export interface SerializerOptions
{
    mode?   : SerializationMode
    format? : SerializeFormat
    to?     : SerializeFormat
}

export interface ParseOptions
{
    mode? : ValidationMode
    from? : ParseSource
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

/** AOT Macro: Single-pass parses and validates `input` into type `T`. */
export function parse<T>( _input: unknown, _options?: ValidationMode | ParseOptions ): ResolveDefaults<T>
{
    throw new Error( TRANSFORMER_MISSING );
}
