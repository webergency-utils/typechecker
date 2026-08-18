/**
 * Named metadata bag. `tag<'html'>` or `tag<'html' | 'basic'>` (and `tag<'html'> & tag<'basic'>`)
 * store the names on `__tags` so the transformer can peel them. No runtime behaviour yet.
 */
export type tag<Names extends string> =
{
    readonly __tags? : { [K in Names]?: true }
};

export namespace tag
{
    export type Default<V = any> = { readonly __default? : V };

    export type Tag<Names extends string> = tag<Names>;
}
