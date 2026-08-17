import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Tests always run against core sources — never stale or missing
      // build artifacts (CI runs test before build).
      '@dshm/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
    environment: 'node',
    server: {
      deps: {
        // Let `node:` builtins (node:sqlite, …) pass through to the runtime.
        external: [/^node:/],
      },
    },
  },
})
