import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  clean: true,
  sourcemap: false,
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  outDir: 'lib',
  // Runtime dependencies and node builtins stay external; only @dshm/core is
  // bundled in. Without the explicit /^node:/ rule esbuild rewrites
  // `node:sqlite` to a bare `sqlite` package import, which does not exist.
  external: ['hono', '@hono/node-server', 'commander', 'yaml', /^node:/],
})
