export * from './types.js'
export {
  categoryDefSchema,
  parseRegistry,
  pluginEntrySchema,
  pluginImageSchema,
  registryDataSchema,
  type RawRegistryInput,
} from './schema.js'
export {
  builtinRegistryPath,
  dshmPaths,
  profileDir,
  resolveDshmHome,
  resolveDshHome,
  type DshmPaths,
} from './paths.js'
export {
  CURATED_REGISTRY_NAME,
  CURATED_REGISTRY_URL,
  curatedRegistryRef,
  curatedRegistryUrl,
  defaultConfig,
  defaultRegistries,
  loadConfig,
  saveConfig,
  type DshmConfig,
  type LoadedConfig,
  type RegistryRef,
} from './config.js'
export {
  loadRegistries,
  type LoadRegistriesOptions,
  type LoadedRegistry,
  type MergeResult,
  type RegistryWarning,
} from './registry.js'
export { searchPlugins, categoryCounts, type SearchQuery, type ScoredPlugin } from './search.js'
export {
  dependencyIds,
  missingDependencies,
  type DependencyGap,
  type ServiceProviders,
} from './requires.js'
export {
  directProfilePackages,
  uncatalogedPackages,
  type UncatalogedPackage,
} from './installed.js'
export {
  installedView,
  matchProfilePlugins,
  profilePackages,
  type InstalledOrigin,
} from './installed.js'
export {
  NodeRunner,
  commandExists,
  type ExecOptions,
  type ExecResult,
  type Runner,
} from './runner.js'
export {
  disableBlock,
  disabledRowBody,
  enableBlock,
  ensureBlock,
  hasBlock,
  listBlocks,
  managedRowBody,
  removeBlock,
} from './patchfile.js'
export {
  detectEnvironment,
  dumpConfig,
  dshPlugin,
  parseAllowBuildsKeys,
  readInstalledPackageManifest,
  readProfileManifest,
  writeAllowBuilds,
  type DshEnvironment,
  type InstalledPackageManifest,
  type ProfileManifest,
} from './dsh.js'
export {
  buildPnpmSpecFromGit,
  buildPnpmSpecFromNpm,
  injectHttpsToken,
  packageNameFromGitUrl,
} from './spec.js'
export {
  disablePlugin,
  enablePlugin,
  installPlugin,
  uninstallPlugin,
  type ToggleOutcome,
  type InstallOptions,
  type InstallOutcome,
  type InstallerDeps,
  type UninstallOutcome,
} from './installer.js'
export {
  addInstalled,
  clearPending,
  findInstalled,
  listInstalled,
  loadStore,
  removeInstalled,
  saveStore,
  setPending,
} from './store.js'
