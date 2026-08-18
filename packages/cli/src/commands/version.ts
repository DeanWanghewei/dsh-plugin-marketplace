import type { Command } from 'commander'
import { pc } from '../output.js'
import { compareVersions, latestPublishedVersion, readOwnVersion } from '../version.js'

export function registerVersionCommand(program: Command): void {
  program
    .command('version')
    .description('show the current dshm-cli version (and the latest published one)')
    .action(async () => {
      const current = readOwnVersion()
      console.log(`dshm-cli ${current}`)
      const latest = await latestPublishedVersion()
      if (latest === undefined) {
        console.log(pc.dim('（无法获取 npm 上的最新版本）'))
        return
      }
      if (compareVersions(latest, current) > 0) {
        console.log(pc.yellow(`最新版本 ${latest} — 运行 dshm update 升级`))
      } else {
        console.log(pc.green('已是最新版本'))
      }
    })
}
