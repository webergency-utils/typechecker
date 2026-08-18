# Parse / stringify `reviver`, `replacer`, and `transform`

## Status

++Type-level++ `tag<'html'>` ++/++ `tag<'html' | 'basic'>` ++is already shipped (optional++ `__tags` ++bag, peeled, JSON Schema++ `x-tags`++). No runtime behaviour yet.++

++This plan adds JSON/query hooks and a typed++ `transform` ++walk. No++ `class Tag`++,++ `defineTag`++,++ `Handler.parse`++, or process-global registry.++

## ++Goals++

- Custom `JSON.parse` reviver on `parse` (same contract as ECMA-262).
- Same reviver contract on query bags (no native API; we walk the object).
- Offset all `Date`s (and any type × path × tag combination) on parse / stringify without tagging every field.
- JSON `replacer` on stringify, with the same ECMA contract as `JSON.stringify`.



## Non-goals (v1)

- Query `replacer` (no standard; typed `transform` runs before query encode).
- `from: 'string'` reviver (one scalar, no tree).
- `transform` on `is` / `assertGuard` (in-place + root replacement).
- Handler class / path matchers / `when` predicates.



## API

```typescript
parse<T>( input, {
    from?      : 'json' | 'query' | 'string'
    mode?      : ValidationMode
    reviver?   : ( key: string, value: any ) => any
    transform? : TransformFn | TransformFn[]
})

stringify<T>( input, {
    format?    : 'json' | 'query'
    replacer?  : ( key: string, value: any ) => any   // JSON only
    transform? : TransformFn | TransformFn[]
})

serializer<T>({ format?, replacer?, transform? })  // closed over at create time

assert<T> / validate<T>( input, { transform? })    // opt-in; not for date-offset by default
```

```typescript
type TransformFn = ( value: unknown, ctx: TransformContext ) => unknown

interface TransformContext
{
    key    : string
    path   : string
    parent : any
    root   : any
    index? : number
    tags   : string[]       // from tag<'html'>, else []
    type   : CoercionKind   // 'Date' | 'string' | … ; unions / any are best-effort
}
```

`mode` / `from` / `format` stay compile-time object literals. `reviver` / `replacer` / `transform` are runtime and must be forwarded into the hoisted function.

## Pipelines

**parse** `from: 'json'`

```
JSON text → expectString → JSON.parse(text)
  → optional reviveTree(reviver)
  → type revival (ISO → Date, …)
  → transform option (fn or fn[] in order)
  → transform.* tags
  → constraints
```

Non-strings throw `Type<string>`. Unquoted scalars are Invalid JSON.

**parse** `from: 'query'`

```
query text → expectString → parseQueryString
  → optional reviveTree(reviver)
  → type revival
  → transform option
  → transform.* tags
  → constraints
```

Non-strings throw `Type<string>`. A leading `?` throws `Invalid query`. `'42'` is a flag-key, not a number.

**parse** `from: 'string'`**:** no reviver; type revival → `transform` → tags → constraints.

**stringify JSON:** `transform` → encode; `replacer` is passed to `JSON.stringify` (Dates are ISO strings *inside* the replacer — do not offset dates there).

**stringify query:** `transform` → query encode. No replacer.

## Reviver contract

Identical to `JSON.parse`: `(key, value) => any`, bottom-up, root `key === ''`, `this` is the parent, `undefined` deletes the property. Values at this layer are still JSON/query shapes (query values are strings).

The same `reviver` function can be passed to json and query.

## `transform` contract

- Returned value **replaces** the node.
- Returning `undefined` sets undefined (does not mean “skip”). Unchanged → `return value`.
- `fn[]` pipes left to right.
- Throws become `ParseError` / `SerializationError` with `ctx.path` (or `''` at root).
- First typed rewrite after revival, before `transform.*`.
- Stringify: runs before encode so `ctx.type === 'Date'` still sees a `Date`.

Date offset belongs here, not in `replacer`:

```typescript
parse<Event>( json, { transform : shiftDates( +ms ) });
stringify<Event>( event, { transform : shiftDates( -ms ) });
```

Type × path × tag in the same function via `ctx.type`, `ctx.path`, `ctx.tags`. `ctx.tags` is empty unless the field has `tag<'html'>`.

## Improvements in scope

These are required, not polish.

1. **String-only parse input** — `parse` always takes a string (`JSON.parse` / `parseQueryString`). Already-parsed JSON objects and query bags belong on `assert` / `validate`.
2. `transform` **as** `fn | fn[]` — compose `[shiftDates(+ms), sanitizeTagged]` without one mega-callback.
3. **Path-aware errors** — thrown `reviver` / `transform` wrap as `ParseError` / `SerializationError` with path.
4. **Return contract** — reviver `undefined` deletes (JSON spec); transform `undefined` replaces with undefined; identity is `return value`.
5. `serializer<T>({ transform, replacer })` — close over at create time; `stringify` takes the same options per call.
6. **No** `transform` **on** `is` **/** `assertGuard` — keep skipped. `assert` / `validate` may take `transform` opt-in.



## Implementation sketch

- Shared `reviveTree(value, reviver)` matching ECMA `InternalizeJSONProperty` (arrays use string index keys).
- Parse generator: forward runtime `{ reviver, transform }` into `__parse_*(input, options)`; `expectString` then `JSON.parse(text)` for json / `parseQueryString` for query (leading `?` is `Invalid query`); `reviveTree` when `reviver` is set.
- Serializer / stringify: apply `transform` per node (need `tags` + `type` from the existing peel/walk); JSON path passes `replacer` into stringify; query path unchanged except transform.
- Validator (`assert` / `validate`): optional `transform` on `ValidationContext`; emit a call at each node after revival, before `transform.*`.
- Export `TransformContext` / `TransformFn` from the package root.



## Tests

- JSON reviver: JSON text only; delete-on-undefined; root key `''`.
- Query reviver: encoded string that never starts with `?`; same delete/root behaviour.
- `from: 'string'` ignores `reviver`.
- Date offset via `transform` on parse + stringify (JSON and query); `replacer` must not be required for that.
- `ctx.tags` from `tag<'html' | 'basic'>`; empty on untagged fields.
- `transform[]` order; throw → `ParseError` / `SerializationError` with path.
- `serializer<T>({ transform })` closed over; `stringify` per-call options.
- `assert` / `validate` with `transform`; `is` / `assertGuard` unchanged.
- `tag.Default` still fills when the node is undefined (reviver/transform skip undefined before default, as locked).

