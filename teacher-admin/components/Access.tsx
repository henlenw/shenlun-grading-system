'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, date } from '../lib/api';
import { useData, Heading, Field, ErrorBox, Empty, message } from './shared';
function Checks({
  items,
  value,
  onChange,
  prefix,
}: {
  items: any[];
  value: string[];
  onChange: (v: string[]) => void;
  prefix: string;
}) {
  return (
    <div className="checklist">
      {items.map((x) => (
        <label key={x.id}>
          <input
            type="checkbox"
            aria-label={prefix + '：' + (x.name || x.title)}
            checked={value.includes(x.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, x.id] : value.filter((id) => id !== x.id))
            }
          />
          {x.name || x.title}
        </label>
      ))}
    </div>
  );
}
export function AccessManager({ studentId }: { studentId?: string }) {
  const students = useData<any[]>('/teacher/students'),
    questions = useData<any[]>('/teacher/questions'),
    packages = useData<any[]>('/teacher/packages'),
    courses = useData<any[]>('/teacher/courses'),
    grants = useData<any[]>('/teacher/permissions');
  const [studentIds, setStudents] = useState<string[]>(studentId ? [studentId] : []),
    [questionIds, setQuestions] = useState<string[]>([]),
    [courseIds, setCourses] = useState<string[]>([]),
    [packageId, setPackage] = useState(''),
    [allQuestions, setAll] = useState(false),
    [err, setErr] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api('/teacher/permissions', 'POST', {
        studentIds,
        questionIds,
        courseIds,
        packageId: packageId || undefined,
        allQuestions,
      });
      setNotice(
        '已为 ' + r.students + ' 位学生授权 ' + r.questions + ' 道题、' + r.courses + ' 门课程',
      );
      await grants.refresh();
      await courses.refresh();
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function update(id: string, b: any) {
    try {
      await api('/teacher/permissions/' + id, 'PATCH', b);
      await grants.refresh();
    } catch (e) {
      setErr(message(e));
    }
  }
  const studentName = (id: string) => students.data?.find((s) => s.id === id)?.name || id;
  const questionName = (id: string) => questions.data?.find((q) => q.id === id)?.title || id;
  return (
    <>
      {!studentId && (
        <Heading
          title="题目与课程授权"
          desc="可组合单题、多题、试卷包和课程权限；撤销权限保留已提交的历史作答。"
        />
      )}
      <ErrorBox
        error={
          err ||
          students.error ||
          questions.error ||
          packages.error ||
          courses.error ||
          grants.error
        }
      />
      {notice && <div className="success">{notice}</div>}
      <form className="panel" onSubmit={grant}>
        <h2>发放权限</h2>
        {!studentId && (
          <>
            <h3>选择学生 · {studentIds.length} 位</h3>
            <Checks
              prefix="学生"
              items={students.data?.filter((s) => !s.disabled) || []}
              value={studentIds}
              onChange={setStudents}
            />
          </>
        )}
        <h3>选择试卷包（可与单题组合）</h3>
        <div className="field">
          <select
            aria-label="授权试卷包"
            value={packageId}
            onChange={(e) => setPackage(e.target.value)}
          >
            <option value="">不使用试卷包</option>
            {packages.data?.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <h3>题目权限</h3>
        <label className="checkline">
          <input
            type="checkbox"
            checked={allQuestions}
            onChange={(e) => setAll(e.target.checked)}
          />
          授权当前全部题库（{questions.data?.length || 0} 道）
        </label>
        {!allQuestions && (
          <Checks
            prefix="题目"
            items={questions.data || []}
            value={questionIds}
            onChange={setQuestions}
          />
        )}
        <h3>课程权益</h3>
        <p className="muted">仅记录课程权限。录播资料通过微信发送，平台不存储视频。</p>
        <Checks prefix="课程" items={courses.data || []} value={courseIds} onChange={setCourses} />
        <div className="actions">
          <button disabled={busy || !studentIds.length}>确认授权</button>
          <Link className="link" href="/teacher/redemption-codes">
            管理试卷包与兑换码
          </Link>
        </div>
      </form>
      <section className="panel">
        <h2>已有题目授权</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>学生</th>
                <th>题目</th>
                <th>权限</th>
                <th>参考答案</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {grants.data
                ?.filter((g) => !studentId || g.studentId === studentId)
                .map((g) => (
                  <tr key={g.id}>
                    <td>{studentName(g.studentId)}</td>
                    <td>{questionName(g.questionId)}</td>
                    <td>{g.revokedAt ? '已撤销' : '可作答'}</td>
                    <td>{g.referenceUnlocked ? '已手动解锁' : '按题目设置'}</td>
                    <td>
                      <div className="actions compact">
                        <button
                          className="secondary small"
                          onClick={() => update(g.id, { revoked: !g.revokedAt })}
                        >
                          {g.revokedAt ? '恢复' : '撤销'}
                        </button>
                        <button
                          className="secondary small"
                          onClick={() => update(g.id, { referenceUnlocked: !g.referenceUnlocked })}
                        >
                          {g.referenceUnlocked ? '取消手动解锁' : '首轮发布后解锁答案'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>已有课程权限</h2>
        {courses.data?.flatMap((c) =>
          c.permissions
            .filter((p: any) => !studentId || p.studentId === studentId)
            .map((p: any) => (
              <div className="access-course" key={p.id}>
                <span>
                  {studentName(p.studentId)} · {c.name} ·{' '}
                  {p.revokedAt ? '已撤销' : '可领取录播资料'}
                </span>
                <button
                  className="secondary small"
                  onClick={async () => {
                    try {
                      await api('/teacher/course-permissions/' + p.id, 'PATCH', {
                        revoked: !p.revokedAt,
                        note: p.note,
                      });
                      await courses.refresh();
                    } catch (e) {
                      setErr(message(e));
                    }
                  }}
                >
                  {p.revokedAt ? '恢复' : '撤销'}
                </button>
              </div>
            )),
        )}
      </section>
    </>
  );
}
export function RedemptionCodes() {
  const questions = useData<any[]>('/teacher/questions'),
    courses = useData<any[]>('/teacher/courses'),
    packages = useData<any[]>('/teacher/packages'),
    codes = useData<any[]>('/teacher/redemption-codes');
  const [p, setP] = useState({
      name: '',
      description: '',
      questionIds: [] as string[],
      courseIds: [] as string[],
    }),
    [b, setB] = useState({
      packageId: '',
      label: '试卷兑换',
      count: 1,
      maxUses: 1,
      bindFirstUser: true,
      expiresAt: '',
    }),
    [fresh, setFresh] = useState<any[]>([]),
    [err, setErr] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  async function createPackage(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/teacher/packages', 'POST', p);
      setP({ name: '', description: '', questionIds: [], courseIds: [] });
      setNotice('试卷包已创建');
      await packages.refresh();
      setErr('');
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setFresh(
        await api('/teacher/redemption-codes', 'POST', {
          ...b,
          expiresAt: new Date(b.expiresAt).toISOString(),
        }),
      );
      await codes.refresh();
      setErr('');
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="试卷包与兑换码"
        desc="兑换码仅用于教学授权。默认一次使用并绑定学生，不涉及在线支付。"
      />
      <ErrorBox error={err || questions.error || courses.error || packages.error || codes.error} />
      {notice && <div className="success">{notice}</div>}
      <details className="panel">
        <summary className="link">创建试卷包（可组合题目与课程）</summary>
        <form onSubmit={createPackage}>
          <Field
            name="packageName"
            label="试卷包名称"
            value={p.name}
            onChange={(_, v) => setP({ ...p, name: v })}
            required
          />
          <Field
            name="packageDescription"
            label="说明"
            value={p.description}
            onChange={(_, v) => setP({ ...p, description: v })}
          />
          <h3>包含题目</h3>
          <Checks
            prefix="包内题目"
            items={questions.data || []}
            value={p.questionIds}
            onChange={(v) => setP({ ...p, questionIds: v })}
          />
          <h3>包含课程权益</h3>
          <Checks
            prefix="包内课程"
            items={courses.data || []}
            value={p.courseIds}
            onChange={(v) => setP({ ...p, courseIds: v })}
          />
          <div className="actions">
            <button disabled={busy}>保存试卷包</button>
          </div>
        </form>
      </details>
      <form className="panel" onSubmit={generate}>
        <h2>生成兑换码</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="codePackage">选择试卷包</label>
            <select
              id="codePackage"
              value={b.packageId}
              onChange={(e) => setB({ ...b, packageId: e.target.value })}
              required
            >
              <option value="">请选择</option>
              {packages.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {JSON.parse(p.questionIds).length} 道题 /{' '}
                  {JSON.parse(p.courseIds).length} 门课程
                </option>
              ))}
            </select>
          </div>
          {[
            ['label', '备注', 'text'],
            ['count', '生成数量（1–100）', 'number'],
            ['maxUses', '每个码可兑换人数', 'number'],
            ['expiresAt', '有效期至', 'datetime-local'],
          ].map(([n, l, t]) => (
            <Field
              key={n}
              name={n}
              label={l}
              type={t}
              value={(b as any)[n]}
              onChange={(n, v) => setB({ ...b, [n]: v })}
              required
            />
          ))}
        </div>
        <label className="checkline">
          <input
            type="checkbox"
            checked={b.bindFirstUser}
            onChange={(e) => setB({ ...b, bindFirstUser: e.target.checked })}
          />
          绑定首次兑换学生（多人共用码需关闭）
        </label>
        <div className="actions">
          <button disabled={busy || !b.packageId}>生成兑换码</button>
        </div>
      </form>
      {fresh.length > 0 && (
        <section className="success">
          <h3>新生成的兑换码</h3>
          <p>明文只在本次显示，请复制保存后交给对应学生。</p>
          <textarea
            className="code-output"
            readOnly
            aria-label="新兑换码"
            value={fresh.map((x) => x.code).join('\n')}
          />
          <button
            className="secondary"
            onClick={() => {
              const blob = new Blob([fresh.map((x) => x.code).join('\r\n')], {
                  type: 'text/plain',
                }),
                url = URL.createObjectURL(blob),
                a = document.createElement('a');
              a.href = url;
              a.download = 'kaoba167-codes.txt';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 10000);
            }}
          >
            下载本批兑换码
          </button>
        </section>
      )}
      <section className="panel">
        <h2>兑换记录</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>备注 / 试卷包</th>
                <th>使用次数</th>
                <th>有效期</th>
                <th>兑换学生</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {codes.data?.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.label}
                    <div className="muted">
                      {packages.data?.find((p) => p.id === x.packageId)?.name}
                    </div>
                  </td>
                  <td>
                    {x.uses} / {x.maxUses}
                  </td>
                  <td>{date(x.expiresAt)}</td>
                  <td>
                    {x.redemptions.length
                      ? x.redemptions.map((u: any) => (
                          <div key={u.studentId}>
                            <Link className="link" href={'/teacher/students/' + u.studentId}>
                              学生详情
                            </Link>{' '}
                            · {date(u.createdAt)}
                          </div>
                        ))
                      : '未使用'}
                  </td>
                  <td>
                    <button
                      className="secondary small"
                      onClick={async () => {
                        try {
                          await api('/teacher/redemption-codes/' + x.id, 'PATCH', {
                            disabled: !x.disabled,
                          });
                          await codes.refresh();
                        } catch (e) {
                          setErr(message(e));
                        }
                      }}
                    >
                      {x.disabled ? '启用' : '停用'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
export function Courses() {
  const { data, error, refresh } = useData<any[]>('/teacher/courses');
  const [b, setB] = useState({ name: '', description: '' }),
    [err, setErr] = useState('');
  return (
    <>
      <Heading title="课程权限" desc="这里只记录教学权益，录播资料由老师通过微信发送。" />
      <ErrorBox error={err || error} />
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/teacher/courses', 'POST', b);
            setB({ name: '', description: '' });
            await refresh();
            setErr('');
          } catch (e) {
            setErr(message(e));
          }
        }}
      >
        <div className="form-grid">
          <Field
            name="courseName"
            label="课程名称"
            value={b.name}
            onChange={(_, v) => setB({ ...b, name: v })}
            required
          />
          <Field
            name="courseDescription"
            label="课程说明"
            value={b.description}
            onChange={(_, v) => setB({ ...b, description: v })}
          />
        </div>
        <div className="actions">
          <button>添加课程</button>
          <Link className="link" href="/teacher/permissions">
            给学生发放课程权益 →
          </Link>
        </div>
      </form>
      <section className="panel">
        {data?.length ? (
          data.map((c) => (
            <article className="access-course" key={c.id}>
              <div>
                <h3>{c.name}</h3>
                <p className="muted">{c.description}</p>
              </div>
              <span>{c.permissions.filter((p: any) => !p.revokedAt).length} 位已授权</span>
            </article>
          ))
        ) : (
          <Empty>还没有课程权益。</Empty>
        )}
      </section>
    </>
  );
}
export function StudentDetail({ id }: { id: string }) {
  const { data, error, refresh } = useData('/teacher/students/' + id),
    [b, setB] = useState<any>(null),
    [err, setErr] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    if (data) setB(data);
  }, [data]);
  if (!b)
    return (
      <>
        <ErrorBox error={error} />
        <Empty>正在载入学生资料…</Empty>
      </>
    );
  return (
    <>
      <Heading title={b.name + '的训练档案'} desc="查看三轮进步，管理一对一服务和授权。">
        <Link className="link" href="/teacher/students">
          返回学生列表
        </Link>
      </Heading>
      <ErrorBox error={err || error} />
      {notice && <div className="success">{notice}</div>}
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/teacher/students/' + id, 'PATCH', {
              name: b.name,
              contact: b.contact,
              disabled: b.disabled,
              serviceType: b.serviceType,
              notes: b.notes,
            });
            setNotice('学生资料已保存');
            await refresh();
          } catch (e) {
            setErr(message(e));
          }
        }}
      >
        <div className="form-grid">
          {[
            ['name', '姓名'],
            ['contact', '联系信息'],
            ['serviceType', '服务类型（如：一对一 / 小班）'],
            ['notes', '内部备注'],
          ].map(([n, l]) => (
            <Field
              key={n}
              name={n}
              label={l}
              type={n === 'notes' ? 'textarea' : 'text'}
              value={b[n]}
              onChange={(n, v) => setB({ ...b, [n]: v })}
            />
          ))}
        </div>
        <div className="actions">
          <button>保存资料</button>
        </div>
      </form>
      <section className="panel">
        <h2>训练记录</h2>
        {data?.attempts.map((a: any) => (
          <div className="access-course" key={a.id}>
            <Link className="link" href={'/teacher/review/' + a.id}>
              第 {a.roundNo} 次 · {date(a.submittedAt)}
            </Link>
            <span>
              {a.finalGrade
                ? a.finalGrade.finalScore + ' 分 · ' + date(a.finalGrade.publishedAt)
                : '尚未发布'}
            </span>
          </div>
        ))}
      </section>
      <AccessManager studentId={id} />
    </>
  );
}
