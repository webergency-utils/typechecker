/**
 * Validation Tags for AOT Typechecker
 * These are used in intersection types to add constraints.
 * Example: type Password = string & MinLength<8>;
 */

// Export root-level tags for backward compatibility
export * from './tags/constraint.js';

// Export namespace-like modules
export * as constraint from './tags/constraint.js';
export * as tag from './tags/tag.js';
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
    custom?           : string
    default?          : string | number | boolean | null
}

type Split<S extends string, D extends string> =
    S extends `${infer T}${D}${infer U}`
        ? [ T, ...Split<U, D> ]
        : [ S ];

type ModifierPathTuple<T, Path extends string[], Modifiers> =
    Path extends [ infer Key, ...infer Rest ]
        ? Key extends keyof T
            ?
            {
                [P in keyof T]: P extends Key
                    ? Rest extends string[]
                        ? Rest['length'] extends 0
                            ? T[P] & Modifiers
                            : ModifierPathTuple<Exclude<T[P], undefined>, Rest, Modifiers> | ( undefined extends T[P] ? undefined : never )
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

/**
 * Recursively resolves object properties, removing the optional `?` modifier 
 * from any properties that have a `tag.Default` applied.
 */
export type ResolveDefaults<T> = T extends
    | Date | RegExp | Promise<any> | Map<any, any> | Set<any>
    | ArrayBuffer | SharedArrayBuffer | DataView | Buffer
    | Int8Array | Uint8Array | Uint8ClampedArray
    | Int16Array | Uint16Array | Int32Array | Uint32Array
    | Float32Array | Float64Array | BigInt64Array | BigUint64Array
    | symbol | string | number | boolean | bigint | null | undefined | Function
    ? T
    : T extends Array<infer U>
        ? Array<ResolveDefaults<U>>
        : T extends object
            ?
            {
                [K in keyof T as IsAny<T[K]> extends true ? never : '__default' extends keyof NonNullable<T[K]> ? K : never]-?: ResolveDefaults<Exclude<T[K], undefined>>
            }
            &
            {
                [K in keyof T as IsAny<T[K]> extends true ? K : '__default' extends keyof NonNullable<T[K]> ? never : K]: ResolveDefaults<T[K]>
            } extends infer O
                ? { [K in keyof O]: O[K] }
                : never
            : T;
