/**
 * Generate the bundled seed registry from a local deepseek-harness checkout.
 *
 * Every package under packages/ becomes a path-sourced plugin entry; every
 * examples/ subdirectory becomes an example entry. Categories follow directory
 * group plus light source inspection. Regenerate with `pnpm seed`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { stringify } from 'yaml'

const HARNESS_ROOT = resolve(
  process.argv[2] ??
    process.env['HARNESS_ROOT'] ??
    '/Users/deanwang/IdeaProjects/githubProject/deepseek-harness',
)
const OUTPUT = resolve(process.argv[3] ?? 'registry/default/registry.yaml')

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

const plugins: Array<Record<string, unknown>> = []

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
    if (plugins.some((plugin) => plugin['id'] === pluginIdFromPackageName(name))) continue
    plugins.push({
      id: pluginIdFromPackageName(name),
      name,
      description: manifest.description ?? readmeDescription(dir) ?? '',
      categories: categoriesFor(entry, dir, manifest),
      tags: [entry],
      author: 'deepseek-ai',
      license: manifest.license ?? 'MIT',
      verified: true,
      source: { type: 'path', path: dir },
    })
  }
}

// examples/<name> — runnable compositions rather than installable packages,
// but indexing them makes the seed browsable end to end.
const examplesDir = join(HARNESS_ROOT, 'examples')
if (isDirectory(examplesDir)) {
  for (const entry of readdirSync(examplesDir)) {
    const dir = join(examplesDir, entry)
    if (!isDirectory(dir)) continue
    const manifest = readJson(join(dir, 'package.json'))
    plugins.push({
      id: `example-${basename(dir)}`,
      name: manifest?.name ?? `example: ${basename(dir)}`,
      description: readmeDescription(dir) ?? '',
      categories: ['example'],
      tags: ['example'],
      author: 'deepseek-ai',
      license: manifest?.license ?? 'MIT',
      verified: true,
      source: { type: 'path', path: dir },
    })
  }
}

plugins.sort((a, b) => String(a['id']).localeCompare(String(b['id'])))

const document = {
  schemaVersion: 1,
  name: 'default',
  categories: CATEGORIES.map(({ id, zh, en }) => ({ id, name: { zh, en }, parent: null })),
  plugins,
}

mkdirSync(resolve(OUTPUT, '..'), { recursive: true })
writeFileSync(
  OUTPUT,
  `# GENERATED by scripts/seed-from-harness.ts — regenerate with \`pnpm seed\`\n${stringify(document)}\n`,
  'utf8',
)
console.log(`wrote ${plugins.length} plugin entries to ${OUTPUT}`)
