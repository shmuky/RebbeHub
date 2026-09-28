import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (dir: string) => fileURLToPath(new URL(`./${dir}/src/index.ts`, import.meta.url));

// Tests run against each package's source, so nothing has to be built first.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@rebbehub\/db\/pglite$/, replacement: fileURLToPath(new URL('./packages/db/src/pglite.ts', import.meta.url)) },
      ...['hebrew', 'model', 'db', 'core', 'mirror', 'importers'].map((name) => ({ find: new RegExp(`^@rebbehub/${name}$`), replacement: src(`packages/${name}`) })),
    ],
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'services/*/tests/**/*.test.ts', 'apps/*/tests/**/*.test.ts'],
    testTimeout: 30_000,
    // Starting PGlite (Postgres in WebAssembly) takes seconds, more when test files start it side by side.
    hookTimeout: 60_000,
  },
});
