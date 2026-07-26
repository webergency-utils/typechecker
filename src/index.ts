import { ResolveDefaults } from './runtime/tags.js';
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
export function isSchema( _schema: any, _input: unknown, _options?: ValidationMode | GuardOptions ): boolean
{
    throw new Error( TRANSFORMER_MISSING );
}

/** Validates `input` against a JSON Schema value and returns the (possibly coerced) data. */
export function assertSchema<T = any>( _schema: any, _input: unknown, _options?: ValidationMode | AssertOptions ): T
{
    throw new Error( TRANSFORMER_MISSING );
}

/** Schema assertion guard. Mutates in place; root-level coercion that replaces the value throws. */
export function assertGuardSchema( _schema: any, _input: unknown, _options?: ValidationMode | AssertGuardOptions ): void
{
    throw new Error( TRANSFORMER_MISSING );
}

/** Validates `input` against a JSON Schema value. */
export function validateSchema<T = any>( _schema: any, _input: unknown, _options?: ValidationMode | ValidationOptions ): IValidation<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

export * from './runtime/validators.js';
export * from './runtime/tags.js';
export * from './runtime/casing.js';
