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

### 1. Decorator-Based Validation (Server Endpoints)

The transformer automatically intercepts decorators imported from `@webergency-utils/server` (`@Body`, `@Query`, `@Param`). It hashes the underlying TypeScript type, generates a highly optimized validation function, and hoists it to the top of the file using the `MetadataStore`.

```typescript
import { Controller, Post, Body } from '@webergency-utils/server';

interface UserDTO {
  id: string;
  name: string;
  age?: number;
}

@Controller('/users')
export class UserController {
  // @webergency-utils/typechecker automatically generates a validator for UserDTO,
  // registers it, and transforms this to @Body("hash_id", "strict")
  @Post('/')
  createUser(@Body() user: UserDTO) {
    return { success: true, user };
  }
}
```

---

### 2. Manual Runtime Validation APIs

You can manually validate unknown data anywhere in your code. The transformer intercepts these calls and replaces them with direct, optimized validation functions.

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

## Supported JSON-Schema Validation Tags

Add strict runtime metadata to your TypeScript primitives using standard intersection types:

### String Tags
- `MinLength<N>`: Minimum string length.
- `MaxLength<N>`: Maximum string length.
- `Pattern<RegExp>`: Regular expression validation.
- `Format<T>`: Structural formats: `'email'`, `'uuid'`, `'date'`, `'date-time'`, `'url'`, `'ipv4'`, `'ipv6'`.

### Number Tags
- `Minimum<N>`: Minimum numeric value (inclusive).
- `Maximum<N>`: Maximum numeric value (inclusive).
- `ExclusiveMinimum<N>`: Greater than `N`.
- `ExclusiveMaximum<N>`: Less than `N`.
- `MultipleOf<N>`: Must be a multiple of `N`.

### Array Tags
- `MinItems<N>`: Minimum array items count.
- `MaxItems<N>`: Maximum array items count.
- `UniqueItems`: Enforces all elements in the array to be deeply unique.

#### Example:
```typescript
import { MinLength, Minimum, Format, UniqueItems } from '@webergency-utils/typechecker';

interface Profile {
  email: string & Format<'email'>;
  password: string & MinLength<8>;
  age: number & Minimum<18>;
  luckyNumbers: number[] & UniqueItems;
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
