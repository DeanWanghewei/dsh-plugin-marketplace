import { defineConfig } from 'vitest/config'

export default defineConfig({
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
