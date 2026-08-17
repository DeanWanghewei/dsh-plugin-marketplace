import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

export interface ExecOptions {
  cwd?: string
  env?: Record<string, string>
}

export interface ExecResult {
  ok: boolean
  stdout: string
  stderr: string
  command: string
}

/**
 * All process and filesystem effects the installer needs, behind one interface so
 * unit tests can inject a fake instead of shelling out to the real `dsh`.
 */
export interface Runner {
  run(command: string, args: string[], options?: ExecOptions): Promise<ExecResult>
  exists(path: string): boolean
  isFile(path: string): boolean
  readTextFile(path: string): string | undefined
  writeTextFile(path: string, content: string): void
  rename(from: string, to: string): void
  mkdir(path: string): void
  copyFile(from: string, to: string): void
  rm(path: string): void
  restrictPermissions(path: string): void
  nowIso(): string
}

export class NodeRunner implements Runner {
  async run(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const env = options.env ? { ...process.env, ...options.env } : process.env
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const full = `${command} ${args.join(' ')}`
    if (result.error) {
      return { ok: false, stdout: '', stderr: String(result.error.message), command: full }
    }
    return {
      ok: result.status === 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      command: full,
    }
  }

  exists(path: string): boolean {
    return existsSync(path)
  }

  isFile(path: string): boolean {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  }

  readTextFile(path: string): string | undefined {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  }

  writeTextFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }

  rename(from: string, to: string): void {
    renameSync(from, to)
  }

  mkdir(path: string): void {
    mkdirSync(path, { recursive: true })
  }

  copyFile(from: string, to: string): void {
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }

  rm(path: string): void {
    rmSync(path, { recursive: true, force: true })
  }

  restrictPermissions(path: string): void {
    chmodSync(path, 0o600)
  }

  nowIso(): string {
    return new Date().toISOString()
  }
}

/** True when a command exists on PATH (resolved without throwing). */
export async function commandExists(runner: Runner, command: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const result = await runner.run(probe, [command])
  return result.ok
}
