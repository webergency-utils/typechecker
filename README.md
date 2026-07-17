# @webergency-utils/typechecker

`@webergency-utils/typechecker` is a high-performance, zero-runtime-dependency TypeScript compiler plugin (transformer) that converts your static TypeScript types into optimized, hashed, and hoisted runtime validators.

It is designed to work seamlessly with the `@webergency-utils/server` library, automatically enforcing strict data validation at compile time, and provides standard validation API wrappers matching `typia` with extended options for coercion and array handling.

---

## Features

- **⚡ Blazing Fast**: No runtime schema parsing or generic reflection. Code is generated at compile time as highly optimized JavaScript pipelines.
- **📦 Zero Dependency**: The generated code has absolutely zero external dependencies.
- **🔄 Advanced Type Checking**: Full support for Unions, Intersections, Nested Objects, Tuples, and Optional Properties.
- **🏷️ Tag-Based Validation**: Custom JSON-Schema validation tags directly inside your TypeScript types (e.g. `MinLength<8>`, `Format<'email'>`).
- **🛡️ Multiple Validation Modes**: Easily switch between `'strict'`, `'relaxed'`, and `'strip'` modes.
- **📈 Coercion & Coalescing**: Extended options for type conversion and single-value array wrapping (highly useful for HTTP Query parameters!).

---

## Installation

Since this library is a TypeScript compiler plugin, you will need a tool like `ts-patch` or `ts-node` to hook into the compilation process.

```bash
npm install @webergency-utils/typechecker
npm install -D ts-patch
```

Run `ts-patch install` to patch your local TypeScript installation.

---

## Configuration

Update your `tsconfig.json` to include the transformer in the `compilerOptions.plugins` array:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "plugins": [
      { "transform": "@webergency-utils/typechecker" }
    ]
  }
}
```

---

## Usage

You can validate unknown data anywhere in your code. The transformer intercepts these calls and replaces them with direct, optimized validation functions.

```typescript
import { is, assert, assertGuard, validate } from '@webergency-utils/typechecker';

interface Payload {
  id: string;
  active: boolean;
}

const data: unknown = JSON.parse('{"id": "123", "active": true}');

// 1. is() - returns a boolean (type guard)
if (is<Payload>(data)) {
  console.log(data.id); // Narrowed to 'Payload'
}

// 2. assert() - returns the narrowed value or throws an error
const validData = assert<Payload>(data);

// 3. assertGuard() - asserts the type for the current scope in-place
assertGuard<Payload>(data);
console.log(data.id); // Narrowed in-place

// 4. validate() - returns a structured validation result with errors
const result = validate<Payload>(data);
if (result.success) {
  console.log(result.data);
} else {
  console.error(result.errors); // Array of formatted errors
}
```

---

### 3. Extended Options & Validation Modes

All validation APIs accept either a string `ValidationMode` or a custom `ValidationOptions` object:

```typescript
export type ValidationMode = 'strict' | 'relaxed' | 'strip';

export interface ValidationOptions {
  mode?: ValidationMode;    // default: 'strict'
  tryConvert?: boolean;     // Converts string numbers, booleans, and dates (ideal for query parameters)
  wrapArrays?: boolean;     // Wraps a single value into an array if the type expects an array
}
```

#### Examples:
```typescript
// Relaxed Mode (ignores additional properties)
const user = assert<User>(data, 'relaxed');

// Strip Mode (strips out any unknown properties from returned object)
const cleanUser = assert<User>(data, 'strip');

// Query-String Coercion
const query = assert<SearchQuery>(rawQuery, {
  mode: 'strip',
  tryConvert: true, // Coerces "18" -> 18, "true" -> true, etc.
  wrapArrays: true  // Coerces "tag" -> ["tag"] if tags: string[] is expected
});
```

---

### 4. Error Reporting & Grouping

When validation fails using `validate<T>()`, you receive a highly structured array of errors. To make this easy to consume for humans, LLMs, and UI libraries (like React Hook Form), the library provides a `groupErrorsByPath` helper that organizes these errors by their exact JSON path.

The error strings follow a deterministic, parser-friendly `Constraint<Value>` format.

```typescript
import { validate, groupErrorsByPath, Minimum } from '@webergency-utils/typechecker';

interface Payload {
  id: string;
  role: "admin" | "user";
  age: number & Minimum<18>;
  metadata: { tag: string } | { priority: number };
}

const data = {
  id: 123,           // Error: expected string, got number
  role: "guest",     // Error: literal union mismatch
  age: 15,           // Error: minimum constraint failed
  metadata: { }      // Error: complex union mismatch
};

const result = validate<Payload>(data);
if (!result.success) {
  const grouped = groupErrorsByPath(result.errors);
  console.log(JSON.stringify(grouped, null, 2));
}
```

**Output:**
```json
{
  "id": {
    "value": 123,
    "errors": ["Type<string>"]
  },
  "role": {
    "value": "guest",
    "errors": [
      "Literal<'admin'>",
      "Literal<'user'>"
    ]
  },
  "age": {
    "value": 15,
    "errors": ["Minimum<18>"]
  },
  "metadata": {
    "value": {},
    "errors": ["Type<{tag:string}|{priority:number}>"]
  },
  "metadata.tag": {
    "value": undefined,
    "errors": ["Type<string>"]
  },
  "metadata.priority": {
    "value": undefined,
    "errors": ["Type<number>"]
  }
}
```

This flattened, grouped output is incredibly powerful—it tells the developer (or an AI agent) exactly *why* a complex union or object failed down to the very specific branch and missing property constraint.

---

### 5. Deep/External Type Validation (WithModifiers)

If you have deeply nested objects or external types that you cannot edit directly, you can add validation tags to specific properties using dot-notation path references. This prevents you from having to retype the entire structure.

```typescript
import { WithModifiers, constraint, format } from '@webergency-utils/typechecker';

// External type we cannot edit directly
interface ExternalUser {
  id: string;
  profile?: {
    details: {
      email: string;
      password: string;
    }
  }
}

// Decorate specific paths using dot notation
type ValidatedUser = WithModifiers<ExternalUser, {
  'profile.details.email': format.Email;
  'profile.details.password': constraint.MinLength<8>;
}>;
```

### 6. Cross-Field Dependencies (Requires)

You can specify that a property requires the presence of other properties in the same object using absolute paths or relative dot-notation paths (e.g., `.sibling`, `..grandparent.cousin`):

```typescript
import { WithModifiers, constraint } from '@webergency-utils/typechecker';

interface DBConfig {
  ssl?: boolean;
  cert?: string;
  auth?: {
    username?: string;
    password?: string;
  }
}

type SecureConfig = WithModifiers<DBConfig, {
  // Absolute check: if "ssl" is defined, "cert" must exist at root
  'ssl': constraint.Requires<'cert'>;

  // Relative check: if "auth.password" is defined, its sibling "username" must exist
  'auth.password': constraint.Requires<'.username'>;
}>;
```

### 7. Custom Error Messages

You can specify custom error messages for constraint violations. Most constraint tags accept a custom message as an optional template argument, or you can use the `Message<Msg>` tag:

```typescript
import { validate, constraint, Message } from '@webergency-utils/typechecker';

interface User {
  // Direct message in constraint tag
  age: number & constraint.Minimum<18, "Must be 18 or older">;

  // Fallback property message via Message<T>
  email: string & constraint.Format<'email'> & Message<"Please supply a valid email address">;
}
```

### 8. Zod Compatibility

If you are integrating with libraries that expect Zod-style validation errors (such as React Hook Form or API gateways), you can convert the validation errors using the `toZodIssues` helper or throw a `ZodLikeError` which wraps the issues:

```typescript
import { validate, toZodIssues, ZodLikeError } from '@webergency-utils/typechecker';

const result = validate<User>(data);
if (!result.success) {
  // 1. Convert errors array to Zod-compliant issues
  const zodIssues = toZodIssues(result.errors);
  console.log(zodIssues); // [{ code: "custom", path: ["age"], message: "Minimum<18>", received: 15 }]

  // 2. Or throw a Zod-like Error
  throw new ZodLikeError(result.errors);
}
```

---

## Supported Validation & Modifier Namespaces

The library provides validation tags and modifiers grouped into four logical namespaces. These can be imported directly or used via their namespaces (e.g., `constraint.MinLength` vs `MinLength`).

### 1. `constraint` Namespace
Impose structural and value-based constraints on primitives:

- `MinLength<N, Msg?>`: Minimum string length.
- `MaxLength<N, Msg?>`: Maximum string length.
- `Length<Min, Max>`: Helper combining MinLength and MaxLength.
- `Pattern<RegExp, Msg?>`: Regular expression validation.
- `Minimum<N, Msg?>` / `Maximum<N, Msg?>`: Inclusive numeric bounds (supports `number | bigint`).
- `ExclusiveMinimum<N, Msg?>` / `ExclusiveMaximum<N, Msg?>`: Exclusive numeric bounds.
- `Range<Min, Max>`: Helper combining Minimum and Maximum.
- `MultipleOf<N, Msg?>`: Enforces that the value is a multiple of `N`.
- `MinItems<N, Msg?>` / `MaxItems<N, Msg?>`: Array size constraints.
- `UniqueItems<Msg?>`: Enforces that all elements in an array or Set are deeply unique.
- `Custom<Fn, Msg?>`: Executes a custom validation function: `(val, ctx) => boolean`.
- `Requires<Paths, Msg?>`: Enforces cross-field dependency validation.
- `Message<Msg>`: Attaches a fallback custom error message to a property.

### 2. `format` Namespace
Pre-defined string formatting shortcuts:

- `format.Email`: RFC 5322 Email.
- `format.UUID`: UUID (v1-v5) format.
- `format.URL`: Full URL validation (HTTP/HTTPS/FTP).
- `format.IPv4` / `format.IPv6`: IP address validation.
- `format.DateTime`: ISO-8601 Date Time string.
- `format.Date`: ISO Date (YYYY-MM-DD).
- `format.Time`: Time string (HH:MM:SS).
- `format.Duration`: ISO-8601 duration (e.g., PT1H).
- `format.ObjectId`: 24-character MongoDB ObjectId.
- `format.Byte`: Base64 encoded string.
- `format.Password`: Always valid string, placeholder for password parameters.
- `format.Regex`: Valid regular expression string.
- `format.Hostname`: Valid domain name/hostname.
- `format.URI`: Valid URI.

### 3. `transform` Namespace
Coerce or sanitize values before validation:

- `transform.Trim`: Trims whitespace from both ends of a string.
- `transform.LowerCase`: Converts string to lowercase.
- `transform.UpperCase`: Converts string to uppercase.
- `transform.Capitalize`: Capitalizes the first letter of a string.
- `transform.ToNumber`: Coerces inputs to numbers.
- `transform.ToBoolean`: Coerces inputs to booleans.
- `transform.ToDate`: Coerces string timestamp to a Date object.
- `transform.Custom<Fn>`: Applies a custom mapping function `(val) => any`.

### 4. `tag` Namespace
Define defaults for optional fields:

- `tag.Default<Value>`: Injects the specified `Value` if the property is `undefined` at validation time.

### Assignability & compile-time constants

Constraint tags use **optional** phantom properties (same pattern as `tag.Default`), so plain values assign to tagged types:

```typescript
const age: number & Minimum<18> = 18; // OK
const plain: { age: number } = { age: 5 };
const tagged: { age: number & Minimum<18> } = plain; // OK
```

When the TypeScript plugin is enabled, **compile-time constants** that violate constraints produce diagnostics:

```typescript
const tooYoung: number & Minimum<18> = 5;           // Error: does not satisfy Minimum<18>
const short: string & MinLength<3> = 'ab';           // Error: does not satisfy MinLength<3>
const empty: string[] & MinItems<1> = [];            // Error: does not satisfy MinItems<1>
const dupes: number[] & UniqueItems = [1, 1];        // Error: does not satisfy UniqueItems
```

Non-constants (`number`, variables, function results) are not checked statically — use `is` / `assert` / `validate` at runtime.

#### Example:
```typescript
import { MinLength, Minimum, Format, UniqueItems, tag, transform, constraint } from '@webergency-utils/typechecker';

interface Profile {
  email: string & Format<'email'> & transform.Trim & transform.LowerCase;
  password: string & MinLength<8>;
  age: number & Minimum<18> & constraint.Message<"Must be 18+">;
  luckyNumbers: number[] & UniqueItems;
  role: string & tag.Default<"user">;
}
```

---

## How it Works

1. **AST Analysis**: The transformer scans compile-time type signatures and generates highly nested, direct runtime checks.
2. **Circular References**: Safely handles recursive and circular types by generating self-referencing lazy functions.
3. **Hoisting & Deduping**: Identical type validations are hoisted to top-level constants and shared, minimizing footprint.
4. **Clean Emitted JS**: The output compiles into vanilla JS, utilizing direct, blazing-fast validation logic.

---

## License

MIT © radixxko / [webergency-utils](https://github.com/webergency-utils)
