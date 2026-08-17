import { describe, expect, it } from 'vitest'
import { parseRegistry } from '../src/index.js'

const valid = {
  schemaVersion: 1,
  name: 'default',
  categories: [{ id: 'tool', name: { zh: '工具', en: 'Tool' } }],
  plugins: [
    {
      id: 'hello',
      name: 'Hello',
      description: 'greets',
      categories: ['tool', 'extra'],
      source: { type: 'path', path: '/tmp/hello.ts' },
    },
  ],
}

describe('parseRegistry', () => {
  it('accepts a valid document and applies defaults', () => {
    const result = parseRegistry(valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.plugins[0]?.tags).toEqual([])
      expect(result.data.plugins[0]?.verified).toBe(false)
    }
  })

  it('rejects a bad plugin id slug', () => {
    const result = parseRegistry({
      ...valid,
      plugins: [{ ...valid.plugins[0]!, id: 'Bad_Id' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/slug/)
  })

  it('rejects an unknown source type', () => {
    const result = parseRegistry({
      ...valid,
      plugins: [{ ...valid.plugins[0]!, source: { type: 'ftp', host: 'x' } }],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a wrong schema version', () => {
    const result = parseRegistry({ ...valid, schemaVersion: 2 })
    expect(result.ok).toBe(false)
  })
})
