# 开发指南

## 环境要求

Node ≥ 20、pnpm ≥ 9、本地可用的 `dsh` 与 `pnpm`（安装功能需要；搜索/分类只读不需要）。

## 常用命令

```sh
pnpm install
pnpm dshm <cmd>        # tsx 直跑 CLI 源码
pnpm test              # vitest 单测
pnpm lint              # oxlint
pnpm typecheck         # 各包 tsc --noEmit
pnpm build             # tsup 产物到各包 lib/
pnpm seed              # 重新生成 registry/default/registry.yaml
```

## 代码组织约定

- **core 不依赖任何 UI/CLI 概念**；所有进程与文件副作用走 `Runner` 接口（`src/runner.ts`），单测用 `FakeRunner`（真实临时目录 + 脚本化命令响应）注入。
- **纯逻辑优先**：schema/search/patchfile/store/spec 都是纯函数或近纯函数，installer 是唯一编排层。
- **测试即规约**：patchfile 的用户内容保留、`[]` 占位替换、store 两阶段、allowBuilds 拒绝路径都有对应用例；改这些行为先改测试。
- 风格：无分号、单引号、100 列（prettier 统一）；oxlint 与 harness 技术栈一致。
- CLI 的 tsconfig 用 `paths` 把 `@dshm/core` 映射到源码，typecheck 不依赖构建产物；运行（tsx/dist）走 workspace 依赖的 `lib/`，改 core 后需 `pnpm build` 再用 dist 验证。

## 验证安装链路（不动真实 web profile）

```sh
export DSHM_HOME=$(mktemp -d)          # 隔离 dshm 自身状态
# 准备一个 scratch bundle（package.json 带 dsh.bundle.patch）+ scratch registry.yaml
node packages/cli/lib/bin.js registry add scratch --file /path/to/scratch-registry.yaml
node packages/cli/lib/bin.js install <id> --profile dshm-demo --yes
dsh --profile dshm-demo --dump-config  # 应出现 # == <bundle> 或托管 insert 行
node packages/cli/lib/bin.js uninstall <id> --profile dshm-demo
```

## 提交与版本

- conventional commits（`feat:` / `fix:` / `docs:` / `chore:` …）。
- CI 在 `.github/workflows/ci.yml`：lint → typecheck → test → build，Node 22/24 矩阵。

## 发布 dshm-cli（GitHub Actions 自动发布，无需本地 npm 登录）

一次性配置——在仓库里存一个 npm 发布令牌：

1. npmjs.com → 头像 → **Access Tokens** → Generate New Token（Granular，Packages 读写权限；或 Classic 的 Automation 类型）；
2. 复制令牌 → GitHub 仓库 → **Settings → Secrets and variables → Actions** → New repository secret，名称 **`NPM_TOKEN`**，值为令牌。

之后每次发版只需：

```sh
# 1. 改 packages/cli/package.json 的 version
# 2. 提交并打标签推送：
git tag v<版本号> && git push origin v<版本号>
```

流水线（`.github/workflows/publish.yml`）自动：install → verify（lint+typecheck+57 测试+build）→ `npm publish`。也可以不打标签，直接在 GitHub **Actions → Publish dshm-cli → Run workflow** 手动触发（发布 package.json 里的当前版本）。

`NPM_TOKEN` 失效或未配置时该 workflow 会失败（401/403），在 Actions 页重新配置密钥后可对同一标签 **Re-run jobs**。

## 已知边界（一期）

- `upgrade`/`outdated` 命令与 HTTP registry 的 JSON API 形态留给二期。
- git 源 subdir 安装会完整 clone（浅优化未做）。
- `allowBuilds` 语义按 pnpm ≥10 的输出解析；pnpm 9 无此门槛，不触发。
