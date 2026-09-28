import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (dir: string) => fileURLToPath(new URL(`./${dir}/src/index.ts`, import.meta.url));

// Tests run against each package's source, so nothing has to be built first.
export default defineConfig({
  resolve: {
    alias: {
      '@rebbehub/hebrew': src('packages/hebrew'),
      '@rebbehub/model': src('packages/model'),
      '@rebbehub/db': src('packages/db'),
      '@rebbehub/core': src('packages/core'),
      '@rebbehub/mirror': src('packages/mirror'),
      '@rebbehub/importers': src('packages/importers'),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'services/*/tests/**/*.test.ts'],
    testTimeout: 30_000,
    // Starting PGlite (Postgres in WebAssembly) takes seconds, more when test files start it side by side.
    hookTimeout: 60_000,
  },
});
