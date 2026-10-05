# 考吧167 API 与权限

默认前缀 /api，JSON UTF-8；失败响应 {message,issues?}。400 输入不合法，401 会话失效，403 未授权或 CSRF 失败，404 不存在/不可见，409 状态、版本或轮次冲突，413 文件超限，422 PDF 无法预览，429 频率限制，503 未配置。

教师 HttpOnly / SameSite=Strict Cookie，写请求带匹配 APP_URL 的 Origin 与 /auth/me 返回的 X-CSRF-Token。生产 Cookie 有 Secure。小程序使用 Authorization: Bearer token。随机会话摘要存库，7 天过期，每次验证账号停用状态。学生/教师/管理员权限以及数据归属均在服务器检查。

## 身份

| 方法     | 路径              | 请求 / 结果                                                    |
| -------- | ----------------- | -------------------------------------------------------------- |
| GET/POST | /auth/setup       | 是否初始化；首次 POST 需 username/password/name/bootstrapToken |
| POST     | /auth/login       | 教师 username/password                                         |
| GET      | /auth/me          | 当前用户与 CSRF                                                |
| POST     | /auth/logout      | 撤销当前会话                                                   |
| POST     | /auth/wechat      | 真实 wx.login code                                             |
| POST     | /auth/wechat/bind | bindToken + 6 位 bindingCode                                   |

未绑定票据 5 分钟、最多 5 次尝试；绑定码 24 小时、一次性。不给前端 openid、session_key 或 AppSecret。

## 学生

| 方法   | 路径                                      | 用途                                                                |
| ------ | ----------------------------------------- | ------------------------------------------------------------------- |
| GET    | /student/questions                        | 已授权题目＋自己的已提交历史；authorized、latest、scores、completed |
| GET    | /student/questions/:id                    | 题目、三轮历史、分数变化和 referenceUnlocked                        |
| POST   | /student/questions/:id/start              | 获取/创建当前允许的草稿，返回 assignmentId                          |
| GET    | /student/questions/:id/reference          | 首轮已发布且允许开放时返回参考答案/rubric/得分点；否则 403          |
| POST   | /student/redeem                           | code；原子消费并授予包内题目和课程                                  |
| GET    | /student/courses                          | 本人的课程权益、服务类型，不含老师内部备注                          |
| GET    | /student/assignments                      | 兼容原作业列表，含 questionId                                       |
| GET    | /student/assignments/:id                  | 作业对应题目的本人全局轮次，正式反馈                                |
| GET    | /student/submissions/:id                  | 仅本人 Submission                                                   |
| POST   | /student/assignments/:id/draft            | 同样遵守按学生＋题目三次限制                                        |
| PUT    | /student/attempts/:id/draft               | text、version；返回递增 version                                     |
| POST   | /student/attempts/:id/submit              | version；幂等提交并冻结内容                                         |
| POST   | /student/attempts/:id/files?name=原文件名 | multipart 单 file；返回附件及 version                               |
| DELETE | /student/files/:id                        | 已授权且尚未提交的本人附件                                          |
| GET    | /student/notifications                    | 本人通知                                                            |
| POST   | /student/notifications/read               | 本人全部标已读                                                      |
| GET    | /student/stats                            | 已发布分数、薄弱点、活跃授权与三轮完成统计                          |

每个 Attempt 有 questionId、studentId、roundNo 唯一键。首轮独立作答；后续必须有上一轮 FinalGrade.status=PUBLISHED。第四次、撤权、重复布置绕过均拒绝。旧数据超过三轮只读保留。三轮共享首次题目快照。

学生 Attempt 为显式字段投影；finalGrade=null 直到发布。AIGrade/AIAnnotation/OCR 错误信息/内部备注/TeacherReview 草稿永不返回。参考答案只从单独的解锁接口读取。原文与提取文本可见；批注只来自发布快照。每轮附 public question 快照，历史满分不跟随题库变化。

## 题库、学生、授权

| 方法      | 路径                               | 说明                                                       |
| --------- | ---------------------------------- | ---------------------------------------------------------- |
| GET/POST  | /teacher/students                  | 列表/创建及绑定码                                          |
| GET/PATCH | /teacher/students/:id              | 详情；更新 name/contact/disabled/serviceType/notes         |
| POST      | /teacher/students/:id/binding-code | 重发未绑定学生的码                                         |
| GET/POST  | /teacher/questions                 | 分类题库；Question 与 scoringPoints                        |
| GET/PUT   | /teacher/questions/:id             | 查看/完整编辑，不改已开始训练的快照                        |
| GET/POST  | /teacher/assignments               | 创建需 questionId/studentIds/title/dueAt，同时授予题目权限 |
| PATCH     | /teacher/assignments/:id           | 延长截止日期                                               |
| GET/POST  | /teacher/permissions               | 列表/批量授权                                              |
| PATCH     | /teacher/permissions/:id           | revoked、referenceUnlocked                                 |
| GET/POST  | /teacher/packages                  | 试卷包 name/description/questionIds/courseIds              |
| GET/POST  | /teacher/redemption-codes          | 列表脱敏；生成返回一次性明文                               |
| PATCH     | /teacher/redemption-codes/:id      | disabled                                                   |
| GET/POST  | /teacher/courses                   | 课程权益目录                                               |
| PATCH     | /teacher/course-permissions/:id    | revoked、note                                              |

题目字段详见 backend/src/schemas.ts。scoringPoints 每项 label/description/points，合计须等于 maxScore；允许旧题没有逐项得分点。类别固定为国考、省考、专项训练、大作文、自定义试卷。allowReference、autoUnlockReference 默认 true。

批量授权 body：studentIds、questionIds、courseIds、可选 packageId、allQuestions。allQuestions 授权操作时的当前题库，不自动包含未来题目。教师须同时拥有学生和内容的管理权，管理员可跨教师授权。撤权不删除提交历史。

生成兑换码 body：packageId、expiresAt、label、count(1–100)、maxUses(1–1000)、bindFirstUser。默认 count=1/maxUses=1/bindFirstUser=true。数据库仅存 codeHash，列表不会返回它。学生接口每分钟 10 次，事务中检查有效期、已使用次数、绑定用户和教师班级，再更新计数与授权；同一用户重复兑换同一码拒绝。

## 批改工作台

| 方法 | 路径                                  | 用途                                                           |
| ---- | ------------------------------------- | -------------------------------------------------------------- |
| GET  | /teacher/workbench                    | 今日分组、队列、统计、教学日边界                               |
| GET  | /teacher/today-unreviewed?questionId= | 按题过滤今日未发布队列                                         |
| GET  | /teacher/ai-status                    | 本地模型可用性；失败仍可人工批改                               |
| GET  | /teacher/dashboard                    | 兼容原状态统计                                                 |
| GET  | /teacher/submissions                  | 授权的全部非草稿作答                                           |
| GET  | /teacher/submissions/:id              | 具体轮次、原文、附件、AI、OCR、教师草稿、正式成绩              |
| POST | /teacher/submissions/:id/manual       | 立即人工接管并结束等待任务                                     |
| PUT  | /teacher/submissions/:id/review       | 保存 version/finalScore/summary/annotations/pageAnnotations 等 |
| POST | /teacher/submissions/:id/publish      | reviewVersion，事务性发布                                      |
| POST | /teacher/submissions/:id/revision     | 已发布且不足三轮时填写 reason/requirements/dueAt               |
| POST | /teacher/submissions/:id/retry-ai     | 未生成 AIGrade 的失败任务重试                                  |

今日提交时间满足 [dayStart,dayEnd)，默认 UTC+8。最终已发布的作答不再进入队列；学生/题目/轮次单独记录。教师只能访问自己负责的 Assignment，管理员可访问全部。

review version 首次 0，之后携带返回版本。分数不能超过该轮快照满分。发布需最新版本；正式结果不可覆盖。

文字批注：UTF-16 startOffset/endOffset/selectedText/category/severity/comment/suggestion。服务器验证与原文精确匹配。

页面批注：id/fileId/page/type/x/y/width/height/color/content，可选 endX/endY；坐标归一化到 0–1，尺寸不得越界，fileId 必须属于本轮，图片页码仅 1。type 为 circle/rectangle/underline/strike/arrow/highlight/text/comment。服务器记录 author/createdAt；TeacherReview 存 JSON，发布时复制进正式快照，原文件不修改。

## 文件、导出与管理

| 方法     | 路径                             | 用途                                        |
| -------- | -------------------------------- | ------------------------------------------- |
| GET      | /files/:id                       | 仅本人/授权老师下载，不存在公开 storage URL |
| GET      | /files/:id/preview?page=1        | 图片或 PDF 页面；同样鉴权                   |
| GET      | /files/:id/preview?info=true     | 页数与可用预览信息，PDF 最多预览前 100 页   |
| GET      | /teacher/export?format=json或csv | 自己可管理的数据；排除身份密钥              |
| GET/POST | /admin/teachers                  | 管理教师                                    |
| PATCH    | /admin/teachers/:id              | disabled/password，并撤销会话               |
| GET      | /admin/status                    | 脱敏运行配置                                |
| GET      | /admin/audit                     | 最近 100 条审计                             |
| POST     | /admin/backup                    | 数据库与附件 ZIP，不含真实 .env             |
| GET      | /health                          | 数据库连通性                                |

上传校验扩展名、魔数、路径、大小、DOCX 解压限制；附件上限 10 MB / 5 个。SHA-256 去重，存储锁与引用计数保护删除。PDF 本地子进程每页 45 秒超时，同一 API 最多两个同时渲染，内存短期缓存有界，不写持久预览副本。

AI/OCR 不可用仍可完成纯人工闭环。AI_POINT 校验详见 schemas.ts、ai.ts 和评分测试；不把模型输出直接当正式成绩。
