# Testing Notes

## Rules
- Tests must be executed using Vitest.
- Always isolate tests using beforeEach/afterEach and avoid shared states across tests.
- Keep tests clean and well-structured following the AAA (Arrange, Act, Assert) pattern.

## Anti-Patterns
- Avoid mutating global configuration or state shared between tests.
- Do not check internal private methods of validators.

## Mocking Conventions
- Use `vi.fn()` for callback/custom function verification when mocking is required.
