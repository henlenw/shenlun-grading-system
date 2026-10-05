'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, date, labels } from '../../lib/api';
import Question from './Question';
import Profile from './Profile';
export function ErrorMessage({ value }: { value: string }) {
  return value ? (
    <div role="alert" className="student-error">
      {value}
    </div>
  ) : null;
}
export default function StudentApp() {
  const path = usePathname(),
    router = useRouter();
  const [user, setUser] = useState<any>(null),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false);
  const isHome = path === '/';
  const login = path === '/student/login' || path === '/student/register';
  useEffect(() => {
    let live = true;
    setReady(false);
    setError('');
    api('/auth/me')
      .then((r) => {
        if (!live) return;
        if (r.user.role !== 'STUDENT') {
          setUser(null);
          setError('当前为教师账号，请先退出教师账号，再登录学生账号。');
        } else {
          setUser(r.user);
          if (login) router.replace('/student');
        }
      })
      .catch(() => {
        if (live && !login && !isHome) router.replace('/student/login');
      })
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, [isHome, login, router]);
  return (
    <div className="student-site">
      <header className="student-header">
        <Link href="/">
          <img src="/brand/logo.svg" width="210" height="54" alt="考吧167" />
        </Link>
        <span>{user?.name || '申论 × 面试'}</span>
      </header>
      <main className="student-main">
        <ErrorMessage value={error} />
        {isHome && !user ? (
          <section className="student-welcome">
            <span className="overline">考吧167 · 申论 × 面试</span>
            <h1>
              作业训练
              <br />
              与批改
            </h1>
            <p>
              认真作答，老师精批。
              <br />
              带着反馈，再进步一次。
            </p>
            <div className="welcome-actions">
              <Link className="button" href="/student/login" prefetch={false}>
                登录
              </Link>
              <Link className="button secondary" href="/student/register" prefetch={false}>
                注册
              </Link>
            </div>
            <ol className="welcome-steps">
              <li>提交作业</li>
              <li>查看批改</li>
              <li>复盘再练</li>
            </ol>
            <p className="student-tip">微信里直接打开，无需安装。</p>
            <footer className="welcome-footer">
              <Link href="/privacy" prefetch={false}>
                隐私说明
              </Link>
              <Link href="/teacher/login" prefetch={false}>
                教师登录
              </Link>
            </footer>
          </section>
        ) : !ready ? (
          <p role="status">正在载入…</p>
        ) : login ? (
          <Login
            key={path}
            register={path === '/student/register'}
            onLogin={() => router.replace('/student')}
          />
        ) : user ? (
          path.startsWith('/student/question/') ? (
            <Question key={path} id={path.split('/')[3]} user={user} />
          ) : path === '/student/profile' ? (
            <Profile user={user} />
          ) : path === '/student/redeem' ? (
            <Redeem />
          ) : (
            <Training />
          )
        ) : (
          <Link className="button" href="/teacher/dashboard">
            返回教师工作台
          </Link>
        )}
      </main>
      {!login && user && (
        <nav className="student-tabs" aria-label="学生导航">
          <Link className={path === '/student' || isHome ? 'active' : ''} href="/student">
            我的训练
          </Link>
          <Link className={path === '/student/redeem' ? 'active' : ''} href="/student/redeem">
            兑换课程
          </Link>
          <Link className={path === '/student/profile' ? 'active' : ''} href="/student/profile">
            我的
          </Link>
        </nav>
      )}
    </div>
  );
}
function Login({ onLogin, register }: { onLogin: () => void; register: boolean }) {
  const [activate, setActivate] = useState(register),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await api(
        '/auth/student/' + (activate ? 'activate' : 'login'),
        'POST',
        Object.fromEntries(f),
      );
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="student-auth">
      <span className="overline">WELCOME BACK / 考吧167</span>
      <h1>{activate ? '注册学生账号' : '登录考吧167'}</h1>
      <p>
        {activate ? '输入老师提供的 6 位激活码，即可开始训练。' : '登录后查看作业和老师的批改。'}
      </p>
      <form onSubmit={submit}>
        <ErrorMessage value={error} />
        {activate && (
          <label>
            老师的 6 位激活码
            <input
              name="bindingCode"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoComplete="one-time-code"
            />
          </label>
        )}
        <label>
          学生账号
          <input
            name="username"
            required
            minLength={3}
            maxLength={100}
            pattern="[a-zA-Z0-9_.@-]+"
            autoComplete="username"
            placeholder="字母或数字，至少 3 位"
          />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete={activate ? 'new-password' : 'current-password'}
            placeholder="至少 10 位"
          />
        </label>
        <label className="agreement">
          <input type="checkbox" required />
          我已阅读并同意 <Link href="/privacy">隐私说明</Link>
        </label>
        <button disabled={busy}>{busy ? '正在处理…' : activate ? '注册并进入训练' : '登录'}</button>
      </form>
      <button
        className="text-button"
        onClick={() => {
          setActivate(!activate);
          setError('');
        }}
      >
        {activate ? '已有账号，直接登录' : '首次使用？注册学生账号'}
      </button>
      <p className="student-tip">没有激活码或忘记密码，请联系老师。</p>
    </section>
  );
}
function Training() {
  const [rows, setRows] = useState<any[] | null>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState('全部');
  useEffect(() => {
    let live = true;
    api('/student/questions')
      .then((r) => {
        if (live) setRows(r);
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, []);
  const visible = rows?.filter(
    (q) =>
      tab === '全部' ||
      (tab === '我的批改'
        ? !!q.latest?.finalGrade
        : tab === '已完成'
          ? q.completed
          : !q.completed && !q.latest?.finalGrade),
  );
  return (
    <>
      <div className="student-title">
        <span className="overline">每一次认真，都算数</span>
        <h1>我的训练</h1>
        <p>练习、批改、复盘，把进步留在这里。</p>
      </div>
      <div className="training-summary">
        <div>
          <b>{rows?.filter((q) => q.authorized).length ?? '—'}</b>
          <span>已开通题目</span>
        </div>
        <div>
          <b>{rows?.reduce((s, q) => s + q.scores.length, 0) ?? '—'}</b>
          <span>已发布批改</span>
        </div>
        <div>
          <b>{rows?.filter((q) => q.completed).length ?? '—'}</b>
          <span>完成三轮</span>
        </div>
      </div>
      <div className="filter-pills training-filters">
        {['全部', '待完成', '已完成', '我的批改'].map((t) => (
          <button className={tab === t ? 'selected' : ''} key={t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <ErrorMessage value={error} />
      {!rows && !error && <p role="status">正在载入训练…</p>}
      {visible?.length === 0 && (
        <div className="student-empty">
          <h2>这里将记录你的每一次进步</h2>
          <p>还没有此类题目。请联系老师开通训练，或输入兑换码。</p>
          <Link className="button secondary" href="/student/redeem">
            输入兑换码
          </Link>
        </div>
      )}
      <div className="training-grid">
        {visible?.map((q) => (
          <Link href={'/student/question/' + q.id} key={q.id} className="training-card">
            <div className="card-top">
              <span>
                {q.question.category} · {q.question.type}
              </span>
              <span>
                {q.completed
                  ? '已完成'
                  : q.latest?.finalGrade
                    ? '待复盘'
                    : labels[q.latest?.status] || '待开始'}
              </span>
            </div>
            <h2>{q.title}</h2>
            <p>
              {q.question.wordLimit} 字以内 · 满分 {q.question.maxScore} 分
            </p>
            <div className="round-indicators">
              {[1, 2, 3].map((n) => (
                <i className={q.scores.some((s: any) => s.round === n) ? 'done' : ''} key={n}>
                  第 {n} 轮
                </i>
              ))}
            </div>
            <div className="card-bottom">
              <span>
                {q.scores.length}/3 轮已完成{' '}
                {q.scores.length > 0 && '· ' + q.scores.map((s: any) => s.score).join(' → ')}
              </span>
              <b>{q.latest?.finalGrade ? '查看批改' : q.latest ? '继续训练' : '开始训练'} →</b>
            </div>
            {!q.authorized && <small>授权已结束，可查看历史记录</small>}
          </Link>
        ))}
      </div>
    </>
  );
}
function Redeem() {
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get('code');
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api('/student/redeem', 'POST', { code });
      setMessage('兑换成功，已开通的内容可在我的训练和课程中查看。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="student-panel">
      <span className="overline">开启下一段训练</span>
      <h1>兑换课程与题目</h1>
      <p>输入老师提供的兑换码，开通对应的训练内容。</p>
      <form onSubmit={submit}>
        <label>
          兑换码
          <input
            name="code"
            required
            maxLength={100}
            autoComplete="off"
            placeholder="请输入兑换码"
          />
        </label>
        <button disabled={busy}>{busy ? '正在兑换…' : '确认兑换'}</button>
      </form>
      <ErrorMessage value={error} />
      {message && (
        <div className="student-success" role="status">
          {message}
          <p>
            <Link href="/student">进入我的训练 →</Link>
          </p>
        </div>
      )}
    </section>
  );
}
