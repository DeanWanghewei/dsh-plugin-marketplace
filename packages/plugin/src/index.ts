import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  handleInfo,
  handleInstall,
  handleListInstalled,
  handleSearch,
  handleUninstall,
} from './handlers.js'

/**
 * dshm as a harness plugin: the marketplace becomes model-facing tools, so
 * an agent can search, inspect, install, and uninstall plugins inside a
 * session. All logic lives in handlers.ts over @dshm/core; the host provides
 * the tool DSL (ambient imports — no version skew with the running dsh).
 */

export const name = 'dshm'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'marketplace_search',
      description:
        'Search deepseek-harness plugin marketplaces by keyword, category, or tag. ' +
        'Returns plugin ids with sources; use marketplace_info for details.',
      parameters: {
        query: { type: 'string', description: 'keywords (id/name/description/tags)' },
        category: { type: 'string', description: 'category filter, comma-separated (OR)' },
        tag: { type: 'string', description: 'exact tag filter' },
        registry: { type: 'string', description: 'restrict to one marketplace source name' },
        limit: { type: 'number', description: 'max results (default 20)' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return handleSearch(args)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'marketplace_info',
      description: 'Show one plugin in detail: description, source, categories, install state.',
      parameters: {
        id: { type: 'string', required: true, description: 'plugin id (registry:id or bare id)' },
        profile: { type: 'string', description: 'dsh profile to check install state (default: web)' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return handleInfo(args.id, args.profile)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'marketplace_install',
      description:
        'Install a plugin into a dsh profile. If the result asks for build-script ' +
        'permission, confirm with the user before retrying with allow_build=true.',
      parameters: {
        id: { type: 'string', required: true, description: 'plugin id' },
        profile: { type: 'string', description: 'target profile (default: web)' },
        allow_build: { type: 'boolean', description: 'grant pnpm build-script permission after user confirmation' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return handleInstall(args.id, { profile: args.profile, allowBuild: args.allow_build })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'marketplace_uninstall',
      description: 'Uninstall a dshm-installed plugin from a profile.',
      parameters: {
        id: { type: 'string', required: true, description: 'plugin id' },
        profile: { type: 'string', description: 'target profile (default: web)' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return handleUninstall(args.id, args.profile)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'marketplace_list_installed',
      description: 'List plugins installed in a profile (dshm-installed plus profile bundles).',
      parameters: {
        profile: { type: 'string', description: 'target profile (default: web)' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return handleListInstalled(args.profile)
      },
    }),
  )

  console.log('[dshm] marketplace tools registered (search/info/install/uninstall/list_installed)')
}
