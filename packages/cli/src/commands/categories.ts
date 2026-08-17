import type { Command } from 'commander'
import { categoryCounts } from '@dshm/core'
import { createContext, loadMerged } from '../context.js'
import { pickLocalized, printTable } from '../output.js'

export function registerCategoriesCommand(program: Command): void {
  program
    .command('categories')
    .description('list the category taxonomy with plugin counts (a plugin may hold several)')
    .action(async () => {
      const context = createContext()
      const merged = await loadMerged(context)
      const counts = categoryCounts(merged.plugins, merged.categories)
      const lang = context.env['LANG'] ?? context.env['LC_ALL'] ?? 'en'
      const rows = counts
        .sort((a, b) => b.count - a.count || a.category.id.localeCompare(b.category.id))
        .map(({ category, count }) => [
          category.id,
          pickLocalized(category.name, lang) || category.id,
          category.parent ? `↳ ${category.parent}` : '',
          String(count),
        ])
      printTable(['ID', 'NAME', 'PARENT', 'PLUGINS'], rows)
    })
}
