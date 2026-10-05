'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, date } from '../lib/api';
import { useData, Heading, ErrorBox, Empty, Badge, message } from './shared';
import Review from './Review';
export function Dashboard167() {
  const { data, error } = useData('/teacher/workbench'),
    ai = useData('/teacher/ai-status');
  return (
    <>
      <Heading title="今天的教学工作" desc="按题集中批改，让每一轮训练都有明确的进步方向。" />
      <div className="welcome">
        <div>
          <h2>考吧167｜申论作业与批改系统</h2>
          <p>{ai.data?.message || '正在检查本地 AI 状态…'}</p>
          <p className="muted">
            今日统计按教学时区 UTC{(data?.utcOffsetMinutes ?? 480) >= 0 ? '+' : ''}
            {(data?.utcOffsetMinutes ?? 480) / 60} 划分。
          </p>
        </div>
        <img className="welcome-logo" src="/brand/logo-icon.png" alt="考吧167" />
      </div>
      <ErrorBox error={error || ai.error} />
      <div className="stats five">
        {[
          ['todayUnreviewed', '今日未批改'],
          ['todayPublished', '今日已发布'],
          ['reviewPending', '全部待发布'],
          ['totalPublished', '累计已发布'],
          ['students', '学生人数'],
        ].map(([k, l]) => (
          <div className="stat" key={k}>
            <span>{l}</span>
            <b>{data?.counts[k] ?? '—'}</b>
          </div>
        ))}
      </div>
      <div className="actions">
        <Link className="button" href="/teacher/today-unreviewed">
          开始今日批改 →
        </Link>
        <Link className="button secondary" href="/teacher/submissions">
          全部待复核
        </Link>
        <Link className="button secondary" href="/teacher/students">
          学生管理
        </Link>
        <Link className="button secondary" href="/teacher/questions">
          题库
        </Link>
        <Link className="button secondary" href="/teacher/redemption-codes">
          兑换码
        </Link>
        <Link className="button secondary" href="/teacher/course-permissions">
          课程权限
        </Link>
      </div>
      <section className="panel" style={{ marginTop: 24 }}>
        <h2>今日待批题目</h2>
        <Groups groups={data?.groups || []} />
      </section>
    </>
  );
}
function Groups({ groups }: { groups: any[] }) {
  return groups.length ? (
    <div className="question-groups">
      {groups.map((g) => (
        <article key={g.questionId} className="question-group">
          <div>
            <span className="eyebrow">
              {g.category} / {g.type}
            </span>
            <h3>{g.title}</h3>
            <p className="muted">
              {g.count} 份待批 · {new Set(g.students.map((s: any) => s.studentId)).size} 位学生
            </p>
          </div>
          <Link className="button" href={'/teacher/batch-review/' + g.questionId}>
            批改这道题 →
          </Link>
          <div className="group-students">
            {g.students.map((s: any) => (
              <Link key={s.id} href={'/teacher/review/' + s.id}>
                {s.name} · 第 {s.roundNo} 次　
                <Badge status={s.status} />
              </Link>
            ))}
          </div>
        </article>
      ))}
    </div>
  ) : (
    <Empty>本日暂无待批作业。往日作业可在「作业批改」中查看。</Empty>
  );
}
export function TodayUnreviewed() {
  const { data, error, refresh } = useData('/teacher/today-unreviewed');
  return (
    <>
      <Heading title="今日未批改" desc="以题目分组，逐份处理今天收到且尚未发布的作答。">
        <button className="secondary" onClick={refresh}>
          刷新列表
        </button>
      </Heading>
      <ErrorBox error={error} />
      <Groups groups={data?.groups || []} />
    </>
  );
}
export function BatchReview({ questionId }: { questionId: string }) {
  const { data, error, refresh } = useData(
    '/teacher/today-unreviewed?questionId=' + encodeURIComponent(questionId),
  );
  const [current, setCurrent] = useState(''),
    [dirty, setDirty] = useState(false);
  const rows = data?.rows || [];
  useEffect(() => {
    if (data && !rows.some((r: any) => r.id === current)) {
      setCurrent(rows[0]?.id || '');
      setDirty(false);
    }
  }, [data]);
  const index = rows.findIndex((r: any) => r.id === current);
  function choose(id: string) {
    if (id === current) return;
    if (dirty && !window.confirm('当前批改尚未保存，确认离开？')) return;
    setDirty(false);
    setCurrent(id);
  }
  async function published() {
    setDirty(false);
    await refresh();
  }
  return (
    <>
      <Heading title="同题连续批改" desc={data?.groups[0]?.title || '今日同题作答队列'}>
        <Link className="link" href="/teacher/today-unreviewed">
          返回今日列表
        </Link>
      </Heading>
      <ErrorBox error={error} />
      {data && !rows.length ? (
        <section className="panel">
          <Empty>本题今日待批改已完成。</Empty>
          <Link className="button" href="/teacher/today-unreviewed">
            返回题目列表
          </Link>
        </section>
      ) : (
        <>
          <div className="batch-toolbar">
            <button
              className="secondary"
              disabled={index <= 0}
              onClick={() => choose(rows[index - 1].id)}
            >
              上一份
            </button>
            <span>
              {index + 1} / {rows.length}
            </span>
            <button
              className="secondary"
              disabled={index < 0 || index >= rows.length - 1}
              onClick={() => choose(rows[index + 1].id)}
            >
              下一份
            </button>
            <div className="batch-queue">
              {rows.map((r: any) => (
                <button
                  className={r.id === current ? '' : 'secondary'}
                  key={r.id}
                  onClick={() => choose(r.id)}
                >
                  {r.submission.student.name} · 第 {r.roundNo} 次
                </button>
              ))}
            </div>
          </div>
          {current && (
            <Review key={current} id={current} onPublished={published} onDirty={setDirty} batch />
          )}
        </>
      )}
    </>
  );
}
