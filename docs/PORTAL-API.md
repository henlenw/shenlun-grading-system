# 本次新增与扩展 API

除登录/激活和工作进程接口外均沿用会话与角色鉴权；浏览器写入需 Origin + X-CSRF-Token，原生小程序使用 Bearer token。

| 方法 | 路径（均以 /api 开头）                  | 行为                                                                    |
| ---- | --------------------------------------- | ----------------------------------------------------------------------- |
| POST | /auth/student/activate                  | bindingCode + username + password，复用老师档案并消耗码，签发浏览器会话 |
| POST | /auth/student/login                     | username + password，学生密码登录，返回 user/csrfToken，cookie HttpOnly |
| POST | /auth/wechat/link                       | bindToken + 已有网页账号密码，绑定同一 User，返回原生 Bearer 会话       |
| GET  | /student/account                        | 当前账号与微信绑定状态                                                  |
| PUT  | /student/account                        | 设置/修改网页账号；已有密码须 currentPassword，其他会话注销             |
| POST | /teacher/students/:id/reset-web-account | 所属老师重置网页密码、注销所有会话，返回一次性激活码，保留微信和历史    |
| POST | /worker/claim                           | 专用工作进程令牌；领取十分钟租约，只在 remote-worker 模式启用           |
| GET  | /worker/:id/files/:fileId               | 专用令牌 + X-Job-Lease，下载本任务原稿                                  |
| POST | /worker/:id/complete                    | 租约、识别文本、校验合格 AI 结果，创建不可变 AI 草稿；不发布最终成绩    |
| POST | /worker/:id/fail                        | 当前租约转人工等待                                                      |
| GET  | /teacher/export                         | 原有导出增加 packages/redemptionCodes（含使用记录，不含兑换明码/哈希）  |
| POST | /admin/backup                           | PostgreSQL 模式为完整逻辑数据+原稿，SQLite 模式保留 database.db 备份    |

手机网页与小程序均复用 docs/API.md 中的 /student/questions、start、attempts/draft、files、submit、reference、redeem、stats、courses、notifications。没有新增一套“网页专用作答表”。
