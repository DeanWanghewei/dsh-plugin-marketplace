import type { Command } from 'commander'
import { NodeRunner } from '@dshm/core'
import { pc } from '../output.js'
import { compareVersions, latestPublishedVersion, readOwnVersion } from '../version.js'

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('update dshm-cli itself to the latest npm release')
    .option('--registry <url>', 'npm registry to install from')
    .action(async (options: { registry?: string }) => {
      const current = readOwnVersion()
      const latest = await latestPublishedVersion(options.registry)
      if (latest === undefined) {
        console.error(pc.yellow('无法获取最新版本（网络或 registry 不可达），稍后再试'))
        process.exitCode = 1
        return
      }
      if (compareVersions(latest, current) <= 0) {
        console.log(pc.green(`已是最新版本（${current}）`))
        return
      }
      console.log(`当前 ${current} → 最新 ${latest}，开始升级…`)
      const runner = new NodeRunner()
      const args = ['install', '-g', `dshm-cli@${latest}`]
      if (options.registry) args.push(`--registry=${options.registry}`)
      const result = await runner.run('npm', args)
      if (!result.ok) {
        console.error(pc.red(`升级失败：\n${result.stderr.trim() || result.stdout.trim()}`))
        process.exitCode = 1
        return
      }
      console.log(pc.green(`已升级到 ${latest} — ${readOwnVersion() === latest ? '验证通过' : '重新打开终端后生效'}`))
    })
}
