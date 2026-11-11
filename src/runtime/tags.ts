/**
 * Validation Tags for AOT Typechecker
 * These are used in intersection types to add constraints.
 * Example: type Password = string & MinLength<8>;
 */

// Export root-level tags for backward compatibility
export * from './tags/constraint.js';

// Export namespace-like modules
export * as constraint from './tags/constraint.js';
export * from './tags/tag.js';
export * as format from './tags/format.js';
export * as transform from './tags/transform.js';

// Helper to extract constraints in AOT
export interface ITypeConstraints
{
    minLength?        : number
    maxLength?        : number
    pattern?          : string
    format?           : string
    minimum?          : number | bigint
    maximum?          : number | bigint
    exclusiveMinimum? : number | bigint
    exclusiveMaximum? : number | bigint
    multipleOf?       : number | bigint
    minItems?         : number
    maxItems?         : number
    uniqueItems?      : boolean
    minProperties?    : number
    maxProperties?    : number
    minContains?      : number
    maxContains?      : number
    custom?           : string
    default?          : string | number | boolean | null
    tags?             : string[]
}

type Split<S extends string, D extends string> =
    S extends `${infer T}${D}${infer U}`
        ? [ T, ...Split<U, D> ]
        : [ S ];

type ApplyModifierLeaf<V, Modifiers> =
    IsAny<V> extends true
        ? V & Modifiers
        : [ Exclude<V, null | undefined> ] extends [ never ]
            ? V & Modifiers
            : ( Exclude<V, null | undefined> & Modifiers ) | Extract<V, null | undefined>;

type ModifierPathTuple<T, Path extends string[], Modifiers> =
    Path extends [ infer Key, ...infer Rest ]
        ? Key extends keyof T
            ?
            {
                [P in keyof T]: P extends Key
                    ? Rest extends string[]
                        ? Rest['length'] extends 0
                            ? ApplyModifierLeaf<T[P], Modifiers>
                            : ModifierPathTuple<Exclude<T[P], null | undefined>, Rest, Modifiers> | Extract<T[P], null | undefined>
                        : T[P]
                    : T[P]
            }
            : T
        : T;

type UnionToIntersection<U> =
    ( U extends any ? ( k: U ) => void : never ) extends (( k: infer I ) => void ) ? I : never;
type LastOf<U> =
    UnionToIntersection<U extends any ? ( f: U ) => void : never> extends (( a: infer A ) => void ) ? A : never;
type Push<T extends any[], V> = [ ...T, V ];
type TuplifyUnion<U, L = LastOf<U>> =
    [ U ] extends [ never ] ? [] : Push<TuplifyUnion<Exclude<U, L>>, L>;

type Entries<M> =
    {
        [K in keyof M]: [ K, M[K] ]
    }[keyof M];

type ApplyModifiers<T, EntriesList extends any[]> =
    EntriesList extends [ [ infer Path, infer Modifiers ], ...infer Rest ]
        ? Path extends string
            ? ApplyModifiers<ModifierPathTuple<T, Split<Path, '.'>, Modifiers>, Rest>
            : T
        : T;

/**
 * Utility type to decorate nested properties of a type with validation/transform modifiers without retyping the structure.
 */
export type WithModifiers<T, M> = ApplyModifiers<T, TuplifyUnion<Entries<M>>>;

type IsAny<T> = 0 extends 1 & T ? true : false;

type AmbientBuffer =
    typeof globalThis extends { Buffer : abstract new ( ...args: any ) => infer B }
        ? B
        : never;

type AmbientBlob =
    typeof globalThis extends { Blob : abstract new ( ...args: any ) => infer B }
        ? B
        : never;

type AmbientFile =
    typeof globalThis extends { File : abstract new ( ...args: any ) => infer F }
        ? F
        : never;

type BuiltInLeafTypes =
    | Date | globalThis.URL | RegExp | Promise<any> | ReadonlyMap<any, any> | ReadonlySet<any>
    | ArrayBuffer | SharedArrayBuffer | DataView | AmbientBuffer | AmbientBlob | AmbientFile
    | Int8Array | Uint8Array | Uint8ClampedArray
    | Int16Array | Uint16Array | Int32Array | Uint32Array
    | Float32Array | Float64Array | BigInt64Array | BigUint64Array
    | symbol | string | number | boolean | bigint | null | undefined | Function
    | ( abstract new ( ...args: any ) => any );

type HasDefaultProp<V> =
    IsAny<V> extends true
        ? false
        : [ NonNullable<V> ] extends [ never ]
            ? false
            : '__default' extends keyof NonNullable<V>
                ? true
                : false;

type HasReadOnlyProp<V> =
    IsAny<V> extends true
        ? false
        : [ NonNullable<V> ] extends [ never ]
            ? false
            : '__readonly' extends keyof NonNullable<V>
                ? true
                : false;

type HasWriteOnlyProp<V> =
    IsAny<V> extends true
        ? false
        : [ NonNullable<V> ] extends [ never ]
            ? false
            : '__writeonly' extends keyof NonNullable<V>
                ? true
                : '__secret' extends keyof NonNullable<V>
                    ? true
                    : false;

/**
 * Recursively resolves object properties, removing the optional `?` modifier 
 * from any properties that have a `tag.Default` applied.
 */
export type ResolveDefaults<T> = T extends BuiltInLeafTypes
    ? T
    : T extends readonly unknown[]
        ? { [K in keyof T]: ResolveDefaults<T[K]> }
        : T extends object
            ? ({ [K in keyof T as K]: T[K] } extends T
                ?
                {
                    [K in keyof T as HasDefaultProp<T[K]> extends true ? K : never]-?: ResolveDefaults<Exclude<T[K], undefined>>
                }
                &
                {
                    [K in keyof T as HasDefaultProp<T[K]> extends true ? never : K]: ResolveDefaults<T[K]>
                } extends infer O
                    ? { [K in keyof O]: O[K] }
                    : never
                : T )
            : T;

/**
 * Output type of `parse<T>()`: applies `ResolveDefaults<T>` while omitting `tag.ReadOnly`
 * properties that do not carry a `tag.Default`.
 */
export type ParseOutput<T> = T extends BuiltInLeafTypes
    ? T
    : T extends readonly unknown[]
        ? { [K in keyof T]: ParseOutput<T[K]> }
        : T extends object
            ? ({ [K in keyof T as K]: T[K] } extends T
                ?
                {
                    [K in keyof T as HasDefaultProp<T[K]> extends true ? K : never]-?: ParseOutput<Exclude<T[K], undefined>>
                }
                &
                {
                    [K in keyof T as HasDefaultProp<T[K]> extends true
                        ? never
                        : HasReadOnlyProp<T[K]> extends true
                            ? never
                            : K]: ParseOutput<T[K]>
                } extends infer O
                    ? { [K in keyof O]: O[K] }
                    : never
                : T )
            : T;

/**
 * Input type accepted by `stringify<T>()` / `serializer<T>()`: makes `tag.WriteOnly` and
 * `tag.Secret` properties optional so objects loaded without write-only fields serialize cleanly.
 */
export type SerializeInput<T> = T extends BuiltInLeafTypes
    ? T
    : T extends readonly unknown[]
        ? { [K in keyof T]: SerializeInput<T[K]> }
        : T extends object
            ? ({ [K in keyof T as K]: T[K] } extends T
                ?
                {
                    [K in keyof T as HasWriteOnlyProp<T[K]> extends true ? K : never]?: SerializeInput<T[K]>
                }
                &
                {
                    [K in keyof T as HasWriteOnlyProp<T[K]> extends true ? never : K]: SerializeInput<T[K]>
                } extends infer O
                    ? { [K in keyof O]: O[K] }
                    : never
                : T )
            : T;
