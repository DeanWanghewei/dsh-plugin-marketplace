import pc from 'picocolors'
import type { LocalizedText } from '@dshm/core'

export { pc }

export function pickLocalized(text: LocalizedText | undefined, lang: string): string {
  if (!text) return ''
  const preferZh = lang.toLowerCase().startsWith('zh')
  return ((preferZh ? text.zh : text.en) ?? text.en ?? text.zh ?? '') as string
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  )
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => (cell ?? '').padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd()
  return [line(headers), ...rows.map(line)].join('\n')
}

export function printTable(headers: string[], rows: string[][]): void {
  console.log(table(headers, rows))
}

/** Indent every line but the first — for multi-line values in listings. */
export function wrap(text: string, indent: string): string {
  return text.replace(/\n/g, `\n${indent}`)
}
