# Testing Notes

## Rules
- Tests must be executed using Vitest.
- Always isolate tests using beforeEach/afterEach and avoid shared states across tests.
- Keep tests clean and well-structured following the AAA (Arrange, Act, Assert) pattern.
- `number` accepts Infinity/-Infinity but rejects NaN (`Number.isNaN`).
- `is` / `assertGuard` always mutate. `from` is allowed for in-place nested coercion; root replacement (`res !== input`, e.g. primitive `"42"`→`42`) fails the guard (`false` / normal type error). Use `assert` / `validate` when you need a new root value.
- Object/record validators require plain objects (reject Date/Map/Set/RegExp/typed arrays/class instances).
- `mutate` on `validate` / `assert` defaults to false (always new containers). `mutate: true` writes in place while validating (same as `is` / `assertGuard`); half-changed input on failure is allowed. Union arms always use a side tree and commit only the winning arm. `allOf` members still validate without mutating the shared input.
- Default validation is strict (no conversion). `mode` is unknown-key policy only: `strict` reject extras, `relaxed` keep extras (no coerce), `strip` drop extras. Coercion is only via `from` (`'json'` / `'query'` / custom) — never via `mode` / `relaxed`.
- Use `from: 'json'` for wire revivals (Date/RegExp/bigint/Set/Map), `from: 'query'` for querystring coercions (including scalar→`[scalar]` for arrays and scalar→`Set`), or a custom `from` function on type mismatch only.
- Function types validate with `typeof === 'function'`. Native enums compile to literal unions.
- Map json revival requires a plain object (rejects Date/RegExp/etc.).
- `validators.object` returns the (possibly converted) object, or `false` when the value is not a plain object.
- `transform.ToNumber` / `ToBoolean` / `ToDate` use the same helpers as `from: 'query'` (`coerceQueryNumber` / `Boolean` / `Date`). Number coercion requires a complete finite decimal/scientific string.
- Register `@webergency-utils/typechecker/transformer` (not the package root) in tsconfig plugins. Optional IDE plugin: `@webergency-utils/typechecker/plugin`.
- Object shapes require plain objects. Named props + string index signatures validate both required fields and additional keys.
- `jsonSchema` uses `x-typescript-type` for Set/Map/bigint/undefined/Date/etc.; object intersections emit `allOf` (or a merged object).
- Failed unions report **one** top-level error with per-arm failures in `error.issues`. `toZodIssues` / `groupErrorsByPath` flatten nested `issues`.
- Prefer `MetadataStore.getOrCompileSchema` / `validateSchema` (and `isSchema` / `assertSchema` / `assertGuardSchema`) for JSON-Schema → runtime validator paths. Do not put `schema` on `ValidationOptions`.
- Transformer registers validators only for `is`/`assert`/`assertGuard`/`validate`, and schemas only for `jsonSchema` (not both for every call).
- Closed-object AOT/schema key lists are `Set`s; `validators.safeRegExp` marks patterns as vetted so `pattern()` skips repeated safety scans.
- `allOf` validates members without mutating, then applies `strict` / `strip` to the combined object-key set and commits only on success.
- Microbench: `node scripts/perf-microbench.mjs` (after `npm run build`).
- Plain-object guards reject `Buffer`, `ArrayBuffer`, and typed-array views; null-prototype objects are accepted.
- Custom `from` is `(val, { key, path, parent, root, index?, kind: CoercionKind }) => any` on type mismatch. `kind` is a dispatch tag, not `typeof`. `key` is the nearest named path segment (array index leaves use the closest named key above). Same `PathContext` fields as `constraint.Custom`.
- `constraint.Custom` receives `(val, PathContext)` including `key`.
- Place branch-focused suites at `src/tests/{unit}.test.ts` (e.g. `compile-schema.test.ts`, `validators-branches.test.ts`), never next to source.
- Format edge cases worth explicit tests: email/idn-email length limits (254 / local 64), URI/IRI `URL` constructor fallbacks (`http://`), empty uri/iri-reference, uri-template unmatched `}`.
- `MetadataStore.is` → `GuardOptions`; `assertGuard` → `AssertGuardOptions`; `validate` → `ValidationOptions`; `assert` → `AssertOptions`. All accept a string `ValidationMode` as well.
- Do not chase coverage for unreachable arms: `fromCustom` when `ctx.from` is not a function (all callers guard), `parseFormatDateTime` non-string (format always passes strings), and `resolvePath`’s `dotsMatch` else (paths that reach it always start with `.`).

## Anti-Patterns
- Avoid mutating global configuration or state shared between tests.
- Do not check internal private methods of validators.
- Do not assume Set/Map type-argument validators share a hash — assert distinct hashes when covering caching.
- Do not allow an `allOf` member or a failed union arm to mutate or strip the shared input before a successful branch commits.
- Do not invent private-API hooks solely to cover defensive dead branches in helpers.

## Mocking Conventions
- Use `vi.fn()` for callback/custom function verification when mocking is required.
- Prefer observing `from` / transform callbacks at the Test Seam over stubbing validator internals.
- For anonymous `validators.custom` failure labels, clear `fn.name` (empty string) so the error is `Custom` rather than `Custom<name>`.

## Coverage Scope
- Vitest coverage includes `src/runtime/**`, `src/engine/**` (except `resolver.ts`), `src/transformer.ts`, `src/plugin.ts`, and `src/index.ts` (tags type-only modules excluded).
- Thresholds: lines/functions ≥ 99%, statements ≥ 98%, branches ≥ 96%.
- `resolver.ts` is excluded from coverage totals: it is a TypeScript checker/AST walker with many compiler-type edge branches. Cover observable paths via transformer / `resolver-coverage` / `objectToAst` tests instead of forcing private-hook coverage.
- Engine units: print AST via a local `stripPositions` helper before `ts.createPrinter` — nodes keep source positions from `templateToAst` and otherwise print empty literals.
- Prefer unit-testing `generators` / `hoister` / `objectToAst` at their exports; use the transformer compile harness for resolver/jsonSchema integration paths.
- Plugin tests mock `ts.server.PluginCreateInfo` / `LanguageService`; assert early-return seams (`node_modules`, `.d.ts`, missing program).
- Error-capture suites live in `error-capture-matrix.test.ts` (schema/union/recursive-style failures) and `validators-unique-and-commit.test.ts` (uniqueItems/commit/regex edges).
- Never spread `ValidationContext` into a shallow copy before calling validators — `success` is a boolean copied by value while `errors` stays shared, so arm failure can be lost.
