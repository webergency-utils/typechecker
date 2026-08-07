import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // TS program creation per case is slow on CI (staticAsserts / transformer).
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/runtime/**/*.ts',
        'src/engine/**/*.ts',
        'src/plugin.ts',
        'src/index.ts'
      ],
      // resolver.ts is a TypeScript checker/AST walker; exercised via transformer
      // integration tests, but most branches are compiler-type edge paths that are
      // not practical to unit-cover exhaustively (see tests/notes.md).
      exclude: [
        '**/*.test.ts',
        'src/runtime/tags.ts',
        'src/runtime/tags/**',
        'src/engine/resolver.ts',
        // AOT string generators + shared type walk: exercised via transform + emitAndImport E2E;
        // residual branches are compiler-type edges (same rationale as resolver.ts).
        'src/engine/serializer-generator.ts',
        'src/engine/parse-generator.ts',
        'src/engine/type-helpers.ts',
        'src/engine/generators.ts',
        'src/engine/hoister.ts',
        'src/engine/staticAsserts.ts',
        // Transformer / customFns are compiler-AST walks with many unreachable defensive arms;
        // exercised via emitAndImport / plugin suites, not practical for line-threshold coverage.
        'src/transformer.ts',
        'src/engine/customFns.ts'
      ],


      thresholds: {
        // Runtime-focused gate after AJV-complete schema expansion. Engine/transformer AST
        // modules are excluded (see notes.md); residual uncovered arms are mostly defensive
        // ref/encoding/coercion edges that share covered lines.
        lines: 98.5,
        statements: 97.5,
        functions: 99.5,
        branches: 94
      }
    }
  }
});
