'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, date } from '../../lib/api';
import { ErrorMessage } from './StudentApp';
export default function Profile({ user }: { user: any }) {
  const [stats, setStats] = useState<any>(null),
    [account, setAccount] = useState<any>(null),
    [courses, setCourses] = useState<any>(null),
    [notifications, setNotifications] = useState<any[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      api('/student/stats'),
      api('/student/account'),
      api('/student/courses'),
      api('/student/notifications'),
    ])
      .then(([s, a, c, n]) => {
        setStats(s);
        setAccount(a);
        setCourses(c);
        setNotifications(n);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function accountSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError('');
    try {
      await api('/student/account', 'PUT', body);
      setNotice('账号已更新，其他设备需要重新登录。');
      setAccount(await api('/student/account'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="student-title">
        <span className="overline">记录每一次成长</span>
        <h1>{user.name}，你好</h1>
        <p>{courses?.serviceType || '我的学习档案'}</p>
      </div>
      <ErrorMessage value={error} />
      {notice && <div className="student-success">{notice}</div>}
      <section className="student-panel">
        <h2>训练记录</h2>
        {stats && (
          <>
            <p>
              累计提交 {stats.submissionCount} 次 · 完成三轮 {stats.completed}/{stats.total} 题
            </p>
            {stats.scores.length ? (
              <>
                <div className="score-chart" aria-label="已发布成绩趋势">
                  {stats.scores.map((s: any, i: number) => (
                    <Link
                      href={'/student/question/' + s.questionId}
                      key={i}
                      title={s.title + ' 第' + s.round + '轮 ' + s.score + '分'}
                    >
                      <b>{s.score}</b>
                      <i style={{ height: Math.max(3, (s.score / s.maxScore) * 100) }} />
                      <small>第{s.round}轮</small>
                    </Link>
                  ))}
                </div>
                <div className="record-list">
                  {stats.scores
                    .slice()
                    .reverse()
                    .map((s: any, i: number) => (
                      <Link href={'/student/question/' + s.questionId} key={i}>
                        <div>
                          <b>{s.title}</b>
                          <small>
                            {date(s.date)} · 第 {s.round} 轮
                          </small>
                        </div>
                        <strong>
                          {s.score}
                          <small>/{s.maxScore}</small>
                        </strong>
                      </Link>
                    ))}
                </div>
              </>
            ) : (
              <p className="student-tip">老师发布批改后，成绩会显示在这里。</p>
            )}
          </>
        )}
      </section>
      <section className="student-panel">
        <h2>我的课程</h2>
        {courses?.courses.length ? (
          courses.courses.map((c: any) => (
            <article className="feedback-note" key={c.id}>
              <b>{c.name}</b>
              <p>{c.description}</p>
              <small>{c.delivery}</small>
            </article>
          ))
        ) : (
          <p>暂无已开通课程。可联系老师或兑换课程包。</p>
        )}
      </section>
      <section className="student-panel">
        <div className="card-top">
          <h2>学习消息</h2>
          {notifications.some((n) => !n.readAt) && (
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api('/student/notifications/read', 'POST', {});
                  setNotifications((n) =>
                    n.map((x) => ({ ...x, readAt: new Date().toISOString() })),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              全部标为已读
            </button>
          )}
        </div>
        {notifications.length ? (
          notifications.map((n) => (
            <p key={n.id}>
              {!n.readAt && '● '}
              {n.title}
              <small className="record-date">{date(n.createdAt)}</small>
            </p>
          ))
        ) : (
          <p>暂时没有新消息。</p>
        )}
      </section>
      <section className="student-panel">
        <h2>我的账号</h2>
        <p>修改登录账号或密码，训练记录保持不变。</p>
        <details>
          <summary>{account?.webReady ? '修改账号 / 密码' : '设置网页账号'}</summary>
          <form onSubmit={accountSubmit}>
            <label>
              学生账号
              <input
                name="username"
                defaultValue={account?.username || ''}
                minLength={3}
                maxLength={100}
                pattern="[a-zA-Z0-9_.@-]+"
                required
                autoComplete="username"
              />
            </label>
            {account?.webReady && (
              <label>
                原密码
                <input
                  type="password"
                  name="currentPassword"
                  required
                  autoComplete="current-password"
                />
              </label>
            )}
            <label>
              新密码
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={128}
                required
                autoComplete="new-password"
              />
            </label>
            <button disabled={busy}>保存账号</button>
          </form>
        </details>
      </section>
      <div className="profile-footer">
        <Link href="/privacy">隐私说明</Link>
        <button
          className="secondary"
          onClick={async () => {
            try {
              await api('/auth/logout', 'POST', {});
              for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k?.startsWith('kaoba-draft:' + user.id + ':')) localStorage.removeItem(k);
              }
              window.location.assign('/student/login');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          退出登录
        </button>
      </div>
    </>
  );
}
