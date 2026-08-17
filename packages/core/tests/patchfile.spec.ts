import { describe, expect, it } from 'vitest'
import { ensureBlock, hasBlock, listBlocks, managedRowBody, removeBlock } from '../src/index.js'

describe('patchfile managed blocks', () => {
  const userContent = ['# my own profile patches', '- id: mine', '  name: ./mine.ts', ''].join('\n')

  it('appends a block after user content and preserves it verbatim', () => {
    const next = ensureBlock(userContent, 'hello', managedRowBody('hello', './dshm/hello/index.ts'))
    expect(next.startsWith(userContent.replace(/\n$/, '') + '\n')).toBe(true)
    expect(next).toContain('# >>> dshm:hello')
    expect(next).toContain('name: "./dshm/hello/index.ts"')
    expect(next.endsWith('\n')).toBe(true)
  })

  it('replaces an existing block instead of duplicating it', () => {
    const once = ensureBlock(userContent, 'hello', managedRowBody('hello', './a.ts'))
    const twice = ensureBlock(once, 'hello', managedRowBody('hello', './b.ts'))
    expect(twice.match(/# >>> dshm:hello/g)).toHaveLength(1)
    expect(twice).toContain('./b.ts')
    expect(twice).not.toContain('./a.ts')
  })

  it('turns an empty or [] file into just the block', () => {
    for (const empty of ['', '[]\n', '---\n']) {
      const next = ensureBlock(empty, 'x', managedRowBody('x', './x.ts'))
      expect(next.trim().startsWith('# >>> dshm:x')).toBe(true)
    }
  })

  it('replaces the [] placeholder in a commented template instead of appending after it', () => {
    const template = [
      '# Your patch layer for this dsh profile:',
      '# a top-level YAML array of loader patch entries.',
      '[]',
      '',
    ].join('\n')
    const next = ensureBlock(template, 'x', managedRowBody('x', './x.ts'))
    expect(next).toContain('# Your patch layer')
    expect(next.indexOf('# >>> dshm:x')).toBeLessThan(next.indexOf('- insert:'))
    expect(next).not.toMatch(/\[\]\n- insert/)
  })

  it('removes its block and leaves user rows and formatting intact', () => {
    const withBlock = ensureBlock(userContent, 'hello', managedRowBody('hello', './a.ts'))
    const removed = removeBlock(withBlock, 'hello')
    expect(removed).toBe(userContent)
    expect(hasBlock(removed, 'hello')).toBe(false)
  })

  it('removal collapses stranded blank lines but keeps other blocks', () => {
    const two = ensureBlock(
      ensureBlock(userContent, 'one', managedRowBody('one', './1.ts')),
      'two',
      managedRowBody('two', './2.ts'),
    )
    const removed = removeBlock(two, 'one')
    expect(hasBlock(removed, 'two')).toBe(true)
    expect(removed).not.toMatch(/\n\n\n/)
  })

  it('removal from a file that held only the block resets to a valid empty list', () => {
    const only = ensureBlock('', 'x', managedRowBody('x', './x.ts'))
    expect(removeBlock(only, 'x')).toBe('[]\n')
  })

  it('removal restores the [] placeholder under a kept comment header', () => {
    const template = '# header\n# more\n[]\n'
    const withBlock = ensureBlock(template, 'x', managedRowBody('x', './x.ts'))
    const removed = removeBlock(withBlock, 'x')
    expect(removed.startsWith('# header')).toBe(true)
    expect(removed.trim().endsWith('[]')).toBe(true)
  })

  it('lists managed block ids', () => {
    const two = ensureBlock(
      ensureBlock('', 'one', managedRowBody('one', './1.ts')),
      'two',
      managedRowBody('two', './2.ts'),
    )
    expect(listBlocks(two)).toEqual(['one', 'two'])
  })
})
