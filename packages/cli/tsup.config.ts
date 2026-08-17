import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/bin.ts'],
  format: 'esm',
  clean: true,
  sourcemap: false,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  outDir: 'lib',
})
