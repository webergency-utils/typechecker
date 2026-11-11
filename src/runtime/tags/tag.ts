/**
 * Named metadata bag. `tag<'html'>` or `tag<'html' | 'basic'>` (and `tag<'html'> & tag<'basic'>`)
 * store the names on `__tags` so the transformer can peel them. No runtime behaviour yet.
 */
export type tag<Names extends string> =
    {
        readonly __tags? : { [K in Names]?: true }
    };

/**
 * Universal constraint tag utility.
 * Attaches phantom constraint `__[C]` and optional message `__[C]_message`.
 * Example: `type Age = Tag<number, 'minimum', 18, 'Must be at least 18'>;`
 */
export type Tag
<
    T,
    C   extends string,
    V   = true,
    Msg extends string = string
>
    =
        T
        & {
            readonly [K in `__${C}` | `__${C}_message`]? : K extends `__${C}` ? V : Msg
        };

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace tag
{
    export type Default<V = any> = { readonly __default? : V };

    /** Marks a property as server-generated: emitted by `stringify<T>()`, rejected/stripped on incoming `parse<T>()`, and marked `{ readOnly: true }` in `jsonSchema<T>()`. */
    export type ReadOnly = { readonly __readonly? : true };

    /** Marks a property as input-only: validated on incoming `parse<T>()`, omitted by `stringify<T>()`, and marked `{ writeOnly: true }` in `jsonSchema<T>()`. */
    export type WriteOnly = { readonly __writeonly? : true };

    /** Marks a property as sensitive: omitted by `stringify<T>()`, marked `{ writeOnly: true, "x-secret": true }` in `jsonSchema<T>()`, and redacted from validation error payloads. */
    export type Secret = { readonly __secret? : true };

    export type Tag<Names extends string> = tag<Names>;
}

