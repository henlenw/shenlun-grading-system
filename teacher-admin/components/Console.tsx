'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorBox, Field, message } from './shared';
import { Dashboard, Students, Questions, Assignments, Submissions } from './Pages';
import Settings from './Settings';
import Resources from './Resources';
import Review from './Review';
import QuestionBank from './QuestionBank';
import { Dashboard167, TodayUnreviewed, BatchReview } from './Workbench';
import { AccessManager, RedemptionCodes, Courses, StudentDetail } from './Access';
const links = [
  ['dashboard', '工作概览', '01'],
  ['today-unreviewed', '今日未批改', '02'],
  ['submissions', '作业批改', '02'],
  ['students', '学生管理', '03'],
  ['questions', '申论题库', '04'],
  ['assignments', '布置作业', '05'],
  ['permissions', '题目授权', '06'],
  ['redemption-codes', '试卷兑换码', '07'],
  ['course-permissions', '课程权限', '08'],
  ['settings', '系统管理', '06'],
];
export default function Console({ section, id }: { section: string; id?: string }) {
  const [user, setUser] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (section !== 'login')
      api('/auth/me')
        .then((x) => {
          if (x.user.role === 'STUDENT') throw Error('请使用教师账号登录');
          setUser(x.user);
        })
        .catch(() => window.location.assign('/teacher/login'));
  }, [section]);
  if (section === 'login') return <Login />;
  if (!user) return <div className="empty">正在载入教师工作台…</div>;
  async function logout() {
    try {
      await api('/auth/logout', 'POST');
      window.location.assign('/teacher/login');
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="layout">
      <aside className="sidebar">
        <Link href="/teacher/dashboard" className="brand">
          <img src="/brand/logo-icon.png" alt="" className="brand-logo" />
          考吧167
        </Link>
        <div className="brand-sub">申论作业与批改系统</div>
        <nav>
          {links
            .filter(([key]) => key !== 'settings' || user.role === 'ADMIN')
            .map(([key, label, icon]) => (
              <Link className={section === key ? 'active' : ''} key={key} href={'/teacher/' + key}>
                <span aria-hidden>{icon}</span>
                {label}
              </Link>
            ))}
        </nav>
        <footer>
          教师工作台
          <br />
          人工批改 · 三轮训练
          <br />
          学生数据由你掌握
          <br />
          <a href="/api/teacher/export?format=json">导出 JSON</a> ·{' '}
          <a href="/api/teacher/export?format=csv">导出 CSV</a>
        </footer>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="topbar-title">
            教学管理 / {links.find((x) => x[0] === section)?.[1] || '批改详情'}
          </span>
          <div className="user">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <span>{user.name}</span>
            <button className="secondary small" onClick={logout}>
              退出
            </button>
          </div>
        </header>
        <div className="content">
          <ErrorBox error={error} />
          {user.role === 'ADMIN' && section === 'dashboard' && <Resources compact />}
          {section === 'dashboard' ? (
            <Dashboard167 />
          ) : section === 'today-unreviewed' ? (
            <TodayUnreviewed />
          ) : section === 'batch-review' && id ? (
            <BatchReview questionId={id} />
          ) : section === 'review' && id ? (
            <Review key={id} id={id} />
          ) : section === 'permissions' ? (
            <AccessManager />
          ) : section === 'redemption-codes' ? (
            <RedemptionCodes />
          ) : section === 'course-permissions' ? (
            <Courses />
          ) : section === 'students' ? (
            id ? (
              <StudentDetail id={id} />
            ) : (
              <Students />
            )
          ) : section === 'questions' ? (
            <QuestionBank id={id} />
          ) : section === 'assignments' ? (
            <Assignments />
          ) : section === 'submissions' ? (
            id ? (
              <Review key={id} id={id} />
            ) : (
              <Submissions />
            )
          ) : section === 'settings' && user.role === 'ADMIN' ? (
            <Settings />
          ) : (
            <div>页面不存在</div>
          )}
        </div>
      </main>
    </div>
  );
}
function Login() {
  const [setup, setSetup] = useState<boolean | null>(null),
    [values, setValues] = useState({ username: '', password: '', name: '', bootstrapToken: '' }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/auth/setup')
      .then((x) => setSetup(x.needsSetup))
      .catch((e) => setError(message(e)));
  }, []);
  const change = (name: string, value: string) => setValues((x) => ({ ...x, [name]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(setup ? '/auth/setup' : '/auth/login', 'POST', values);
      window.location.assign('/teacher/dashboard');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <section className="login-art">
        <img src="/brand/logo-icon.png" alt="考吧167，申论·面试，上岸" className="login-logo" />
        <div className="eyebrow">考吧167｜申论作业与批改系统</div>
        <h1>
          三轮训练，
          <br />
          看见每次进步。
        </h1>
        <p>
          独立作答 · 对照反馈 · 再次提升
          <br />
          老师认真批改，学生安心练习。
        </p>
        <div className="line" />
        <p>作业训练 / 老师批改 / 三轮复盘</p>
      </section>
      <form className="login-form" onSubmit={submit}>
        <div className="eyebrow">KAOBA 167</div>
        <h1>{setup ? '创建管理员' : '教师登录'}</h1>
        <p className="intro">
          {setup ? '首次使用，请设置你的管理员账号。' : '欢迎回来，继续今天的教学工作。'}
        </p>
        <ErrorBox error={error} />
        {setup && (
          <>
            <Field label="姓名" name="name" value={values.name} onChange={change} required />
            <Field
              label="初始化密钥（本机 .env 的 BOOTSTRAP_TOKEN）"
              name="bootstrapToken"
              type="password"
              value={values.bootstrapToken}
              onChange={change}
              required
            />
          </>
        )}
        <Field
          label="账号 / 邮箱"
          name="username"
          value={values.username}
          onChange={change}
          required
        />
        <Field
          label="密码（至少 10 位）"
          name="password"
          type="password"
          value={values.password}
          onChange={change}
          required
        />
        <button disabled={busy || setup === null}>
          {busy ? '正在验证…' : setup ? '创建并进入工作台' : '进入工作台'}
        </button>
        <p className="intro">
          学生请打开<Link href="/student/login">手机网站登录</Link>。
        </p>
      </form>
    </div>
  );
}
