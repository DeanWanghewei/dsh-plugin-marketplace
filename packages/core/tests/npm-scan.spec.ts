import { describe, expect, it } from 'vitest'
import { idFromNpmNameForTest } from './npm-scan-test-exports.js'

describe('npm-scan id derivation', () => {
  it('derives plugin ids from scoped npm names', () => {
    expect(idFromNpmNameForTest('@deepseek-ai/dsh-tool-cordis', '@deepseek-ai/dsh')).toBe('tool-cordis')
    expect(idFromNpmNameForTest('@deepseek-ai/dsh', '@deepseek-ai/dsh')).toBe('')
    expect(idFromNpmNameForTest('@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh')).toBe('mcp-client')
  })
})
