/**
 * Validation Tags for AOT Typechecker
 * These are used in intersection types to add constraints.
 * Example: type Password = string & MinLength<8>;
 */

// String Constraints
export type MinLength<N extends number> = { readonly __minLength: N };
export type MaxLength<N extends number> = { readonly __maxLength: N };
export type Pattern<S extends string> = { readonly __pattern: S };

export type Format<S extends 
    | 'email' | 'uuid' | 'url' | 'ipv4' | 'ipv6' | 'date' | 'date-time'
    | 'byte' | 'password' | 'regex' | 'hostname' | 'idn-email' | 'idn-hostname'
    | 'iri' | 'iri-reference' | 'uri' | 'uri-reference' | 'uri-template'
    | 'time' | 'duration'
> = { readonly __format: S };

// Number Constraints
export type Minimum<N extends number | bigint> = { readonly __minimum: N };
export type Maximum<N extends number | bigint> = { readonly __maximum: N };
export type ExclusiveMinimum<N extends number | bigint> = { readonly __exclusiveMinimum: N };
export type ExclusiveMaximum<N extends number | bigint> = { readonly __exclusiveMaximum: N };
export type MultipleOf<N extends number | bigint> = { readonly __multipleOf: N };

// Array Constraints
export type MinItems<N extends number> = { readonly __minItems: N };
export type MaxItems<N extends number> = { readonly __maxItems: N };
export type UniqueItems = { readonly __uniqueItems: true };

// Helper to extract constraints in AOT
export interface ITypeConstraints {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    minimum?: number | bigint;
    maximum?: number | bigint;
    exclusiveMinimum?: number | bigint;
    exclusiveMaximum?: number | bigint;
    multipleOf?: number | bigint;
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
}
