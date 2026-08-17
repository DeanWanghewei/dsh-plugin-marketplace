import { NodeRunner, type ExecOptions, type ExecResult } from '@dshm/core'

type Handler = (args: string[], options: ExecOptions | undefined) => Partial<ExecResult> | undefined

/** Real filesystem in temp dirs + scripted dsh/pnpm responses (reuse of the core test pattern). */
export class FakeRunner extends NodeRunner {
  readonly handlers: Array<{ match: (command: string, args: string[]) => boolean; handle: Handler }>

  constructor() {
    super()
    this.handlers = [
      {
        match: (command) => command === 'which',
        handle: () => ({ ok: true, stdout: '/usr/bin/fake\n', stderr: '' }),
      },
      {
        match: (command) => command === 'dsh' || command === 'pnpm',
        handle: () => ({ ok: true, stdout: '0.1.0\n', stderr: '' }),
      },
    ]
  }

  on(match: (command: string, args: string[]) => boolean, handle: Handler): this {
    this.handlers.push({ match, handle })
    return this
  }

  override async run(
    command: string,
    args: string[],
    options?: ExecOptions,
  ): Promise<ExecResult> {
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
