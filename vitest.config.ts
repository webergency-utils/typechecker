import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    // TS program creation per case is slow on CI (staticAsserts / transformer).
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/runtime/**/*.ts',
        'src/engine/**/*.ts',
        'src/transformer.ts',
        'src/plugin.ts',
        'src/index.ts'
      ],
      // resolver.ts is a TypeScript checker/AST walker; exercised via transformer
      // integration tests, but most branches are compiler-type edge paths that are
      // not practical to unit-cover exhaustively (see src/tests/notes.md).
      exclude: [
        '**/*.test.ts',
        'src/runtime/tags.ts',
        'src/runtime/tags/**',
        'src/engine/resolver.ts'
      ],
      thresholds: {
        lines: 99,
        // Statement count stays a bit under 99% because of defensive compiler-edge
        // arms that share covered lines; line coverage is the gate.
        statements: 98,
        functions: 99,
        branches: 96
      }
    }
  }
});
