import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/bin.ts'],
  format: 'esm',
  clean: true,
  sourcemap: false,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  outDir: 'lib',
  // yaml is CommonJS; bundling it into the ESM output breaks its dynamic
  // require of node builtins, so it ships as a real dependency instead.
  external: ['yaml', 'hono', '@hono/node-server', /^node:/],
})
// keep runtime deps external (yaml CJS quirk; hono stack stays clean)
