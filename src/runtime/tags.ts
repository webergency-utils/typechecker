/**
 * Validation Tags for AOT Typechecker
 * These are used in intersection types to add constraints.
 * Example: type Password = string & MinLength<8>;
 */

// String Constraints
export type MinLength<N extends number, Msg extends string = string> = { readonly __minLength: N; readonly __minLength_message?: Msg };
export type MaxLength<N extends number, Msg extends string = string> = { readonly __maxLength: N; readonly __maxLength_message?: Msg };
export type Pattern<S extends string, Msg extends string = string> = { readonly __pattern: S; readonly __pattern_message?: Msg };

export type Format<S extends 
    | 'email' | 'uuid' | 'url' | 'ipv4' | 'ipv6' | 'date' | 'date-time'
    | 'byte' | 'password' | 'regex' | 'hostname' | 'idn-email' | 'idn-hostname'
    | 'iri' | 'iri-reference' | 'uri' | 'uri-reference' | 'uri-template'
    | 'time' | 'duration' | 'objectId'
, Msg extends string = string> = { readonly __format: S; readonly __format_message?: Msg };

// Number Constraints
export type Minimum<N extends number | bigint, Msg extends string = string> = { readonly __minimum: N; readonly __minimum_message?: Msg };
export type Maximum<N extends number | bigint, Msg extends string = string> = { readonly __maximum: N; readonly __maximum_message?: Msg };
export type ExclusiveMinimum<N extends number | bigint, Msg extends string = string> = { readonly __exclusiveMinimum: N; readonly __exclusiveMinimum_message?: Msg };
export type ExclusiveMaximum<N extends number | bigint, Msg extends string = string> = { readonly __exclusiveMaximum: N; readonly __exclusiveMaximum_message?: Msg };
export type MultipleOf<N extends number | bigint, Msg extends string = string> = { readonly __multipleOf: N; readonly __multipleOf_message?: Msg };

// Array Constraints
export type MinItems<N extends number, Msg extends string = string> = { readonly __minItems: N; readonly __minItems_message?: Msg };
export type MaxItems<N extends number, Msg extends string = string> = { readonly __maxItems: N; readonly __maxItems_message?: Msg };
export type UniqueItems<Msg extends string = string> = { readonly __uniqueItems: true; readonly __uniqueItems_message?: Msg };

// Cross-field dependencies
export type Requires<Paths extends string | readonly string[], Msg extends string = string> = { readonly __requires: Paths; readonly __requires_message?: Msg };

// Custom message override
export type Message<Msg extends string> = { readonly __message: Msg };


// Unified constraint namespace
export namespace constraint {
    // String Constraints
    export type MinLength<N extends number, Msg extends string = string> = { readonly __minLength: N; readonly __minLength_message?: Msg };
    export type MaxLength<N extends number, Msg extends string = string> = { readonly __maxLength: N; readonly __maxLength_message?: Msg };
    export type Pattern<S extends string, Msg extends string = string> = { readonly __pattern: S; readonly __pattern_message?: Msg };
    export type Format<S extends 
        | 'email' | 'uuid' | 'url' | 'ipv4' | 'ipv6' | 'date' | 'date-time'
        | 'byte' | 'password' | 'regex' | 'hostname' | 'idn-email' | 'idn-hostname'
        | 'iri' | 'iri-reference' | 'uri' | 'uri-reference' | 'uri-template'
        | 'time' | 'duration' | 'objectId'
    , Msg extends string = string> = { readonly __format: S; readonly __format_message?: Msg };

    // String Composite Helpers
    export type Length<Min extends number, Max extends number> = MinLength<Min> & MaxLength<Max>;

    // Number Constraints
    export type Minimum<N extends number | bigint, Msg extends string = string> = { readonly __minimum: N; readonly __minimum_message?: Msg };
    export type Maximum<N extends number | bigint, Msg extends string = string> = { readonly __maximum: N; readonly __maximum_message?: Msg };
    export type ExclusiveMinimum<N extends number | bigint, Msg extends string = string> = { readonly __exclusiveMinimum: N; readonly __exclusiveMinimum_message?: Msg };
    export type ExclusiveMaximum<N extends number | bigint, Msg extends string = string> = { readonly __exclusiveMaximum: N; readonly __exclusiveMaximum_message?: Msg };
    export type MultipleOf<N extends number | bigint, Msg extends string = string> = { readonly __multipleOf: N; readonly __multipleOf_message?: Msg };

    // Number Composite Helpers
    export type Range<Min extends number | bigint, Max extends number | bigint> = Minimum<Min> & Maximum<Max>;

    // Array Constraints
    export type MinItems<N extends number, Msg extends string = string> = { readonly __minItems: N; readonly __minItems_message?: Msg };
    export type MaxItems<N extends number, Msg extends string = string> = { readonly __maxItems: N; readonly __maxItems_message?: Msg };
    export type UniqueItems<Msg extends string = string> = { readonly __uniqueItems: true; readonly __uniqueItems_message?: Msg };

    // Custom Validation function link
    export type Custom<Fn extends (...args: any[]) => boolean, Msg extends string = string> = { readonly __custom: Fn; readonly __custom_message?: Msg };

    // Cross-field dependencies
    export type Requires<Paths extends string | readonly string[], Msg extends string = string> = { readonly __requires: Paths; readonly __requires_message?: Msg };

    // Custom message override
    export type Message<Msg extends string> = { readonly __message: Msg };
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

type Split<S extends string, D extends string> =
  S extends `${infer T}${D}${infer U}`
    ? [T, ...Split<U, D>]
    : [S];

type ModifierPathTuple<T, Path extends string[], Modifiers> = 
  Path extends [infer Key, ...infer Rest]
    ? Key extends keyof T
      ? {
          [P in keyof T]: P extends Key
            ? Rest extends string[]
              ? Rest['length'] extends 0
                ? T[P] & Modifiers 
                : ModifierPathTuple<Exclude<T[P], undefined>, Rest, Modifiers> | (undefined extends T[P] ? undefined : never)
              : T[P]
            : T[P]
        }
      : T
    : T;

type UnionToIntersection<U> = 
  (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;
type LastOf<U> = 
  UnionToIntersection<U extends any ? (f: U) => void : never> extends ((a: infer A) => void) ? A : never;
type Push<T extends any[], V> = [...T, V];
type TuplifyUnion<U, L = LastOf<U>> = 
  [U] extends [never] ? [] : Push<TuplifyUnion<Exclude<U, L>>, L>;

type Entries<M> = {
  [K in keyof M]: [K, M[K]]
}[keyof M];

type ApplyModifiers<T, EntriesList extends any[]> = 
  EntriesList extends [[infer Path, infer Modifiers], ...infer Rest]
    ? Path extends string
      ? ApplyModifiers<ModifierPathTuple<T, Split<Path, '.'>, Modifiers>, Rest>
      : T
    : T;

/**
 * Utility type to decorate nested properties of a type with validation/transform modifiers without retyping the structure.
 */
export type WithModifiers<T, M> = ApplyModifiers<T, TuplifyUnion<Entries<M>>>;

