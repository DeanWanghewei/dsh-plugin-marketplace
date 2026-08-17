import { cpSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The CLI embeds the built web assets for `dshm web`; both HTML entries
// travel together so relative hashed chunks resolve.
const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../dist')
const target = resolve(here, '../../cli/web')

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log(`copied web dist -> ${target}`)
