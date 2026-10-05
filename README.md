# 考吧167：申论训练与人工批改

手机学生网站与教师网页后台的脱敏源码。默认使用人工批改，AI/OCR 关闭。仓库不包含任何线上账户、密钥、学生数据、上传原稿或现有部署环境；运行前需自行配置。

## 功能

- 学生登录/激活、题目授权、课程与兑换、最多三轮独立训练。
- HTML 文本材料、原生复制、教师下划线与学生独立勾画保存。
- 文字、图片、图文混合作答，草稿恢复、自动保存、图片压缩和排序。
- 教师文字及图片批注、评分、评语、正式发布与历史记录。
- SQLite 本地运行，另提供 PostgreSQL / CloudBase 数据适配与私有文件存储。

## 本地运行

需要 Node.js 24 和 pnpm 10.28.2。在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm setup
pnpm db:generate
pnpm db:migrate
pnpm dev
```

学生入口：http://localhost:3000/student/login ，教师入口：http://localhost:3000/teacher/login 。首次运行按教师页面提示初始化管理员；初始化密钥由 setup 随机生成，保存在本机被忽略的 .env 中。没有通用或预设管理员密码。

## 验证与构建

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm release
```

测试使用虚构账号、材料和隔离数据库。CloudBase 协议测试需要独立测试环境，不能连接现有业务库。

## 目录

- backend：API、权限、数据模型、增量迁移、自动测试。
- teacher-admin：手机学生网站及教师后台。
- miniprogram：历史原生小程序源码，当前不参与 workspace 构建。
- deploy、scripts：通用部署模板与维护脚本。
- docs：接口、数据层、图文作答与脱敏说明。
- assets：产品品牌资源。
- prompts、ocr：历史可选本地处理代码，默认不启用。

请阅读 [部署说明](DEPLOY.md)、[材料与图文作答](docs/MATERIAL-ANSWERS.md) 和 [脱敏记录](docs/SANITIZATION.md)。
