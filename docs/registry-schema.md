# Registry 数据格式

一个 registry 是一个 YAML 文档（本地文件或 HTTP 端点返回），由 `@dshm/core` 的 zod schema 校验（`schemaVersion: 1`）。

```yaml
schemaVersion: 1
name: my-registry # registry 名，用于命名空间 my-registry:<plugin-id>

categories: # 分类体系（一插件可挂多分类，多对多）
  - id: agent-tool # 小写 slug
    name: { zh: 智能体工具, en: Agent Tool } # 双语标签，至少一种
    parent: null # 可选父分类 id
    description: 模型可调用的工具插件

plugins:
  - id: tool-cordis # 小写 slug，registry 内唯一
    name: 展示名
    description: 一句话描述
    categories: [agent-tool, extension] # 引用 categories[].id；未知 id 会被警告
    tags: [cordis]
    author: deepseek-ai
    homepage: https://...
    license: MIT
    verified: true # registry 方的背书标记，随安装摘要展示

    # source 为判别式联合，三选一：
    source:
      type: npm
      package: '@deepseek-ai/dsh-tool-cordis'
    # ── 或 ──
    source:
      type: git
      url: 'github:you/plugin' # 或 git+ssh://… 或 https://…
      ref: '<sha|branch|tag>' # 建议固定 commit，防供应链漂移
      subdir: packages/x # monorepo 子包：dshm 会先 clone 再本地安装
      private: true # 仅标记；https 凭证在用户本地 ~/.dshm/config.yaml
    # ── 或 ──
    source:
      type: path
      path: /abs/path/to/pkg-or-file # 目录=包安装；文件=托管块安装
      link: false # true 时用 pnpm link:（开发期热改）
```

## 安装语义（按 source 类型）

| source                 | 安装                                                       | 卸载                                     |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| npm / git / path(目录) | `dsh plugin --profile P add -w <spec>`                     | `dsh plugin --profile P remove -w <pkg>` |
| path(文件)             | 复制到 profile 的 `dshm/<id>/` + `cordis.patch.yml` 托管块 | 移除块与目录                             |

## 默认 registry

`registry/default/registry.yaml` 由 `scripts/seed-from-harness.ts` 从本地 deepseek-harness checkout 生成（`pnpm seed [harness根目录] [输出路径]`，或 `HARNESS_ROOT` 环境变量），**不要手改**。分类规则：目录组（extensions→extension、bundle→bundle、llm→adapter、client/web/ui-*→ui、sdk→sdk）+ 源码扫描（引用 `defineTool` → agent-tool）+ 兜底 infrastructure；examples/ 下每个子目录记为 example。

## 挂接私有 registry

```sh
dshm registry add team --url https://dshm.example.com/registry.yaml --token <t>
# 或本地文件
dshm registry add local --file /path/to/registry.yaml
dshm registry list
dshm registry remove team
```
