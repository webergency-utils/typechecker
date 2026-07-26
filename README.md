# @webergency-utils/typechecker

[![npm version](https://img.shields.io/npm/v/%40webergency-utils%2Ftypechecker)](https://www.npmjs.com/package/@webergency-utils/typechecker) [![Maintenance](https://img.shields.io/badge/maintenance-active-brightgreen.svg)](#maintenance) [![npm downloads](https://img.shields.io/npm/dm/%40webergency-utils%2Ftypechecker)](https://www.npmjs.com/package/@webergency-utils/typechecker) [![License](https://img.shields.io/npm/l/%40webergency-utils%2Ftypechecker)](https://www.npmjs.com/package/@webergency-utils/typechecker)

An ahead-of-time (AOT) type validation engine and TypeScript compiler plugin that compiles TypeScript types directly into optimized runtime validation functions. It intercepts type definitions at build time to enforce value constraints, formatting, and defaults with zero runtime reflection and no third-party schema dependencies.

## TL;DR

```typescript
import { validate, constraint, format } from '@webergency-utils/typechecker';

interface User {
  id: string & format.UUID;
  name: string & constraint.MinLength<2>;
  age: number & constraint.Minimum<18>;
}

const input: unknown = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Alice',
  age: 25,
};

// Validate input against the User type definition
const result = validate<User>(input);

if (result.success) {
  // TypeScript narrows type to User here
  console.log('User is valid:', result.data);
} else {
  console.error('Validation failed:', result.errors);
}
```

## Installation & Setup

Since this package is a TypeScript compiler plugin (transformer), you must compile your project using a compiler patcher like `ts-patch` to hook into TS compilation.

### 1. Install Dependencies

Install the core package, along with `ts-patch` as a development dependency:

```bash
npm install @webergency-utils/typechecker
npm install --save-dev ts-patch
```

### 2. Inject Compiler Hook

Run the patcher command to set up `ts-patch` inside your local TypeScript installation:

```bash
npx ts-patch install
```

> [!NOTE]
> It is recommended to add `ts-patch install` to your `package.json` `prepare` script so it runs automatically after every dependency installation.

### 3. Configure tsconfig.json

Register the typechecker **transformer** (and optionally the language service plugin) under `compilerOptions.plugins` in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "plugins": [
      { "transform": "@webergency-utils/typechecker/transformer" },
      { "name": "@webergency-utils/typechecker/plugin" }
    ]
  }
}
```

The `transform` entry is required for AOT validation. The `name` entry enables IDE constraint diagnostics via the language service plugin.
---

## Architecture & Internals

The package utilizes a custom TypeScript compiler transformer and language service plugin to deliver highly efficient type-safe runtime validations.

### Build-Time Compilation Flow

```mermaid
graph TD
    A[TypeScript Source Code] --> B[ts-patch / Compiler Hook]
    B --> C[TypeScript compiler plugin / Transformer]
    C --> D[Extract types via compiler TypeChecker]
    D --> E[Generate optimized JS validator function]
    E --> F[Hoisted Validator Registry & MetadataStore registration]
    F --> G[Replace source call with MetadataStore invocation]
    G --> H[Emit optimized JavaScript files]
```

1. **Build-Time Transformation**: The compiler transformer intercepts calls to validation helper functions (`validate`, `is`, `assert`, `assertGuard`, `jsonSchema`) containing generic arguments.
2. **Type Extraction & Analysis**: It parses the target TS type structure, extracting intersection constraints, formats, transforms, and defaults recursively.
3. **Hoisted Registry**: The transformer generates highly optimized, direct JavaScript validator functions for each resolved type shape, generates a unique hash, and registers them in a global `MetadataStore`.
4. **Call Replacement**: The transformer replaces the original compile-time call expressions with direct, zero-reflection references to the runtime `MetadataStore`.

### Static Constraint Diagnostics

The package includes an IDE / Language Service plugin that statically checks literal values against type constraints during editing or compilation:

```typescript
import { constraint } from '@webergency-utils/typechecker';

// This yields a compilation error directly in the IDE:
// Type '5' is not assignable to type 'number & Minimum<18>'.
const age: number & constraint.Minimum<18> = 5;
```

---

## Glossary

- [`validate`](src/index.ts): Validates a value against a type, returning a structured result containing the validation status and a detailed list of errors.
- [`is`](src/index.ts): A type guard function that returns `true` if a value is valid, narrowing its type for TypeScript.
- [`assert`](src/index.ts): Validates a value and returns it, throwing a validation error on failure.
- [`assertGuard`](src/index.ts): A type assertion function that throws if a value does not match the target type, narrowing the type in the outer scope.
- [`jsonSchema`](src/index.ts): Generates and returns a JSON Schema representation matching a TypeScript type at compile time (draft-07 shaped, with `x-typescript-type` for Date/RegExp/Set/Map/bigint/etc.).
- [`WithModifiers`](src/runtime/tags.ts): A utility type that applies constraint, format, or transformation tags to properties of deeply nested or external types using dot-separated path mappings.
- [`ResolveDefaults`](src/runtime/tags.ts): A helper type that removes the optional flag (`?`) from properties that have defined default values.
- [`convertPropertyCasing`](src/runtime/casing.ts): A runtime utility to recursively change the casing of object keys.
- [`toZodIssues`](src/runtime/validators.ts): Utility to transform internal typechecker validation errors into Zod-compatible issue structures.
- [`ZodLikeError`](src/runtime/validators.ts): Error class wrapping validation errors in a structure compatible with libraries expecting Zod errors.

---

## API Reference

### Validation Functions

#### `validate<T>(input: unknown, options?: ValidationMode | ValidationOptions): IValidation<ResolveDefaults<T>>`

Validates input data against type `T` and returns a structured validation result.

- **Parameters**:
  - `input`: The value to validate.
  - `options` (optional): Either a `ValidationMode` string ('strict' | 'relaxed' | 'strip') or a `ValidationOptions` object.
- **Returns**: `IValidation<ResolveDefaults<T>>` containing validation status, converted/stripped data, and error details.
- **Example**:
  ```typescript
  const result = validate<User>(data, 'strip');
  ```

#### `is<T>(input: unknown, options?: ValidationMode | ValidationOptions): input is ResolveDefaults<T>`

A type guard function checking if the input matches type `T`.

- **Parameters**:
  - `input`: The value to check.
  - `options` (optional): Either a `ValidationMode` string or a `ValidationOptions` object.
- **Returns**: `boolean` (`true` if valid, `false` otherwise). Narrows type of `input` to `ResolveDefaults<T>` on success.
- **Example**:
  ```typescript
  if (is<User>(data)) {
    console.log(data.name);
  }
  ```

#### `assert<T>(input: unknown, options?: ValidationMode | ValidationOptions): ResolveDefaults<T>`

Validates input data and returns it, throwing a validation error on failure.

- **Parameters**:
  - `input`: The value to validate.
  - `options` (optional): Either a `ValidationMode` string or a `ValidationOptions` object.
- **Returns**: `ResolveDefaults<T>` (the validated value with defaults resolved).
- **Throws**: `Error` containing a list of path and constraint failures, or a custom error via `options.errorFactory`.
- **Example**:
  ```typescript
  const user = assert<User>(data);
  ```

#### `assertGuard<T>(input: unknown, options?: ValidationMode | ValidationOptions): asserts input is ResolveDefaults<T>`

An assertion guard that throws a validation error if the input does not match type `T`.

- **Parameters**:
  - `input`: The value to check.
  - `options` (optional): Either a `ValidationMode` string or a `ValidationOptions` object.
- **Returns**: `void`. Narrows the type of `input` in the enclosing scope on success.
- **Throws**: `Error` if validation fails.
- **Example**:
  ```typescript
  assertGuard<User>(data);
  ```

#### `jsonSchema<T>(): any`

Generates a raw JSON Schema draft-07 object matching type `T` at compile time.

- **Returns**: `any` (a JSON Schema object).
- **Example**:
  ```typescript
  const userSchema = jsonSchema<User>();
  ```

---

### Utility Functions and Classes

#### `convertPropertyCasing<T, C extends CasingFormat>(obj: T, casing: C, options?: ConvertCasingOptions): ConvertPropertyCasing<T, C>`

Recursively converts all property keys of an object to the specified casing format.

- **Parameters**:
  - `obj`: The source object.
  - `casing`: A `CasingFormat` string value (`'snake_case' | 'SNAKE_CASE' | 'camelCase' | 'camelCaseID' | 'PascalCase' | 'PascalCaseID' | 'kebab-case' | 'dot.case'`).
  - `options` (optional): `ConvertCasingOptions` object.
- **Returns**: The casing-converted object with updated TypeScript property keys.
- **Example**:
  ```typescript
  const apiResponse = convertPropertyCasing(user, 'camelCase');
  ```

#### `toZodIssues(errors: IValidationError[]): any[]`

Converts internal validation errors into Zod-compatible issues.

- **Parameters**:
  - `errors`: Array of `IValidationError`.
- **Returns**: An array of Zod-like issues.

#### `class ZodLikeError extends Error`

An error class wrapper that transforms internal validation errors into a Zod-like error structure.

- **Constructor**: `constructor(errors: IValidationError[])`
- **Properties**:
  - `name`: `'ZodError'`
  - `issues`: Zod-like issue array.

---

### Interfaces and Types

#### `interface ValidationOptions`

Configuration options to customize validator behavior.

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `mode` | `'strict' \| 'relaxed' \| 'strip'` | `'strict'` | Validation mode strategy (strict key checking, relaxed, or key stripping). |
| `from` | `'json' \| 'query' \| ((key, value, type) => any)` | `undefined` | Input conversion mode. `'json'` revives JSON-impossible types (Date, RegExp, bigint, Set, Map). `'query'` also coerces querystring shapes (string→number/boolean, timestamps→Date, etc.). A function is called only on type mismatch. |
| `wrapArrays` | `boolean` | `false` | Wraps non-array values into single-element arrays if an array is expected. |
| `mutate` | `boolean` | `false` | When true, write validated/coerced values onto the input. Default false: always return new containers. |
| `schema` | `any` | `undefined` | Custom JSON Schema instance. |
| `errorFactory` | `(errors: IValidationError[]) => Error` | `undefined` | Custom error factory for `assert` throwing. |

#### `interface IValidation<T>`

Result object returned by `validate`.

- `success`: `boolean`
- `data?`: `T`
- `errors?`: `IValidationError[]`

#### `interface IValidationError`

Details of a validation check failure.

- `path`: `string`
- `value`: `any`
- `error`: `string` (the constraint description or custom message)
- `issues?`: `IValidationError[]` — nested failures (used for unions: one summary error with per-arm details)

#### `type WithModifiers<T, M>`

Applies constraint, format, or transformation tags to properties of type `T` using a path mapping `M`.

- **Generics**:
  - `T`: The baseline type to wrap.
  - `M`: A key-value map where keys are dot-separated paths (e.g., `'profile.email'`) and values are tags.

---

### Tags & Modifiers

#### `constraint` Namespace

Used to apply value constraints to types.

| Tag | Description |
| :--- | :--- |
| `constraint.MinLength<N, Msg?>` | Restricts string length to $\ge N$. |
| `constraint.MaxLength<N, Msg?>` | Restricts string length to $\le N$. |
| `constraint.Length<Min, Max>` | Shorthand for `MinLength<Min> & MaxLength<Max>`. |
| `constraint.Pattern<Regex, Msg?>` | Validates string using regular expression `Regex`. |
| `constraint.Minimum<N, Msg?>` | Inclusive minimum value restriction for `number | bigint`. |
| `constraint.Maximum<N, Msg?>` | Inclusive maximum value restriction for `number | bigint`. |
| `constraint.Range<Min, Max>` | Shorthand for `Minimum<Min> & Maximum<Max>`. |
| `constraint.ExclusiveMinimum<N, Msg?>` | Exclusive minimum value restriction for `number | bigint`. |
| `constraint.ExclusiveMaximum<N, Msg?>` | Exclusive maximum value restriction for `number | bigint`. |
| `constraint.MultipleOf<N, Msg?>` | Restricts `number | bigint` to multiples of `N`. |
| `constraint.MinItems<N, Msg?>` | Restricts array length to $\ge N$. |
| `constraint.MaxItems<N, Msg?>` | Restricts array length to $\le N$. |
| `constraint.UniqueItems<Msg?>` | Restricts arrays to deeply unique items. |
| `constraint.Custom<Fn, Msg?>` | Runs a custom validation function: `(val, ctx) => boolean`. |
| `constraint.Requires<Path | [Paths], Msg?>` | Enforces that other object property paths exist. |
| `constraint.Message<Msg>` | Fallback custom error message. |

#### `format` Namespace

Standard formats for string primitives.

- `format.Email`: Practical mailbox check (`local@domain`, length limits, DNS-like domain with a real TLD). Not full RFC 5322.
- `format.IdnEmail`: Like email, but Unicode local/domain labels allowed.
- `format.UUID`: UUID (v1-v5).
- `format.URL`: HTTP/HTTPS/FTP URLs.
- `format.IPv4` / `format.IPv6`: IP addresses.
- `format.Date`: `YYYY-MM-DD` validated via `new Date(...)` (calendar overflow like `2024-02-31` is allowed). With `from: 'query'`, the runtime value becomes a `Date` (the TypeScript type remains `string & format.Date`).
- `format.DateTime`: date-time validated via `new Date(...)`. With `from: 'query'`, returns a `Date`; otherwise keeps the string.
- `format.ObjectId`: MongoDB 24-character hex ObjectId.
- `format.Duration`: ISO-8601 duration.
- `format.Time`: Time string `HH:MM:SS` with a required timezone (`Z` or `±HH:MM`), e.g. `19:55:00Z`.
- `format.Byte`: Base64 string.
- `format.Password`: Any string (always valid placeholder).
- `format.Regex`: Valid regular expression string.
- `format.Hostname`: ASCII domain name (includes `localhost`).
- `format.IdnHostname`: Internationalized hostname (Unicode labels).
- `format.URI`: Absolute URI.
- `format.UriReference`: Absolute URI or relative reference.
- `format.IRI`: Absolute IRI (Unicode URI).
- `format.IriReference`: Absolute IRI or relative reference.
- `format.UriTemplate`: RFC 6570 URI template.
- Unknown `Format<'...'>` strings fail validation at runtime.

Object and record shapes require **plain objects** (`Object.prototype` or `null` prototype). Class instances, `Date`, `Map`, `Set`, typed arrays, etc. are rejected unless the type is a dedicated instance type (`Date`, `Map`, …).

#### `transform` Namespace

Sanitizes and converts input values during validation.

- `transform.Trim`: Trims string whitespace.
- `transform.LowerCase`: Converts string to lowercase.
- `transform.UpperCase`: Converts string to uppercase.
- `transform.Capitalize`: Capitalizes the first letter.
- `transform.ToNumber`: Same coercion as `from: 'query'` for numbers (non-empty numeric strings → `parseFloat`).
- `transform.ToBoolean`: Same coercion as `from: 'query'` for booleans (`true`/`false`/`1`/`0`/`yes`/`no`/`on`/`off`); unknown values are left unchanged and fail the boolean check.
- `transform.ToDate`: Same coercion as `from: 'query'` for dates (parseable strings and finite timestamps).
- `transform.Custom<Fn>`: Custom mapping function: `(val) => any`.

#### `tag` Namespace

- `tag.Default<Value>`: Injects `Value` when a property is undefined. Removes the optional modifier (`?`) when resolved with `ResolveDefaults<T>`.

---

## Troubleshooting

### `validate`, `is`, or `assert` calls return empty results or throw at runtime
- **Cause**: The compiler transformer did not execute during build.
- **Diagnostics Check**: Inspect your built `.js` code. If the output still contains `validate<User>(data)` or other generic validation calls as functions, compilation was bypassed.
- **Fix**:
  1. Verify `npx ts-patch install` was executed successfully.
  2. Verify the transformer plugin is registered in `tsconfig.json`.
  3. Ensure your bundler or compiler CLI compiles using patched `tsc`.

---

## Maintenance

This package is actively maintained.

Bug reports and pull requests are welcome. Security issues and critical
regressions are prioritized. New features are considered when they align
with the package's existing scope.
