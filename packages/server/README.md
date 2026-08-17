# @dshm/server

dshm 的集中式 registry 服务：**SQLite / MySQL 双后端**的插件索引库，提供 JSON API、管理 CRUD、令牌鉴权与审计，并导出 CLI 直接消费的 registry.yaml。后台管理 Web 界面（React）规划中，接口已定型。

## 快速开始

```sh
pnpm build
# SQLite（默认，零外部依赖）
node packages/server/lib/main.js import packages/cli/registry/default/registry.yaml --db /tmp/registry.db
DSHM_ADMIN_TOKEN=<你的管理令牌> node packages/server/lib/main.js serve --port 8790 --db /tmp/registry.db --name team

# MySQL —— 只换 --db 参数，其余完全一致
node packages/server/lib/main.js serve --db 'mysql://user:pass@host:3306/dshm' --name team
```

客户端挂载（现有 dshm 无需任何改动）：

```sh
dshm registry add team --url http://<host>:8790/api/v1/export [--token <t>]
dshm search cordis --registry team
```

`--db` 取值：`mysql://` / `mariadb://` URL 走 MySQL（mysql2 连接池），其余按 SQLite 文件路径处理（Node 内置 `node:sqlite`，需 Node ≥ 22.13）。也可用环境变量 `DSHM_DB_URL`。

## API

| 方法            | 路径                                               | 说明                                                    |
| --------------- | -------------------------------------------------- | ------------------------------------------------------- |
| GET             | `/health`                                          | 存活 + 插件总数                                         |
| GET             | `/api/v1/plugins?q=&category=&tag=&limit=&offset=` | 索引化查询（LIKE 命中 id/名称/描述/标签；分类 OR 过滤） |
| GET             | `/api/v1/plugins/:id`                              | 单个插件                                                |
| GET             | `/api/v1/categories`                               | 分类 + 每类插件数（多对多）                             |
| GET             | `/api/v1/export`                                   | registry.yaml 文档（CLI 直接消费）                      |
| PUT/DELETE      | `/api/v1/admin/plugins/:id`                        | 插件写入/删除（body 为插件条目 JSON，id 以路径为准）    |
| PUT/DELETE      | `/api/v1/admin/categories/:id`                     | 分类治理                                                |
| POST            | `/api/v1/admin/import?mode=replace\|merge`         | 导入 registry.yaml（YAML 或 JSON body）                 |
| GET/POST/DELETE | `/api/v1/admin/tokens[/:name]`                     | 令牌管理（创建时明文只显示一次）                        |
| GET             | `/api/v1/admin/audit`                              | 审计日志（所有管理变更）                                |

管理路由需 `Authorization: Bearer <token>` 且令牌具 admin 权限；读取路由默认公开。所有管理变更写入 audit_log（含操作者令牌名）。

## dshm-server CLI

```
dshm-server serve  [--port 8790] [--name team]      # 起服务；DSHM_ADMIN_TOKEN 首次启动注入管理令牌
dshm-server import <registry.yaml> [--mode replace|merge]
dshm-server token create <name> [--admin]           # 打印明文令牌（仅此一次）
dshm-server token list / revoke <name>
```

## 架构要点

- **驱动抽象**（`src/driver-types.ts`）：`SqlDriver` 统一 `all/get/run/exec/transaction`；两方言仅 DDL 与 upsert 语句不同（SQLite `ON CONFLICT` vs MySQL `ON DUPLICATE KEY`），其余 SQL 全部可移植（`?` 占位符）。
- **为什么快**：索引常驻（name/source_type/updated_at + 分类连接表索引），预编译语句复用，进程内热查询；相比 CLI 每次解析整份 YAML，服务端一次导入后查询为毫秒级，客户端还有 5 分钟 TTL 缓存。
- **安全**：令牌仅存 sha256 哈希；MySQL DDL 强制 utf8mb4；连接串中的密码在日志里脱敏。
- MySQL 测试：`DSHM_TEST_MYSQL_URL=mysql://… pnpm test`（未设置时该组自动跳过，SQLite 组始终运行）。
