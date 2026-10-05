# CloudBase 免费共享 PostgreSQL 数据层

`DATABASE_PROVIDER=cloudbase-http` 使用 Prisma 6.19 的 SQL 编译器和项目内的 HTTPS driver adapter。独立客户端由 `node scripts/generate-cloudbase-client.mjs` 生成；SQLite 和普通 PostgreSQL 模式仍保留。服务端通过 CloudBase 官方 PostgREST RPC 访问数据库，不依赖共享实例不可用的 TCP 地址。

## 事务

交互式事务的每个 SQL 前缀在 PostgreSQL 子事务内预演，随后通过异常回滚；预演不会写入业务数据。后续 SQL 可以看到本次预演中的先前写入。最终提交把整个 SQL 计划放入同一个 PostgreSQL 事务，重新执行，并核对每个已返回结果的 SHA-256 摘要。读取行、查询空集、统计值、受影响行数或关系结果发生变化时，整个事务回滚并向应用返回 P2034（HTTP 409）。数据库异常同样回滚整个计划。

所有应用写入使用同一数据库 advisory transaction lock，锁仅在单次数据库请求期间持有。不得另建绕过该接口的业务写入通道。服务端确认提交完成前，接口不会返回业务成功。写入请求的 UUID 与完整计划摘要和提交回执一起落库；响应丢失时只重试相同请求，避免重复兑换、重复通知和重复发布。回执保留七天，自动清理；只读普通查询不写回执。

这种方式保留既有业务规则，但长事务会重复执行前面的 SQL，开销随语句数增加。当前限制单事务 1,000 条 SQL、8 MiB 请求，默认交互事务最长 120 秒（个别业务有更短限制）。超限或冲突会整体失败，不会部分成功。适合当前免费单实例部署；大班批量授权或大量数据备份应先进行容量测试，再将热点事务改为专用 SQL 函数或迁移至支持 TCP 的实例。

## 访问与密钥

应用表开启 RLS，撤销 PUBLIC、anon、authenticated 的权限。事务 RPC 是 SECURITY DEFINER，函数体第一步必须核查经过网关验证的 `request.jwt.claims.role = service_role`。不能仅依赖 REVOKE EXECUTE，因为 CloudBase 网关可能仍暴露 RPC 名称。

`CLOUDBASE_API_KEY` 必须是环境专用服务端 API Key，不是 Publishable Key、普通登录 AccessToken 或 CLI 交换得到的短期令牌。密钥只进入运行时环境变量，不能放进构建包、前端、原生小程序或日志。密钥有效期和轮换计划以部署账号实际配置为准。

迁移顺序：先执行 `backend/prisma-postgres/migrations/202610040001_cloud_initial/migration.sql`，再为全部应用表启用 RLS、撤销客户端权限，然后执行 `backend/prisma-cloudbase/002_http_transactions.sql`。已存在业务数据时不得重建初始表；后续结构变更必须单独编写增量迁移。运行时不自动执行管理面迁移。

## 验证

`backend/tests/cloudbase-db.test.ts` 覆盖参数转义、预演隔离、失败回滚、并发冲突、丢失提交响应后的幂等重试和匿名 RPC 拒绝。三个既有业务测试套件可通过 `CLOUDBASE_TEST_SCHEMA=kaoba_test_<32 位十六进制>` 对独立测试 schema 执行，禁止把正式 public schema 用作测试库。

原稿使用独立私有存储适配器，文件访问仍经后端鉴权。默认公网域名能用于部署验收，但腾讯云默认域名有访问提示；正式直接访问仍需绑定已备案自有域名。原生微信发布另需真实 AppID、AppSecret、合法域名配置和审核。

依据：[CloudBase RPC](https://docs.cloudbase.net/database/postgresql/rpc)、[数据库连接](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql)、[Prisma 6 无 Rust 引擎](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/no-rust-engine)。
