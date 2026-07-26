import { ResolveDefaults } from './runtime/tags.js';
import type { IValidationError } from './runtime/validators.js';

export interface IValidation<T> {
    success : boolean
    data?   : T
    errors? : IValidationError[]
}

export type ValidationMode = 'strict' | 'relaxed' | 'strip';

export interface ValidationOptions {
    mode?         : ValidationMode
    from?         : 'json' | 'query' | (( key: string, value: any, type:
        | 'string' | 'number' | 'boolean' | 'bigint' | 'function' | 'symbol' | 'never'
        | 'Date' | 'RegExp' | 'Set' | 'Map' | 'Array' | 'Object' | 'instance'
        | 'null' | 'undefined' | 'tuple' | 'literal'
    ) => any )
    wrapArrays?   : boolean
    /** When true, write validated/coerced values onto the input. Default false: always return new containers. */
    mutate?       : boolean
    schema?       : any
    errorFactory? : ( errors: any[]) => Error
}

const TRANSFORMER_MISSING =
    'Typechecker transformer was not applied. Register { "transform": "@webergency-utils/typechecker/transformer" } in tsconfig plugins (requires ts-patch).';

/** Returns whether `input` already matches `T`. Does not coerce; `from` is ignored. */
export function is<T>( _input: unknown, _options?: ValidationMode | ValidationOptions ): _input is ResolveDefaults<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** Validates and returns the (possibly coerced) value. Use `from` when conversion is needed. */
export function assert<T>( _input: unknown, _options?: ValidationMode | ValidationOptions ): ResolveDefaults<T>
{
    throw new Error( TRANSFORMER_MISSING );
}

/** Asserts `input` already matches `T`. Does not coerce; `from` is ignored. */
export function assertGuard<T>( _input: unknown, _options?: ValidationMode | ValidationOptions ): asserts _input is ResolveDefaults<T>
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

export * from './runtime/validators.js';
export * from './runtime/tags.js';
export * from './runtime/casing.js';
