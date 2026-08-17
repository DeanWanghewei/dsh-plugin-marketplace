import type { Command } from 'commander'
import { searchPlugins } from '@dshm/core'
import { createContext, loadMerged } from '../context.js'
import { pc, printTable } from '../output.js'

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('search plugins by text, category, or tag')
    .argument('[text...]', 'keywords matched against id, name, tags, description')
    .option('-c, --category <ids>', 'comma-separated categories (OR semantics)')
    .option('-t, --tag <tag>', 'exact tag filter')
    .option('-r, --registry <name>', 'restrict to one registry')
    .option('--limit <n>', 'show at most n results', '30')
    .action(
      async (
        text: string[],
        options: { category?: string; tag?: string; registry?: string; limit: string },
      ) => {
        const context = createContext()
        const merged = await loadMerged(context)
        for (const error of merged.errors) {
          console.error(pc.yellow(`registry '${error.registry}' failed to load: ${error.message}`))
        }
        const results = searchPlugins(merged.plugins, {
          text: text.length > 0 ? text.join(' ') : undefined,
          categories: options.category
            ?.split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
          tag: options.tag,
          registry: options.registry,
        })
        if (results.length === 0) {
          console.log('no plugins matched')
          return
        }
        const limit = Number(options.limit) || 30
        printTable(
          ['ID', 'NAME', 'CATEGORIES', 'SOURCE', ''],
          results
            .slice(0, limit)
            .map(({ plugin }) => [
              plugin.qualifiedId,
              plugin.entry.name,
              plugin.entry.categories.join(','),
              plugin.entry.source.type,
              plugin.entry.verified ? pc.green('✓ verified') : '',
            ]),
        )
        if (results.length > limit) {
          console.log(pc.dim(`… ${results.length - limit} more (raise --limit)`))
        }
      },
    )
}
