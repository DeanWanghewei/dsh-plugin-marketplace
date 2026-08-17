import { createInterface } from 'node:readline/promises'

/** Minimal y/N prompt; resolves false on EOF (non-interactive stdin). */
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}
