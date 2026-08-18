import { Command } from 'commander'
import { registerCategoriesCommand } from './commands/categories.js'
import { registerDoctorCommand } from './commands/doctor.js'
import { registerInfoCommand } from './commands/info.js'
import { registerInstallCommand } from './commands/install.js'
import { registerListCommand } from './commands/list.js'
import { registerRegistryCommand } from './commands/registry.js'
import { registerSearchCommand } from './commands/search.js'
import { registerUninstallCommand } from './commands/uninstall.js'
import { registerUpdateCommand } from './commands/update.js'
import { registerVersionCommand } from './commands/version.js'
import { registerWebCommand } from './commands/web.js'
import { readOwnVersion } from './version.js'

const program = new Command()

program
  .name('dshm')
  .description('Plugin marketplace for deepseek-harness: search, install, uninstall, categorize')
  .version(readOwnVersion())
  .option('--profile <name>', 'target dsh profile (default from ~/.dshm/config.yaml)')

registerSearchCommand(program)
registerInfoCommand(program)
registerInstallCommand(program)
registerUninstallCommand(program)
registerListCommand(program)
registerCategoriesCommand(program)
registerRegistryCommand(program)
registerDoctorCommand(program)
registerVersionCommand(program)
registerUpdateCommand(program)
registerWebCommand(program)

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
