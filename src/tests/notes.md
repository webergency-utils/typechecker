# Testing Notes

## Rules
- Tests must be executed using Vitest.
- Always isolate tests using beforeEach/afterEach and avoid shared states across tests.
- Keep tests clean and well-structured following the AAA (Arrange, Act, Assert) pattern.
- `number` accepts Infinity/-Infinity but rejects NaN (`Number.isNaN`).
- `is` / `assertGuard` never coerce (`from` is ignored); use `assert` / `validate` for coercion.
- Object/record validators require plain objects (reject Date/Map/Set/RegExp/typed arrays/class instances).
- `mutate` defaults to false (always new containers). `mutate: true` writes onto the input, including strip (deletes extras in place).
- Default validation is strict (no conversion). Use `from: 'json'` for wire revivals (Date/RegExp/bigint/Set/Map), `from: 'query'` for querystring coercions, or a custom `from` function on type mismatch only.
- Function types validate with `typeof === 'function'`. Native enums compile to literal unions.
- Map json revival requires a plain object (rejects Date/RegExp/etc.).
- `validators.object` returns the (possibly converted) object, or `false` when the value is not a plain object.
- `transform.ToNumber` / `ToBoolean` / `ToDate` use the same helpers as `from: 'query'` (`coerceQueryNumber` / `Boolean` / `Date`).
- Register `@webergency-utils/typechecker/transformer` (not the package root) in tsconfig plugins. Optional IDE plugin: `@webergency-utils/typechecker/plugin`.
- Object shapes require plain objects. Named props + string index signatures validate both required fields and additional keys.
- `jsonSchema` uses `x-typescript-type` for Set/Map/bigint/undefined/Date/etc.; object intersections emit `allOf` (or a merged object).
- Failed unions report **one** top-level error with per-arm failures in `error.issues`. `toZodIssues` / `groupErrorsByPath` flatten nested `issues`.
- Prefer `MetadataStore.getOrCompileSchema` for JSON-Schema → runtime validator branches (`Promise`, typed arrays, `anyOf`/`allOf`, `$ref`, `const`, `additionalProperties`).
- `allOf` preserves caller mode (including `strip`); do not assert closed-member allOf + strip merges named props across arms — each arm validates independently and can strip the other arm’s keys.
- Plain-object guards reject `Buffer`, `ArrayBuffer`, and typed-array views; null-prototype objects are accepted.
- Custom `from` receives `(key, value, BaseType)` and runs once on type mismatch for containers (Array/Set/Map/object) as well as primitives.
- Place branch-focused suites at `src/tests/{unit}.test.ts` (e.g. `compile-schema.test.ts`, `validators-branches.test.ts`), never next to source.
- Format edge cases worth explicit tests: email/idn-email length limits (254 / local 64), URI/IRI `URL` constructor fallbacks (`http://`), empty uri/iri-reference, uri-template unmatched `}`.
- `MetadataStore.is|assert|assertGuard|validate` accept a string `ValidationMode` (`'strict' | 'relaxed' | 'strip'`) as well as options objects.
- Do not chase coverage for unreachable arms: `fromCustom` when `ctx.from` is not a function (all callers guard), `parseFormatDateTime` non-string (format always passes strings), and `resolvePath`’s `dotsMatch` else (paths that reach it always start with `.`).

## Anti-Patterns
- Avoid mutating global configuration or state shared between tests.
- Do not check internal private methods of validators.
- Do not assume Set/Map type-argument validators share a hash — assert distinct hashes when covering caching.
- Do not treat `allOf` of two closed object schemas as a merged shape under `strip` / `mutate`.
- Do not invent private-API hooks solely to cover defensive dead branches in helpers.

## Mocking Conventions
- Use `vi.fn()` for callback/custom function verification when mocking is required.
- Prefer observing `from` / transform callbacks at the Test Seam over stubbing validator internals.
- For anonymous `validators.custom` failure labels, clear `fn.name` (empty string) so the error is `Custom` rather than `Custom<name>`.
