/**
 * Generate the seed registries from a local deepseek-harness checkout.
 *
 * Two variants are written from one scan:
 * - `registry/default/registry.yaml` — path sources pointing at the local
 *   checkout (development convenience; opt in via
 *   `dshm registry add local --file registry/default/registry.yaml`).
 * - `packages/cli/registry/default/registry.yaml` — npm sources for the
 *   @deepseek-ai/dsh-* packages, bundled into the published `dshm` package so
 *   any machine can install without a local checkout. Examples are skipped
 *   (they are not npm packages).
 *
 * Regenerate both with `pnpm seed`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { stringify } from 'yaml'

const HARNESS_ROOT = resolve(
  process.argv[2] ??
    process.env['HARNESS_ROOT'] ??
    '/Users/deanwang/IdeaProjects/githubProject/deepseek-harness',
)
const OUTPUT_PATH_VARIANT = resolve('registry/default/registry.yaml')
const OUTPUT_NPM_VARIANT = resolve('packages/cli/registry/default/registry.yaml')

interface CategorySeed {
  id: string
  zh: string
  en: string
}

const CATEGORIES: CategorySeed[] = [
  { id: 'agent-tool', zh: '智能体工具', en: 'Agent Tool' },
  { id: 'extension', zh: '扩展', en: 'Extension' },
  { id: 'ui', zh: '界面', en: 'UI' },
  { id: 'bundle', zh: '组合包', en: 'Bundle' },
  { id: 'sdk', zh: '软件开发包', en: 'SDK' },
  { id: 'adapter', zh: '模型适配', en: 'Model Adapter' },
  { id: 'infrastructure', zh: '基础设施', en: 'Infrastructure' },
  { id: 'example', zh: '示例', en: 'Example' },
]

interface PackageJson {
  name?: string
  description?: string
  license?: string
  dependencies?: Record<string, string>
  dsh?: { bundle?: unknown }
}

function readJson(path: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageJson
  } catch {
    return undefined
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function readmeDescription(dir: string): string | undefined {
  try {
    const raw = readFileSync(join(dir, 'README.md'), 'utf8')
    const lines = raw.split('\n')
    let seenTitle = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (!seenTitle) {
        if (trimmed.startsWith('# ')) seenTitle = true
        continue
      }
      if (trimmed === '' || trimmed.startsWith('[') || trimmed.startsWith('English')) continue
      if (trimmed.startsWith('#')) break
      return trimmed
    }
  } catch {
    return undefined
  }
  return undefined
}

function sourceMentionsTool(dir: string): boolean {
  try {
    const entries = readdirSync(join(dir, 'src'))
    return entries.some((file) => {
      if (!file.endsWith('.ts')) return false
      try {
        return readFileSync(join(dir, 'src', file), 'utf8').includes('defineTool')
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

function categoriesFor(group: string, dir: string, manifest: PackageJson): string[] {
  const categories = new Set<string>()
  if (manifest.dsh?.bundle) categories.add('bundle')
  const name = manifest.name ?? basename(dir)
  if (group === 'extensions') categories.add('extension')
  if (group === 'bundle') categories.add('bundle')
  if (group === 'sdk' || name.endsWith('-sdk')) categories.add('sdk')
  if (group === 'llm' || name.includes('-llm-')) categories.add('adapter')
  if (group === 'client' || group === 'web' || basename(dir).startsWith('ui-')) categories.add('ui')
  if (manifest.dependencies?.['@deepseek-ai/dsh-tools'] || sourceMentionsTool(dir)) {
    categories.add('agent-tool')
  }
  if (categories.size === 0) categories.add('infrastructure')
  return [...categories]
}

function pluginIdFromPackageName(name: string): string {
  const unscoped = name.includes('/') ? name.split('/').pop()! : name
  return unscoped.replace(/^dsh-/, '')
}

interface SeedEntry extends Record<string, unknown> {
  id: string
  name: string
  packageName?: string
  dir?: string
  description: string
  categories: string[]
  tags: string[]
  author: string
  license: string
  verified: boolean
  requiresServices?: string[]
  providesServices?: string[]
}

/**
 * Dependency facts from harness sources:
 * - `export const inject = ['a', 'b']` — ctx services a plugin requires
 * - `super(ctx, 'name')` / `Service.define(ctx, 'name', …)` — services it provides
 */
function extractServiceFacts(dir: string): {
  requiresServices: string[]
  providesServices: string[]
} {
  const requiresServices: string[] = []
  const providesServices: string[] = []
  const read = (path: string): string => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return ''
    }
  }
  const index = read(join(dir, 'src/index.ts'))
  const inject = index.match(/export const inject\s*=\s*\[([^\]]*)\]/)
  if (inject) {
    for (const item of inject[1]!.matchAll(/'([^']+)'/g)) requiresServices.push(item[1]!)
  }
  const servicePattern = /(?:super\(ctx,\s*|Service\.define\(\s*ctx,\s*)'([a-zA-Z][a-zA-Z0-9]*)'/g
  for (const file of readdirSync(join(dir, 'src'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name)) {
    for (const match of read(join(dir, 'src', file)).matchAll(servicePattern)) {
      providesServices.push(match[1]!)
    }
  }
  return {
    requiresServices: [...new Set(requiresServices)],
    providesServices: [...new Set(providesServices)],
  }
}

const packageEntries: SeedEntry[] = []

// packages/<group>/<name> two-level layout, plus direct packages/<name>.
for (const entry of readdirSync(join(HARNESS_ROOT, 'packages'))) {
  const groupDir = join(HARNESS_ROOT, 'packages', entry)
  if (!isDirectory(groupDir)) continue
  const candidates = readdirSync(groupDir)
    .map((child) => join(groupDir, child))
    .filter((child) => isDirectory(child))
  const direct = candidates.length === 0 ? [] : [groupDir]
  for (const dir of [...candidates, ...direct]) {
    const manifest = readJson(join(dir, 'package.json'))
    const name = manifest?.name
    if (!name || !name.startsWith('@deepseek-ai/dsh-')) continue
    if (packageEntries.some((plugin) => plugin.id === pluginIdFromPackageName(name))) continue
    const facts = extractServiceFacts(dir)
    // Plugins whose apply() requires a transport/config payload cannot start
    // from a bare row — their activation lands disabled with a template.
    const requiresConfig = ['mcp-client'].includes(pluginIdFromPackageName(name))
    packageEntries.push({
      requiresConfig: requiresConfig || undefined,
      id: pluginIdFromPackageName(name),
      name,
      packageName: name,
      dir,
      requiresServices: facts.requiresServices.length > 0 ? facts.requiresServices : undefined,
      providesServices: facts.providesServices.length > 0 ? facts.providesServices : undefined,
      description: manifest.description ?? readmeDescription(dir) ?? '',
      categories: categoriesFor(entry, dir, manifest),
      tags: [entry],
      author: 'deepseek-ai',
      license: manifest.license ?? 'MIT',
      verified: true,
    })
  }
}

// examples/<name> — runnable compositions rather than installable packages,
// but indexing them makes the local variant browsable end to end.
const exampleEntries: SeedEntry[] = []
const examplesDir = join(HARNESS_ROOT, 'examples')
if (isDirectory(examplesDir)) {
  for (const entry of readdirSync(examplesDir)) {
    const dir = join(examplesDir, entry)
    if (!isDirectory(dir) || entry === 'node_modules' || entry.startsWith('.')) continue
    const manifest = readJson(join(dir, 'package.json'))
    exampleEntries.push({
      id: `example-${basename(dir)}`,
      name: manifest?.name ?? `example: ${basename(dir)}`,
      dir,
      description: readmeDescription(dir) ?? '',
      categories: ['example'],
      tags: ['example'],
      author: 'deepseek-ai',
      license: manifest?.license ?? 'MIT',
      verified: true,
    })
  }
}

// Vendored cordis plugins (vendor/): in-box bundle members like timer and
// hmr. Their ids drop the cordis-plugin- prefix to match bundle row ids.
for (const entry of readdirSync(join(HARNESS_ROOT, 'vendor'))) {
  const dir = join(HARNESS_ROOT, 'vendor', entry)
  if (!isDirectory(dir)) continue
  const manifest = readJson(join(dir, 'package.json'))
  const name = manifest?.name
  if (!name?.startsWith('@deepseek-ai/')) continue
  const unscoped = name.split('/').pop()!
  const id = unscoped.replace(/^cordis-plugin-/, '')
  packageEntries.push({
    id,
    name: `${manifest.name}（vendored）`,
    packageName: name,
    dir,
    description: manifest.description ?? '',
    categories: ['infrastructure'],
    tags: ['vendor', 'cordis'],
    author: 'deepseek-ai',
    license: manifest.license ?? 'MIT',
    verified: true,
  })
}

// This repository's own installable packages (the dshm harness plugin).
// Path variant only — they publish on their own schedule.
for (const entry of readdirSync(resolve('packages'))) {
  const dir = resolve('packages', entry)
  const manifest = readJson(join(dir, 'package.json'))
  const name = manifest?.name
  if (!name?.startsWith('@dshm/') || name === '@dshm/core') continue
  const id = name === '@dshm/plugin' ? 'dshm-plugin' : name.split('/').pop()!
  packageEntries.push({
    id,
    name: 'dshm · harness 插件（模型可调用的插件市场工具）',
    packageName: name,
    dir,
    ownPackage: true,
    description:
      '以 deepseek-harness 插件形态运行的 dshm：向模型注册 marketplace_search/info/install/uninstall/list_installed 工具',
    categories: ['extension', 'agent-tool'],
    tags: ['marketplace', 'tools'],
    author: 'DeanWanghewei',
    license: 'MIT',
    verified: true,
  })
}

// Derive plugin-level requires from the service graph: each injected service
// resolves to the plugin(s) providing it (excluding self, in-marketplace only).
const providersByService = new Map<string, string[]>()
for (const entry of packageEntries) {
  for (const service of entry.providesServices ?? []) {
    const list = providersByService.get(service) ?? []
    list.push(entry.id)
    providersByService.set(service, list)
  }
}
for (const entry of packageEntries) {
  const requires = new Set<string>()
  for (const service of entry.requiresServices ?? []) {
    for (const provider of providersByService.get(service) ?? []) {
      if (provider !== entry.id) requires.add(provider)
    }
  }
  if (requires.size > 0) entry.requires = [...requires].sort()
}

packageEntries.sort((a, b) => a.id.localeCompare(b.id))
exampleEntries.sort((a, b) => a.id.localeCompare(b.id))

const categories = CATEGORIES.map(({ id, zh, en }) => ({ id, name: { zh, en }, parent: null }))

function writeVariant(output: string, plugins: Array<Record<string, unknown>>): void {
  mkdirSync(resolve(output, '..'), { recursive: true })
  writeFileSync(
    output,
    `# GENERATED by scripts/seed-from-harness.ts — regenerate with \`pnpm seed\`\n${stringify({
      schemaVersion: 1,
      name: 'default',
      categories,
      plugins,
    })}\n`,
    'utf8',
  )
  console.log(`wrote ${plugins.length} plugin entries to ${output}`)
}

// Path variant (repo-local development): local checkout paths + examples.
writeVariant(
  OUTPUT_PATH_VARIANT,
  [...packageEntries, ...exampleEntries].map((entry) => ({
    ...entry,
    source: { type: 'path', path: entry['dir'] },
    dir: undefined,
    packageName: undefined,
    ownPackage: undefined,
  })),
)

// npm variant (bundled into the published package): npm sources only —
// this repo's own packages are unpublished, so they stay path-variant only.
writeVariant(
  OUTPUT_NPM_VARIANT,
  packageEntries
    .filter((entry) => !entry.ownPackage)
    .map((entry) => ({
      ...entry,
      source: { type: 'npm', package: entry.packageName },
      dir: undefined,
      packageName: undefined,
      ownPackage: undefined,
    })),
)
