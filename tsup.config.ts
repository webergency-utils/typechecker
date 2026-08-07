import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/plugin.ts',
    'src/transformer.ts',
    'src/runtime/index.ts',
    'src/runtime/validators.ts',
    'src/runtime/parse-runtime.ts',
    'src/runtime/serializer-runtime.ts',
    'src/runtime/casing.ts',
    'src/runtime/path.ts',
    'src/runtime/regex.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,
  splitting: false,
});
