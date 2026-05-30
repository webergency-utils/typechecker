export type MinLength<N extends number, Msg extends string = string> = { readonly __minLength : N, readonly __minLength_message? : Msg };
export type MaxLength<N extends number, Msg extends string = string> = { readonly __maxLength : N, readonly __maxLength_message? : Msg };
export type Pattern<S extends string, Msg extends string = string> = { readonly __pattern : S, readonly __pattern_message? : Msg };

export type Format<S extends 
    | 'email' | 'uuid' | 'url' | 'ipv4' | 'ipv6' | 'date' | 'date-time'
    | 'byte' | 'password' | 'regex' | 'hostname' | 'idn-email' | 'idn-hostname'
    | 'iri' | 'iri-reference' | 'uri' | 'uri-reference' | 'uri-template'
    | 'time' | 'duration' | 'objectId'
, Msg extends string = string> = { readonly __format : S, readonly __format_message? : Msg };

export type Length<Min extends number, Max extends number> = MinLength<Min> & MaxLength<Max>;

// Number Constraints
export type Minimum<N extends number | bigint, Msg extends string = string> = { readonly __minimum : N, readonly __minimum_message? : Msg };
export type Maximum<N extends number | bigint, Msg extends string = string> = { readonly __maximum : N, readonly __maximum_message? : Msg };
export type ExclusiveMinimum<N extends number | bigint, Msg extends string = string> = { readonly __exclusiveMinimum : N, readonly __exclusiveMinimum_message? : Msg };
export type ExclusiveMaximum<N extends number | bigint, Msg extends string = string> = { readonly __exclusiveMaximum : N, readonly __exclusiveMaximum_message? : Msg };
export type MultipleOf<N extends number | bigint, Msg extends string = string> = { readonly __multipleOf : N, readonly __multipleOf_message? : Msg };

// Number Composite Helpers
export type Range<Min extends number | bigint, Max extends number | bigint> = Minimum<Min> & Maximum<Max>;

// Array Constraints
export type MinItems<N extends number, Msg extends string = string> = { readonly __minItems : N, readonly __minItems_message? : Msg };
export type MaxItems<N extends number, Msg extends string = string> = { readonly __maxItems : N, readonly __maxItems_message? : Msg };
export type UniqueItems<Msg extends string = string> = { readonly __uniqueItems : true, readonly __uniqueItems_message? : Msg };

// Custom Validation function link
export type Custom<Fn extends ( ...args: any[] ) => boolean, Msg extends string = string> = { readonly __custom : Fn, readonly __custom_message? : Msg };

// Cross-field dependencies
export type Requires<Paths extends string | readonly string[], Msg extends string = string> = { readonly __requires : Paths, readonly __requires_message? : Msg };

// Custom message override
export type Message<Msg extends string> = { readonly __message : Msg };
