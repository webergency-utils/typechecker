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
    | 'time' | 'duration' | 'objectId'
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

// Unified constraint namespace
export namespace constraint {
    // String Constraints
    export type MinLength<N extends number> = { readonly __minLength: N };
    export type MaxLength<N extends number> = { readonly __maxLength: N };
    export type Pattern<S extends string> = { readonly __pattern: S };
    export type Format<S extends 
        | 'email' | 'uuid' | 'url' | 'ipv4' | 'ipv6' | 'date' | 'date-time'
        | 'byte' | 'password' | 'regex' | 'hostname' | 'idn-email' | 'idn-hostname'
        | 'iri' | 'iri-reference' | 'uri' | 'uri-reference' | 'uri-template'
        | 'time' | 'duration' | 'objectId'
    > = { readonly __format: S };

    // String Composite Helpers
    export type Length<Min extends number, Max extends number> = MinLength<Min> & MaxLength<Max>;

    // Number Constraints
    export type Minimum<N extends number | bigint> = { readonly __minimum: N };
    export type Maximum<N extends number | bigint> = { readonly __maximum: N };
    export type ExclusiveMinimum<N extends number | bigint> = { readonly __exclusiveMinimum: N };
    export type ExclusiveMaximum<N extends number | bigint> = { readonly __exclusiveMaximum: N };
    export type MultipleOf<N extends number | bigint> = { readonly __multipleOf: N };

    // Number Composite Helpers
    export type Range<Min extends number | bigint, Max extends number | bigint> = Minimum<Min> & Maximum<Max>;

    // Array Constraints
    export type MinItems<N extends number> = { readonly __minItems: N };
    export type MaxItems<N extends number> = { readonly __maxItems: N };
    export type UniqueItems = { readonly __uniqueItems: true };

    // Custom Validation function link
    export type Custom<Fn extends (...args: any[]) => boolean> = { readonly __custom: Fn };
}

// Tag namespace for metadata/initializers
export namespace tag {
    export type Default<V extends string | number | boolean | null> = { readonly __default: V };
}

// Unified format namespace
export namespace format {
    export type Email = Format<'email'>;
    export type UUID = Format<'uuid'>;
    export type URL = Format<'url'>;
    export type IPv4 = Format<'ipv4'>;
    export type IPv6 = Format<'ipv6'>;
    export type Date = Format<'date'>;
    export type DateTime = Format<'date-time'>;
    export type Byte = Format<'byte'>;
    export type Password = Format<'password'>;
    export type Regex = Format<'regex'>;
    export type Hostname = Format<'hostname'>;
    export type Time = Format<'time'>;
    export type Duration = Format<'duration'>;
    export type ObjectId = Format<'objectId'>;
}

// Unified transform namespace
export namespace transform {
    export type LowerCase = { readonly __transform_lowercase: true };
    export type UpperCase = { readonly __transform_uppercase: true };
    export type Trim = { readonly __transform_trim: true };
    export type Capitalize = { readonly __transform_capitalize: true };
    export type ToNumber = { readonly __transform_tonumber: true };
    export type ToBoolean = { readonly __transform_toboolean: true };
    export type ToDate = { readonly __transform_todate: true };
    export type Custom<Fn extends (val: any) => any> = { readonly __transform_custom: Fn };
}

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
    custom?: string;
    default?: string | number | boolean | null;
}
