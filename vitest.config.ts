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
      exclude: ['**/*.test.ts', 'src/runtime/tags.ts', 'src/runtime/tags/**']
    }
  }
});
