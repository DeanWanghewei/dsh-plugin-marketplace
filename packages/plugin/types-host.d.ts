/**
 * Ambient types for the harness host API.
 *
 * The plugin deliberately declares NO dependency on @deepseek-ai/dsh-tools
 * or @deepseek-ai/cordis: at runtime they resolve from the running dsh
 * process (profile node_modules walk → installation symlink farm), so the
 * plugin always matches the host version. These declarations mirror the
 * small surface the plugin uses (see the harness tool tutorial,
 * docs/user/develop/basic/tool.md) and exist only for typecheck — the real
 * DSL validates shapes at load time.
 */

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolParameter {
    type: 'string' | 'boolean' | 'number'
    required?: boolean
    description?: string
  }
  export interface ToolParameters {
    [key: string]: ToolParameter
  }
  type Primitive<D extends ToolParameter> = D extends { type: 'number' }
    ? number
    : D extends { type: 'boolean' }
      ? boolean
      : string
  type InferredArgs<P extends ToolParameters> = {
    [K in keyof P as P[K] extends { required: true } ? K : never]: Primitive<P[K]>
  } & {
    [K in keyof P as P[K] extends { required: true } ? never : K]?: Primitive<P[K]>
  }

  export function defineTool<P extends ToolParameters>(tool: {
    name: string
    description: string
    parameters: P
    output: {
      schema: unknown
      render: (args: InferredArgs<P>, value: string) => Array<{ type: 'text'; text: string }>
    }
    execute: (args: InferredArgs<P>) => Promise<string>
  }): unknown
}

declare module '@deepseek-ai/cordis' {
  export interface Context {
    tools: {
      register(tool: unknown): unknown
    }
  }
}
