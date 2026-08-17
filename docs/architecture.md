# 架构

English title: Architecture. 本文描述 dsh-plugin-marketplace 一期（core + cli）的分层与关键决策依据，以及二期的演进接口。

## 分层

```
┌────────────────────────────────────────────┐
│ cli (@dshm/cli)  dshm 命令、确认交互、输出排版 │  ← 只有这一层面对用户
├────────────────────────────────────────────┤
│ core (@dshm/core)                           │
│  schema/registry/search   纯数据逻辑         │
│  patchfile/store/spec      纯文本与状态逻辑   │
│  installer/dsh             进程编排          │
│  Runner 接口               所有进程/文件副作用 │ ← 单测注入 FakeRunner
├────────────────────────────────────────────┤
│ 外部系统：dsh plugin（pnpm 转发）、git、HTTP   │
└────────────────────────────────────────────┘
```

（二期）server + admin 作为 core 之上的另外两个外壳，与 cli 平行。

## 关键决策与依据

### 安装委托 `dsh plugin`，不自造安装器

harness 的 `dsh plugin --profile P <pnpm args>` 已解决：profile 自动初始化、依赖安装、`dsh.profile.bundles` 协调（声明了 `dsh.bundle.patch` 的包自动进层栈）。marketplace 只负责三件事：把 `source` 构造成 pnpm spec、处理 pnpm 的 `allowBuilds` 门槛（显式确认后代写 profile 的 `pnpm-workspace.yaml`）、把结果记进自己的 store。

注意：profile 目录带 `pnpm-workspace.yaml`，pnpm 视其为 workspace 根，`add`/`remove` 必须带 `-w`（真实环境验证发现）。

### 单文件插件走 profile 托管块

没有 package.json 的单文件插件无法被 pnpm 安装。dshm 把它复制到 `$DSH_HOME/profiles/P/dshm/<id>/index.<ext>`，并在 profile 的 `cordis.patch.yml` 追加 marker 注释包围的托管块。**文本切片而非 YAML 重序列化**：用户手写内容与格式逐字保留；模板初始的 `[]` 占位符会被原位替换（`[]` 后追加列表项是非法 YAML——真实环境验证发现）。卸载时移除块与目录，若文件因此无载荷则恢复 `[]`。

运行中的 dsh 监听该文件并热加载，因此安装/卸载即时生效。

### 状态与配置

- `~/.dshm/config.yaml`（`DSHM_HOME` 可覆盖，权限 600）：registry 列表、默认 profile、per-host git token。
- `~/.dshm/store.json`：按 profile 的安装记录；安装走 intent → commit 两阶段，`dshm doctor` 能发现中断残留。
- `~/.dshm/cache/`：HTTP registry 缓存（TTL 5 分钟）。

### 多 registry 与命名空间

条目以 `registry:id` 全局唯一；同名 bare id 在不同 registry 中共存，查找端（`resolvePluginById`）遇到歧义时报错并列出候选。

### 信任模型

插件是任意代码；git 源安装触发构建脚本执行。CLI 在安装前展示来源/verified/license 摘要，git 源要求确认；`allowBuilds` 授权单独确认。凭证（git token）只存在本地 config，永不进 registry 数据。

## 二期：server + admin（接口已预留）

- `@dshm/server`：Hono + SQLite(Drizzle)。公开 API `GET /api/v1/plugins|categories|search`；管理 API（Bearer token）做插件/分类 CRUD 与 registry.yaml 导入导出。表：plugins、categories、plugin_categories（多对多）、api_tokens、audit_log。
- `@dshm/admin`：React + Vite + Ant Design 后台，集中管理私有插件源、分类治理、token 与审计。
- CLI 对接方式已就绪：`dshm registry add team --url https://<server> --token <t>`（`type: http` 的 registry 一期即支持，直接拉取 YAML 文档并缓存）。
