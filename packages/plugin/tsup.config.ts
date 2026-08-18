import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: false,
  target: 'node22',
  outDir: 'lib',
  // @dshm/core is bundled; the harness host (@deepseek-ai/dsh-tools,
  // @deepseek-ai/cordis) is ambient — resolved from the running dsh process,
  // never installed into the profile. yaml stays external too: bundling the
  // CommonJS package into ESM breaks its require('process') shim.
  external: ['@deepseek-ai/dsh-tools', '@deepseek-ai/cordis', 'yaml', /^node:/],
})
