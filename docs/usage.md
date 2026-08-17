# dshm 使用指南（快速接入）

面向使用者的任务导向手册：拷贝命令即可跑。架构与设计依据见 [architecture.md](architecture.md)，registry 数据格式见 [registry-schema.md](registry-schema.md)。

## 0. 安装

**方式一：npm 安装（推荐，一条命令）**

```sh
npm i -g dshm     # 或先零安装试用：npx dshm doctor
dshm doctor
```

> npm 包名为 `dshm`（`dsh-plugin-marketplace` 在 npm 已被他人占用）；GitHub 仓库仍叫 [dsh-plugin-marketplace](https://github.com/DeanWanghewei/dsh-plugin-marketplace)。

**方式二：从源码（本仓库开发）**

```sh
pnpm install && pnpm build
pnpm dshm <命令>
```

源码方式默认 registry 是包内 npm 源（与发包版一致）；若想直接安装本地 harness checkout 里的包，挂上 path 源：

```sh
dshm registry add local --file registry/default/registry.yaml
```

前置依赖：本机 `dsh` 与 `pnpm` 在 PATH 上（只搜索/浏览不需要，安装需要）。第一条命令永远是体检：

```sh
dshm doctor
```

## 1. 五分钟跑通第一条链路

```sh
dshm doctor                                  # 1. 环境体检
dshm search cordis                           # 2. 搜插件（内置 registry 收录 219 个官方包）
dshm info tool-cordis                        # 3. 看详情（来源/分类/是否已装）
dshm install tool-cordis --profile web       # 4. 装进 web profile
dsh --profile web --dump-config | grep -A2 cordis   # 5. 不启动干跑验证
dshm uninstall tool-cordis --profile web     # （可选）卸载
```

要点：

- 安装目标用 `--profile` 指定（默认 `web`，可在 `~/.dshm/config.yaml` 改 `defaultProfile`）。
- **运行中的 dsh 会热监听 profile 的 `cordis.patch.yml`，装卸即时生效，无需重启**。
- 不带 `--profile` 时所有命令作用于默认 profile。

## 2. 命令速查

| 命令                            | 作用                                              | 常用选项                                                              |
| ------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `dshm search [关键词...]`       | 按关键词搜（id/名称/标签/描述，命中多字段者靠前） | `-c,--category a,b`（OR）、`-t,--tag`、`-r,--registry`、`--limit N`   |
| `dshm categories`               | 分类体系 + 每类插件数（一插件可属多类）           | —                                                                     |
| `dshm info <id>`                | 详情 + 各 profile 的已装状态                      | —                                                                     |
| `dshm install <id>`             | 安装（见下方策略表）                              | `--profile`、`--ref <版本/分支/sha>`、`--link`、`--allow-build`、`-y` |
| `dshm uninstall <id>`           | 卸载并清理记录                                    | `--profile`                                                           |
| `dshm list`                     | 列市场插件（标记已装）                            | `--installed`（只看已装）、`--all-profiles`、`--profile`              |
| `dshm registry add/list/remove` | 管理插件源                                        | `--file <path>` 或 `--url <url> [--token <t>]`                        |
| `dshm doctor`                   | 体检：dsh/pnpm/DSH_HOME/profile/registry/中断残留 | `--profile`                                                           |

`<id>` 可用裸 id（如 `tool-cordis`）或带命名空间的完整 id（`default:tool-cordis`）；跨 registry 重名时必须用完整 id。

安装策略（由 registry 条目的 `source.type` 决定，对你透明）：

| 来源                           | 方式                                              | 生效             |
| ------------------------------ | ------------------------------------------------- | ---------------- |
| npm 包 / git 仓库 / 本地包目录 | `dsh plugin add -w <spec>`（bundle 包自动进层栈） | 重启或下次启动   |
| 单文件插件（无 package.json）  | 复制到 profile 的 `dshm/<id>/` + patch 托管块     | 运行中即时热加载 |

## 3. 常见场景

### 3.1 按分类找插件

```sh
dshm categories                       # 看有哪些类：agent-tool / extension / ui / bundle / sdk / adapter / infrastructure / example
dshm search -c agent-tool,extension   # 属于任一分类即命中（OR）
dshm search cordis -t extension       # 关键词 + 标签叠加
```

### 3.2 从私有 git 仓库安装（ssh，零配置）

```sh
# registry 条目里 source 写成 git+ssh 形式即可，凭证走本机 ssh-agent/密钥
dshm install my-plugin --ref abc123   # 建议固定 commit，防上游漂移
```

### 3.3 从私有 git 仓库安装（https + token）

```sh
# 一次性配置 per-host token（写入 ~/.dshm/config.yaml，权限 600，不入 registry）
$EDITOR ~/.dshm/config.yaml
```

```yaml
gitTokens:
  git.mycompany.com: ghp_xxxxxxxxxxxx
```

之后安装 `https://git.mycompany.com/grp/plugin` 形式的条目会自动注入凭证。monorepo 子包用条目的 `subdir` 字段（dshm 先 clone 再本地安装）。

### 3.4 本地开发中的插件（边改边跑）

```sh
# registry 条目 source: { type: path, path: /abs/pkg-dir, link: true }
# 或安装时临时指定：
dshm install my-plugin --link         # pnpm link: 安装，源码改动直接生效
```

单文件插件更简单：registry 条目 `path` 直接指向 `.ts/.js` 文件，dshm 每次安装复制最新版。

### 3.5 把自己的插件挂进 registry

① 打成可安装包（harness 官方 bundle 格式）：

```
my-plugin/
├── package.json        # 声明 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
├── cordis.patch.yml    # - insert: [{ id: my-plugin, name: my-plugin }]
└── index.js            # export function apply(ctx) {...}
```

② 写 registry 条目并挂上：

```yaml
# my-registry.yaml（格式全文见 docs/registry-schema.md）
schemaVersion: 1
name: team
categories:
  - id: internal
    name: { zh: 内部, en: Internal }
    parent: null
plugins:
  - id: my-plugin
    name: 我的插件
    categories: [internal]
    verified: true
    source: { type: path, path: /abs/my-plugin } # 或 type: git / npm
```

```sh
dshm registry add team --file /abs/my-registry.yaml   # 或 --url https://… 团队共享
dshm install my-plugin
```

### 3.6 多 registry 共存

```sh
dshm registry list                     # 名称/类型/健康度/插件数
dshm registry add team --url https://dshm.example.com/registry.yaml --token <t>
dshm registry remove team
```

条目以 `registry:id` 命名空间隔离；同名时搜索都可见，安装需用完整 id 消歧。

## 4. 状态与文件位置

| 位置                                           | 内容                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.dshm/config.yaml`（`DSHM_HOME` 可覆盖）    | registry 列表、默认 profile、git token（600 权限）                                                                                       |
| `~/.dshm/store.json`                           | 各 profile 安装记录（两阶段写）                                                                                                          |
| `~/.dshm/cache/`、`~/.dshm/clones/`            | HTTP registry 缓存、git subdir 克隆                                                                                                      |
| `$DSH_HOME/profiles/<P>/`（默认 `~/.dsh/...`） | 安装落点：pnpm 依赖 / `dshm/<id>/` 单文件 / `cordis.patch.yml` 托管块（`# >>> dshm:<id>` … `# <<< dshm:<id>`，**可以放心手改块外内容**） |

## 5. 故障排查

先 `dshm doctor`。常见问题：

| 症状                            | 原因与处理                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| install 报 `pnpm ... -w`        | 老版本 dshm；新版本已自动带 `-w`，升级本工程 `pnpm build`                                                     |
| install 询问 build scripts      | pnpm ≥10 的 `allowBuilds` 门槛：等于授权该包在你机器上执行构建脚本，确认来源可信后 `--allow-build` 或交互确认 |
| patch 文件解析失败              | 手工编辑时动了 `# >>> dshm:`/`# <<< dshm:` 块边界；对照第 4 节格式修复，或 `dshm uninstall` 后重装            |
| doctor 提示 interrupted install | 上次安装中断；重跑 `install` 覆盖或 `uninstall` 清理残留                                                      |
| `no plugin 'x' found`           | 先 `dshm search`；跨 registry 重名用完整 id `registry:id`                                                     |
| 单文件安装报 profile 不存在     | 该 profile 从未初始化：先 `dsh --profile <P>` 启动一次，或先装一个包型插件                                    |

安全提醒：插件是任意代码，git 源安装会在安装期执行其构建脚本。只装信任来源；安装摘要里的 `verified`/`author`/`license` 是判断依据。
