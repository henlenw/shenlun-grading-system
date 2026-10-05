# 部署与维护

本仓库为脱敏源码，没有关联任何已经运行的网站或云账号。部署前使用自己的域名、数据库、存储桶和服务端凭据。

1. 本地按 README 初始化并执行测试、构建。
2. 复制 deploy/cloud.env.example 到安全的运行时密钥配置。SESSION_SECRET、BOOTSTRAP_TOKEN 均需独立随机值。不要将真实配置提交 Git。
3. 普通 PostgreSQL 使用 scripts/database-schema.mjs 生成对应 schema，并执行版本化迁移。CloudBase HTTPS 数据层的初始化、RLS 与 RPC 说明见 docs/CLOUDBASE-DATA-LAYER.md。
4. 新库按迁移顺序建立结构；已有库必须先备份，再应用尚未执行的增量迁移。不要重置数据库或把旧备份覆盖现有业务库。
5. 使用 deploy/Dockerfile.cloud 构建网站/API 单服务镜像，或使用根目录 Docker Compose 的持久卷模式。服务端密钥只作为运行时变量注入。
6. 确认 HTTPS、初始化锁定、学生之间隔离、私有文件鉴权、登录/退出及备份可用。

默认 AI_PROVIDER=manual、OCR_ENABLED=false。可选 AI/OCR 源码并不代表已经启用，发布网站无需开启这些服务。资源额度和价格应由部署账号自行核查；本仓库不携带或修改计费设置。

数据库和附件备份属于敏感数据，应另存于受控位置，不放进 GitHub。导出和恢复脚本需管理员权限，恢复只能指向已确认的空目标库。
