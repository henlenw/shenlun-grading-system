'use client';
import { useState } from 'react';
import { api, backup, date } from '../lib/api';
import { useData, Heading, ErrorBox, Field, message } from './shared';
import Resources from './Resources';
export default function Settings() {
  const status = useData('/admin/status'),
    teachers = useData<any[]>('/admin/teachers'),
    logs = useData<any[]>('/admin/audit');
  const [b, setB] = useState({ name: '', username: '', password: '' }),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState('');
  const change = (n: string, v: string) => setB((x) => ({ ...x, [n]: v }));
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/admin/teachers', 'POST', b);
      setB({ name: '', username: '', password: '' });
      await teachers.refresh();
      setSuccess('教师账号已创建');
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function reset(u: any) {
    const password = window.prompt(
      '为 ' + u.name + ' 设置新密码（至少 10 位），将撤销已有登录会话',
    );
    if (!password) return;
    try {
      await api('/admin/teachers/' + u.id, 'PATCH', { password });
      setSuccess('密码已更新');
    } catch (e) {
      setErr(message(e));
    }
  }
  async function disable(u: any) {
    if (!window.confirm('确认' + (u.disabled ? '启用' : '停用') + u.name + '？')) return;
    try {
      await api('/admin/teachers/' + u.id, 'PATCH', { disabled: !u.disabled });
      await teachers.refresh();
    } catch (e) {
      setErr(message(e));
    }
  }
  return (
    <>
      <Heading title="系统管理" desc="管理教师账号，查看运行配置与审计记录。" />
      <ErrorBox error={err || status.error || teachers.error} />
      {success && <div className="success">{success}</div>}
      <Resources />
      <section className="panel">
        <h2>运行配置</h2>
        <p>使用入口：手机网站 + 教师网页后台</p>
        <p>
          批改方式：
          {!status.data
            ? '正在读取…'
            : ['manual', 'disabled'].includes(status.data.aiProvider)
              ? '人工批改（不调用 AI）'
              : `本地辅助初批 / ${status.data.model}`}
        </p>
        <p>本地 OCR：{status.data?.ocrEnabled ? '已启用' : '未启用，可人工处理附件'}</p>
        <p className="intro">服务器连接及密钥在服务器 .env 中配置，修改后重启 API。</p>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await backup();
              setSuccess('备份已下载，请妥善保存');
            } catch (e) {
              setErr(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '处理中…' : '一键备份数据库与附件'}
        </button>
      </section>
      <form className="panel" onSubmit={create}>
        <h2>创建教师</h2>
        <div className="form-grid">
          <Field name="name" label="姓名" value={b.name} onChange={change} required />
          <Field name="username" label="登录账号" value={b.username} onChange={change} required />
          <Field
            name="password"
            label="初始密码（至少 10 位）"
            type="password"
            value={b.password}
            onChange={change}
            required
          />
        </div>
        <div className="actions">
          <button disabled={busy}>创建教师</button>
        </div>
      </form>
      <section className="panel">
        <h2>教师账号</h2>
        {teachers.data?.map((u) => (
          <div className="heading" key={u.id}>
            <span>
              {u.name} · {u.username} · {u.role === 'ADMIN' ? '管理员' : '教师'}{' '}
              {u.disabled ? '（已停用）' : ''}
            </span>
            <div className="actions compact">
              <button className="secondary small" onClick={() => reset(u)}>
                重置密码
              </button>
              <button className="secondary small" onClick={() => disable(u)}>
                {u.disabled ? '启用' : '停用'}
              </button>
            </div>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>最近审计记录</h2>
        <ErrorBox error={logs.error} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>操作人</th>
                <th>目标</th>
              </tr>
            </thead>
            <tbody>
              {logs.data?.map((l) => (
                <tr key={l.id}>
                  <td>{date(l.createdAt)}</td>
                  <td>{l.action}</td>
                  <td>{l.actorId || '系统任务'}</td>
                  <td>{l.targetId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
