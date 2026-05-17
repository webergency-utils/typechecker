# Outstanding Problems & Enhancements

This document tracks the hardening and completion of the `@webergency/types` transformer library for production use.

### 1. Hashing Strategy
- [x] **Weak Hashing**: Currently uses `checker.typeToString`, which can cause hash collisions for different types sharing the same name across different files. Needs to be replaced with a structural hash or fully qualified symbol name hash.

### 2. Validation Modes
- [x] **Strict Mode**: The AST generator currently only produces "relaxed" validation. It needs to iterate over `Object.keys(input)` and fail if any unexpected keys are found.
- [x] **Strip Mode**: Needs to generate an AST that clones the object and strips out any properties not explicitly defined in the TypeScript interface.

### 3. Detailed Error Reporting
- [x] **`validate()` Errors Array**: The current AST relies on `&&` operators which fail fast. For the `validate<T>()` API, the AST needs to be rewritten to push property paths and reasons into an `errors` array and return an `IValidation<T>` object.

### 4. Advanced TypeScript Types Support
- [x] **Dates**: Add native AST checking for `Date` objects.
- [x] **Enums**: Support both string and numeric enums.
- [x] **Tuples**: Support fixed-length array validation with specific types at specific indices.
- [x] **Intersections (`TypeA & TypeB`)**: Combine property requirements.
- [x] **Records / Index Signatures (`Record<string, Type>`)**: Validate dynamic keys against a specific value type.
- [x] **Nullables / Optionals**: Hardened strict null checks (handling `null` vs `undefined` correctly).
