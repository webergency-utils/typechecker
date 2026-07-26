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

## Anti-Patterns
- Avoid mutating global configuration or state shared between tests.
- Do not check internal private methods of validators.
- Do not assume Set/Map type-argument validators share a hash — assert distinct hashes when covering caching.

## Mocking Conventions
- Use `vi.fn()` for callback/custom function verification when mocking is required.
