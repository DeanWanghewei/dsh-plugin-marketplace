# dsh-plugin-marketplace

deepseek-harness（DSH）的插件市场：搜索、分类、安装、卸载插件。`dshm` CLI 是一期交付物；registry 服务与后台管理是二期规划（见 [docs/architecture.md](docs/architecture.md)）。

> **快速接入请直接读 [docs/usage.md](docs/usage.md)**（使用指南：五分钟跑通 + 命令速查 + 场景手册 + 故障排查）。

## 快速开始

```sh
pnpm install
pnpm build
node packages/cli/lib/bin.js doctor        # 检查 dsh / pnpm / $DSH_HOME / registry
node packages/cli/lib/bin.js search cordis
node packages/cli/lib/bin.js categories
node packages/cli/lib/bin.js info tool-cordis
node packages/cli/lib/bin.js install tool-cordis --profile web
node packages/cli/lib/bin.js uninstall tool-cordis --profile web
```

开发期别名：`pnpm dshm <命令>`（tsx 直跑源码）。

## 工作原理

- **插件来源三种共存**（registry 判别式 `source.type`）：`npm`（包名+版本）、`git`（公有/私有仓库，支持 ref 与 subdir）、`path`（本地包目录或单文件）。
- **安装委托 `dsh plugin --profile P add <spec>`**：npm/git/包目录统一走 pnpm spec；声明了 `dsh.bundle.patch` 的包自动进入 bundle 层。**单文件插件**复制进 `$DSH_HOME/profiles/P/dshm/<id>/`，并在 profile 的 `cordis.patch.yml` 里追加带 marker 的托管块（绝不整体重写用户文件）。
- **热生效**：运行中的 dsh 会监听 profile 的 `cordis.patch.yml`，安装/卸载无需重启。
- **多 registry**：`dshm registry add <name> --file <path> | --url <url>`；插件以 `registry:id` 命名空间区分。
- **一插件多分类**：`categories` 为数组，搜索按 OR 过滤。
- **私有 git**：ssh 形式零配置走本机密钥；https 形式用 `~/.dshm/config.yaml` 里 per-host token（凭证永不写入 registry 数据）。

## 目录

```
packages/core    @dshm/core   领域核心：registry 模型/搜索/安装编排（进程与文件操作在 Runner 接口之后）
packages/cli     @dshm/cli    dshm 命令行
registry/default              内置种子 registry（由 scripts/seed-from-harness.ts 生成，勿手改）
docs/                         架构、registry 格式、开发指南
```

## 开发

```sh
pnpm test        # vitest（39 用例）
pnpm lint        # oxlint
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup → lib/
pnpm seed        # 重新扫描本地 harness checkout 生成种子 registry
```

CI（GitHub Actions）按 lint → typecheck → test → build 执行（Node 22/24 矩阵）。

## 安全注意

插件是任意 TypeScript/JavaScript 代码；git 源安装会执行包的构建脚本（pnpm `allowBuilds` 门槛即为此设计，`dshm` 会显式询问）。只安装信任来源的插件；registry 的 `verified`/`author`/`license` 元数据会随安装摘要展示。
