# @webergency/types

`@webergency/types` is a powerful, zero-runtime-dependency TypeScript compiler plugin (transformer) that converts your static TypeScript types into high-performance, hashed, and hoisted runtime validators. 

It is designed to work seamlessly with the `@webergency/endpoint` library, automatically enforcing strict data structures at compile time without bloating your runtime code.

## Installation

Since this library is a TypeScript compiler plugin, you will need a tool like `ts-patch` or `ttypescript` to hook into the compilation process.

```bash
npm install @webergency/types @webergency/endpoint
npm install -D ts-patch
```

Run `ts-patch install` to patch your local TypeScript installation.

## Configuration

Update your `tsconfig.json` to include the transformer in the `compilerOptions.plugins` array:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "plugins": [
      { "transform": "@webergency/types" }
    ]
  }
}
```

## Usage

### 1. Decorator Transformation (Endpoints)

The transformer automatically intercepts decorators imported from `@webergency/endpoint` (`@Body`, `@Query`, `@Param`). It hashes the underlying TypeScript type, generates a highly optimized validation function, and hoists it to the top of the file using the `MetadataStore`.

```typescript
import { Body, Query } from '@webergency/endpoint';

interface UserDTO {
  id: string;
  name: string;
  age?: number;
}

export class UserController {
  // @webergency/types will automatically generate a validator for UserDTO,
  // register it, and transform this to @Body("hash_id")
  createUser(@Body() user: UserDTO) {
    return { success: true, user };
  }
}
```

### 2. Runtime Validation APIs

You can also manually validate unknown data anywhere in your code using the provided runtime APIs. The transformer intercepts these calls and injects the proper validation logic.

```typescript
import { is, assert, assertGuard, validate } from '@webergency/types';

interface Payload {
  id: string;
  active: boolean;
}

const data: unknown = JSON.parse('{"id": "123", "active": true}');

// 1. is() - returns a boolean
if (is<Payload>(data)) {
  console.log(data.id);
}

// 2. assert() - returns the data or throws an error
const validData = assert<Payload>(data);

// 3. assertGuard() - asserts the type for the current scope
assertGuard<Payload>(data);
console.log(data.id);

// 4. validate() - returns a detailed validation object
const result = validate<Payload>(data);
if (result.success) {
  console.log(result.data);
} else {
  console.error(result.errors);
}
```

### Validation Modes

All runtime validation functions accept a secondary `ValidationMode` argument:

- `'strict'`: The input must precisely match the schema. Any additional properties not defined in the interface will cause validation to fail.
- `'relaxed'`: The input must contain all required properties, but any additional properties are ignored.
- `'strip'`: Validates like `'relaxed'`, but returns a new object with any unknown properties removed.

```typescript
// Strict Mode
if (is<Payload>(data, 'strict')) {
  // data exactly matches Payload
}

// Strip Mode
const cleanedData = assert<Payload>(data, 'strip');
```

## How it Works

1. **AST Generation**: During compilation, the transformer analyzes your TS types and builds Abstract Syntax Trees (ASTs) for validation logic.
2. **Circular References**: It uses a tracker to detect circular dependencies and generates safe lazy-lookups automatically.
3. **Hoisting**: Generated validators are cached and pushed to the top of the file as `MetadataStore.registerValidator("hash", ...)` to ensure they are created exactly once.
4. **Zero Dependency**: The emitted JS output does not rely on `@webergency/types`. All logic is natively baked-in or utilizes the `MetadataStore` from your endpoint layer.
