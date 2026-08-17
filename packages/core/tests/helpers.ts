import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeRunner, type ExecOptions, type ExecResult, type Runner } from '../src/index.js'

type Handler = (args: string[], options: ExecOptions | undefined) => Partial<ExecResult> | undefined

/**
 * Real filesystem inside a temp directory, scripted command responses. Used to
 * drive the installer without shelling out to the real `dsh`/`pnpm`/`which`.
 */
export class FakeRunner extends NodeRunner implements Runner {
  readonly handlers: Array<{ match: (command: string, args: string[]) => boolean; handle: Handler }>

  constructor() {
    super()
    this.handlers = [
      {
        match: (command) => command === 'which',
        handle: () => ({ ok: true, stdout: '/usr/bin/fake\n', stderr: '' }),
      },
    ]
  }

  on(match: (command: string, args: string[]) => boolean, handle: Handler): this {
    this.handlers.push({ match, handle })
    return this
  }

  override async run(command: string, args: string[], options?: ExecOptions): Promise<ExecResult> {
    // Later registrations win: specific handlers registered after the generic
    // dsh/pnpm one must take precedence.
    for (const { match, handle } of [...this.handlers].reverse()) {
      if (match(command, args)) {
        const result = handle(args, options)
        return {
          ok: result?.ok ?? true,
          stdout: result?.stdout ?? '',
          stderr: result?.stderr ?? '',
          command: `${command} ${args.join(' ')}`,
        }
      }
    }
    return { ok: false, stdout: '', stderr: `no fake handler for ${command}`, command }
  }
}

export interface TestEnv {
  env: NodeJS.ProcessEnv
  dshmHome: string
  dshHome: string
}

export function makeTestEnv(): TestEnv {
  const base = mkdtempSync(join(tmpdir(), 'dshm-test-'))
  const env: NodeJS.ProcessEnv = {
    HOME: base,
    DSH_HOME: join(base, '.dsh'),
    DSHM_HOME: join(base, '.dshm'),
    PATH: process.env['PATH'] ?? '',
  }
  return { env, dshmHome: env['DSHM_HOME']!, dshHome: env['DSH_HOME']! }
}
