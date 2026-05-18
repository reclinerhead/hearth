import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node is the default; pure-logic tests run faster here and
    // performance.now() has the sub-millisecond resolution that
    // activity-log assertions rely on. Component tests opt into jsdom
    // via a `// @vitest-environment jsdom` directive at the top of the
    // file (see components/habitat-finding-modal.test.tsx).
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // The ** prefix matters: a plain `node_modules/**` only matches the
    // repo's top-level node_modules folder and lets vitest walk into
    // .claude/worktrees/*/node_modules/ (and try to run every third-
    // party package's test files). Always prefix with **.
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.claude/**',
    ],
  },
  resolve: {
    alias: {
      '@': new URL('./', import.meta.url).pathname,
    },
  },
});
