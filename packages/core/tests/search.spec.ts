import { describe, expect, it } from 'vitest'
import { categoryCounts, qualifiedId, searchPlugins, type ResolvedPlugin } from '../src/index.js'

function plugin(id: string, over: Partial<ResolvedPlugin['entry']> = {}): ResolvedPlugin {
  return {
    registry: 'default',
    qualifiedId: qualifiedId('default', id),
    entry: {
      id,
      name: id,
      description: '',
      categories: [],
      tags: [],
      verified: false,
      images: [],
      source: { type: 'npm', package: `pkg-${id}` },
      ...over,
    },
  }
}

describe('searchPlugins', () => {
  const plugins = [
    plugin('cordis-tools', { name: 'Cordis 工具', categories: ['agent-tool'], tags: ['cordis'] }),
    plugin('web-ui', { name: 'Web UI', categories: ['ui', 'extension'] }),
    plugin('cordis-runner', { description: 'runs cordis host halves' }),
  ]

  it('ranks exact id matches first', () => {
    const results = searchPlugins(plugins, { text: 'cordis' })
    expect(results.map((item) => item.plugin.entry.id)).toEqual(['cordis-tools', 'cordis-runner'])
  })

  it('filters by any listed category (OR)', () => {
    const results = searchPlugins(plugins, { categories: ['ui', 'agent-tool'] })
    expect(results.map((item) => item.plugin.entry.id).sort()).toEqual(['cordis-tools', 'web-ui'])
  })

  it('filters by tag and registry', () => {
    expect(searchPlugins(plugins, { tag: 'cordis' }).map((item) => item.plugin.entry.id)).toEqual([
      'cordis-tools',
    ])
    expect(searchPlugins([...plugins], { registry: 'other' })).toHaveLength(0)
  })

  it('matches CJK names case-insensitively', () => {
    const results = searchPlugins(plugins, { text: '工具' })
    expect(results.map((item) => item.plugin.entry.id)).toEqual(['cordis-tools'])
  })
})

describe('categoryCounts', () => {
  it('counts every plugin per category, including multiple memberships', () => {
    const categories = [
      { id: 'ui', name: { en: 'UI' }, parent: null },
      { id: 'extension', name: { en: 'Extension' }, parent: null },
      { id: 'empty', name: { en: 'Empty' }, parent: null },
    ]
    const counts = categoryCounts(
      [plugin('a', { categories: ['ui'] }), plugin('b', { categories: ['ui', 'extension'] })],
      categories,
    )
    expect(counts.map((item) => [item.category.id, item.count])).toEqual([
      ['ui', 2],
      ['extension', 1],
      ['empty', 0],
    ])
  })
})
