/**
 * Managed-block editing for a profile's `cordis.patch.yml`.
 *
 * The file is user-owned free-form YAML; dshm never re-serializes it wholesale.
 * Instead each install owns one marker-delimited block, spliced in as plain text
 * so every other line — content and formatting — survives untouched.
 */

export function openMarker(id: string): string {
  return `# >>> dshm:${id}`
}

export function closeMarker(id: string): string {
  return `# <<< dshm:${id}`
}

function locateBlock(content: string, id: string): { start: number; end: number } | undefined {
  const lines = content.split('\n')
  const start = lines.findIndex((line) => line.trim() === openMarker(id))
  if (start === -1) return undefined
  const end = lines.findIndex((line) => line.trim() === closeMarker(id))
  if (end === -1 || end < start) return undefined
  return { start, end }
}

export function hasBlock(content: string, id: string): boolean {
  return locateBlock(content, id) !== undefined
}

export function listBlocks(content: string): string[] {
  const ids: string[] = []
  for (const line of content.split('\n')) {
    const match = line.trim().match(/^# >>> dshm:(.+)$/)
    if (match) ids.push(match[1] ?? '')
  }
  return ids.filter(Boolean)
}

function normalizeBody(body: string): string[] {
  return body.replace(/\n+$/, '').split('\n')
}

function isPayloadLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed !== '' && !trimmed.startsWith('#')
}

const EMPTY_PAYLOADS = new Set(['[]', 'null', '---'])

/** Index of the single placeholder payload line (`[]`/`null`/`---`), if that is all there is. */
function placeholderIndex(lines: string[]): number | undefined {
  const codeLines = lines.filter(isPayloadLine)
  if (codeLines.length === 1 && EMPTY_PAYLOADS.has(codeLines[0]!.trim())) {
    return lines.findIndex(isPayloadLine)
  }
  return undefined
}

/** Insert or atomically replace one managed block; the result always ends with a newline. */
export function ensureBlock(content: string, id: string, body: string): string {
  const blockLines = [openMarker(id), ...normalizeBody(body), closeMarker(id)]
  const existing = locateBlock(content, id)
  const lines = content.split('\n')
  if (existing) {
    return [
      ...lines.slice(0, existing.start),
      ...blockLines,
      ...lines.slice(existing.end + 1),
    ].join('\n')
  }
  // A fresh profile template ships as comments + `[]`; appending after the `[]`
  // would produce invalid YAML, so the placeholder is replaced in place.
  const placeholder = placeholderIndex(lines)
  if (placeholder !== undefined) {
    lines.splice(placeholder, 1, ...blockLines)
    return `${lines.join('\n').replace(/\n+$/, '')}\n`
  }
  if (lines.every((line) => !isPayloadLine(line))) {
    return `${[...lines.filter((line) => line.trim() !== ''), ...blockLines, ''].join('\n')}`
  }
  let base = content
  if (!base.endsWith('\n')) base += '\n'
  return `${base}${blockLines.join('\n')}\n`
}

/** Remove one managed block, restoring a `[]` payload when nothing else remains. */
export function removeBlock(content: string, id: string): string {
  const existing = locateBlock(content, id)
  if (!existing) return content
  const lines = content.split('\n')
  const before = lines.slice(0, existing.start)
  const after = lines.slice(existing.end + 1)
  while (before.length > 0 && before[before.length - 1] === '' && after[0] === '') after.shift()
  let next = [...before, ...after]
  if (next.every((line) => !isPayloadLine(line))) {
    while (next.length > 0 && next[next.length - 1] === '') next.pop()
    next.push('[]')
  }
  let joined = next.join('\n')
  if (!joined.endsWith('\n')) joined += '\n'
  return joined
}

/** Build the patch rows for one managed-row install. */
export function managedRowBody(rowId: string, entryRelPath: string): string {
  return ['- insert:', `  - id: ${rowId}`, `    name: ${entryRelPath}`].join('\n')
}
