'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, date } from '../lib/api';
import { useData, ErrorBox, Empty, Heading, Field, Badge, message } from './shared';
export function Dashboard() {
  const { data, error } = useData('/teacher/dashboard');
  const submissions = useData<any[]>('/teacher/submissions');
  const c = data?.counts || {};
  return (
    <>
      <Heading title="今天，从一份好反馈开始" desc="每一次练习，都值得认真回应。" />
      <div className="welcome">
        <div>
          <h2>批改有依据，成长有记录</h2>
          <p>
            查看学生的新提交，结合辅助初批完成复核。
            <br />
            只有你确认并发布的成绩，才会出现在学生端。
          </p>
        </div>
        <span className="welcome-mark" aria-hidden>
          考吧167
        </span>
        <Link className="button" href="/teacher/submissions">
          进入批改台 →
        </Link>
      </div>
      <ErrorBox error={error} />
      <div className="stats">
        {[
          ['待处理', (c.SUBMITTED || 0) + (c.PROCESSING || 0), '份学生作答'],
          ['待复核', c.AI_GRADED || 0, '份初批已就绪'],
          ['待发布', c.TEACHER_REVIEWING || 0, '份人工批改'],
          ['需要重做', c.REVISION_REQUESTED || 0, '份待再次提交'],
        ].map(([title, n, hint]) => (
          <div className="stat" key={String(title)}>
            <span>{title}</span>
            <b>{n}</b>
            <small className="muted">{hint}</small>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="heading">
          <h2>最近提交</h2>
          <Link className="link" href="/teacher/submissions">
            全部作业 →
          </Link>
        </div>
        <ErrorBox error={submissions.error} />
        <SubmissionTable rows={submissions.data?.slice(0, 6) || []} />
      </section>
      <p className="muted">
        已管理 {data?.students ?? '—'} 位学生 · 已布置 {data?.assignments ?? '—'} 份作业
      </p>
    </>
  );
}
function SubmissionTable({ rows }: { rows: any[] }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>学生</th>
            <th>作业</th>
            <th>提交时间</th>
            <th>版本</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.submission.student.name}</td>
              <td>{r.submission.assignment.title}</td>
              <td>{date(r.submittedAt)}</td>
              <td>第 {r.attemptNo} 次</td>
              <td>
                <Badge status={r.status} />
              </td>
              <td>
                <Link className="link" href={'/teacher/submissions/' + r.id}>
                  查看批改 →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty>暂无学生提交。先创建学生和题目，再布置第一份作业。</Empty>
  );
}
export function Submissions() {
  const { data, error, loading, refresh } = useData<any[]>('/teacher/submissions');
  const [filter, setFilter] = useState('ALL');
  return (
    <>
      <Heading title="作业批改" desc="原文、辅助初批与最终反馈，在同一处完成。">
        <button className="secondary" onClick={refresh}>
          刷新列表
        </button>
      </Heading>
      <div className="actions" style={{ marginBottom: 20 }}>
        {[
          ['ALL', '全部'],
          ['AI_GRADED', '待复核'],
          ['TEACHER_REVIEWING', '复核中'],
          ['PUBLISHED', '已发布'],
          ['REVISION_REQUESTED', '需重做'],
        ].map(([k, v]) => (
          <button className={filter === k ? '' : 'secondary'} key={k} onClick={() => setFilter(k)}>
            {v}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      <section className="panel">
        {loading && !data ? (
          <Empty>正在载入…</Empty>
        ) : (
          <SubmissionTable
            rows={data?.filter((r) => filter === 'ALL' || r.status === filter) || []}
          />
        )}
      </section>
    </>
  );
}
export function Students() {
  const { data, error, refresh } = useData<any[]>('/teacher/students');
  const [b, setB] = useState({ name: '', contact: '' }),
    [err, setErr] = useState(''),
    [binding, setBinding] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const change = (n: string, v: any) => setB((x) => ({ ...x, [n]: v }));
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await api('/teacher/students', 'POST', b);
      setBinding(u);
      setB({ name: '', contact: '' });
      setErr('');
      await refresh();
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function resetAccount(s: any) {
    if (!window.confirm('重置 ' + s.name + ' 的网页密码并退出所有设备？训练记录和微信绑定将保留。'))
      return;
    try {
      const r = await api('/teacher/students/' + s.id + '/reset-web-account', 'POST', {});
      setBinding({ ...r, name: s.name });
      await refresh();
    } catch (e) {
      setErr(message(e));
    }
  }
  async function code(s: any) {
    try {
      setBinding({
        ...(await api('/teacher/students/' + s.id + '/binding-code', 'POST')),
        name: s.name,
      });
      setErr('');
    } catch (e) {
      setErr(message(e));
    }
  }
  async function edit(s: any) {
    const name = window.prompt('学生姓名', s.name);
    if (!name) return;
    const contact = window.prompt('联系信息', s.contact || '');
    if (contact === null) return;
    try {
      await api('/teacher/students/' + s.id, 'PATCH', { name, contact, disabled: s.disabled });
      await refresh();
    } catch (e) {
      setErr(message(e));
    }
  }
  async function disable(s: any) {
    if (!window.confirm('确认' + (s.disabled ? '启用' : '停用') + s.name + '的账号？')) return;
    try {
      await api('/teacher/students/' + s.id, 'PATCH', {
        name: s.name,
        contact: s.contact || '',
        disabled: !s.disabled,
      });
      await refresh();
    } catch (e) {
      setErr(message(e));
    }
  }
  return (
    <>
      <Heading
        title="学生管理"
        desc="创建学生后，将一次性绑定码交给本人，可激活网页账号或绑定微信。"
      />
      <ErrorBox error={error || err} />
      {binding && (
        <div className="success">
          <strong>{binding.name} 的绑定码</strong>
          <div className="code">{binding.bindingCode}</div>有效期至 {date(binding.expiresAt)}
          ，使用一次后失效。
          <button
            className="secondary small"
            style={{ marginLeft: 20 }}
            onClick={() => setBinding(null)}
          >
            已记录
          </button>
        </div>
      )}
      <form className="panel" onSubmit={create}>
        <h2>添加学生</h2>
        <div className="form-grid">
          <Field name="name" label="姓名" value={b.name} onChange={change} required />
          <Field name="contact" label="联系信息（选填）" value={b.contact} onChange={change} />
        </div>
        <div className="actions">
          <button disabled={busy}>创建并生成绑定码</button>
        </div>
      </form>
      <section className="panel">
        <h2>学生名单 · {data?.length || 0}</h2>
        {data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>姓名 / 联系</th>
                  <th>微信绑定</th>
                  <th>最近登录</th>
                  <th>提交 / 均分 / 最近成绩</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link className="link" href={'/teacher/students/' + s.id}>
                        {s.name}
                      </Link>
                      <div className="muted">
                        {s.contact || '未填写'} {s.disabled ? ' · 已停用' : ''}
                      </div>
                    </td>
                    <td>
                      {s.bound ? '微信已绑定' : '微信待绑定'}
                      <div className="muted">
                        {s.webReady ? '网页：' + s.username : '网页待激活'}
                      </div>
                    </td>
                    <td>{date(s.lastLoginAt)}</td>
                    <td>
                      {s.submissions} / {s.average ?? '—'} / {s.latestScore ?? '—'}
                    </td>
                    <td>
                      <div className="actions compact">
                        <button className="secondary small" onClick={() => edit(s)}>
                          编辑
                        </button>
                        {!s.bound && (
                          <button className="secondary small" onClick={() => code(s)}>
                            绑定码
                          </button>
                        )}
                        <button className="secondary small" onClick={() => resetAccount(s)}>
                          重置网页账号
                        </button>
                        <button className="secondary small" onClick={() => disable(s)}>
                          {s.disabled ? '启用' : '停用'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>还没有学生，添加第一位学生开始教学。</Empty>
        )}
      </section>
    </>
  );
}
const initialQuestion = {
  title: '',
  type: '大作文',
  materials: '',
  prompt: '',
  requirements: '',
  wordLimit: 1000,
  maxScore: 100,
  rubric: '',
  referenceAnswer: '',
  internalNote: '',
  region: '',
  examType: '',
};
export function Questions() {
  const { data, error, refresh } = useData<any[]>('/teacher/questions');
  const [b, setB] = useState<any>(initialQuestion),
    [open, setOpen] = useState(false),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const change = (n: string, v: any) => setB((x: any) => ({ ...x, [n]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/teacher/questions', 'POST', b);
      setB(initialQuestion);
      setOpen(false);
      setErr('');
      await refresh();
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="申论题库" desc="保留题目材料、作答要求和评分依据，布置时自动保存题目快照。">
        <button onClick={() => setOpen(!open)}>{open ? '收起表单' : '+ 创建题目'}</button>
      </Heading>
      <ErrorBox error={err || error} />
      {open && (
        <form className="panel" onSubmit={save}>
          <div className="form-grid">
            {[
              ['title', '题目名称', 'text'],
              ['type', '题型（可自定义）', 'text'],
              ['examType', '考试类型', 'text'],
              ['region', '地区', 'text'],
              ['wordLimit', '要求字数', 'number'],
              ['maxScore', '满分', 'number'],
              ['materials', '给定材料', 'textarea'],
              ['prompt', '题目 / 问题', 'textarea'],
              ['requirements', '作答要求', 'textarea'],
              ['rubric', '评分标准（供教师与辅助初批参考）', 'textarea'],
              ['referenceAnswer', '参考答案（学生不可见）', 'textarea'],
              ['internalNote', '教师备注（学生不可见）', 'textarea'],
            ].map(([n, l, t]) => (
              <Field
                key={n}
                name={n}
                label={l}
                type={t}
                full={t === 'textarea'}
                value={b[n]}
                onChange={change}
                required={['title', 'type', 'prompt', 'wordLimit', 'maxScore'].includes(n)}
              />
            ))}
          </div>
          <div className="actions">
            <button disabled={busy}>保存题目</button>
          </div>
        </form>
      )}
      <section className="panel">
        {data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>题目</th>
                  <th>题型</th>
                  <th>字数 / 满分</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {data.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <details>
                        <summary className="link">{q.title}</summary>
                        <p className="feedback">{q.prompt}</p>
                        <p className="feedback muted">{q.materials}</p>
                        <p className="feedback">
                          要求：{q.requirements}
                          <br />
                          评分依据：{q.rubric || '未填写'}
                        </p>
                      </details>
                    </td>
                    <td>{q.type}</td>
                    <td>
                      {q.wordLimit} 字 / {q.maxScore} 分
                    </td>
                    <td>{date(q.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>题库还是空的，先创建一份训练题。</Empty>
        )}
      </section>
    </>
  );
}
export function Assignments() {
  const questions = useData<any[]>('/teacher/questions'),
    students = useData<any[]>('/teacher/students'),
    { data, error, refresh } = useData<any[]>('/teacher/assignments');
  const [b, setB] = useState({ title: '', questionId: '', dueAt: '', studentIds: [] as string[] }),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const change = (n: string, v: any) => setB((x) => ({ ...x, [n]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/teacher/assignments', 'POST', { ...b, dueAt: new Date(b.dueAt).toISOString() });
      setB({ title: '', questionId: '', dueAt: '', studentIds: [] });
      setErr('');
      await refresh();
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function extend(a: any) {
    const due = window.prompt('新的截止时间（例如 2026-12-31T18:00）');
    if (!due) return;
    try {
      await api('/teacher/assignments/' + a.id, 'PATCH', { dueAt: new Date(due).toISOString() });
      await refresh();
    } catch (e) {
      setErr(message(e));
    }
  }
  return (
    <>
      <Heading title="布置作业" desc="选择题目和学生，设置明确的训练目标与截止时间。" />
      <ErrorBox error={err || error || questions.error || students.error} />
      <form className="panel" onSubmit={submit}>
        <h2>新作业</h2>
        <div className="form-grid">
          <Field name="title" label="作业名称" value={b.title} onChange={change} required />
          <Field
            name="dueAt"
            label="截止时间"
            type="datetime-local"
            value={b.dueAt}
            onChange={change}
            required
          />
          <div className="field full">
            <label htmlFor="questionId">选择题目</label>
            <select
              id="questionId"
              value={b.questionId}
              onChange={(e) => change('questionId', e.target.value)}
              required
            >
              <option value="">请选择题目</option>
              {questions.data?.map((q) => (
                <option value={q.id} key={q.id}>
                  {q.title} · {q.type}
                </option>
              ))}
            </select>
          </div>
          <div className="field full">
            <label>分配给学生 · 已选 {b.studentIds.length} 位</label>
            <div className="checklist">
              {students.data
                ?.filter((s) => !s.disabled)
                .map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={b.studentIds.includes(s.id)}
                      onChange={(e) =>
                        change(
                          'studentIds',
                          e.target.checked
                            ? [...b.studentIds, s.id]
                            : b.studentIds.filter((id) => id !== s.id),
                        )
                      }
                    />
                    {s.name}
                  </label>
                ))}
              {!students.data?.length && <span className="muted">请先添加学生</span>}
            </div>
          </div>
        </div>
        <div className="actions">
          <button disabled={busy || !b.studentIds.length}>发布作业</button>
        </div>
      </form>
      <section className="panel">
        <h2>已布置的作业</h2>
        {data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>作业</th>
                  <th>截止时间</th>
                  <th>分配人数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td>{a.title}</td>
                    <td>{date(a.dueAt)}</td>
                    <td>{a._count.recipients}</td>
                    <td>
                      <button className="secondary small" onClick={() => extend(a)}>
                        延长截止时间
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>暂无已布置作业。</Empty>
        )}
      </section>
    </>
  );
}
