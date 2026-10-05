'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, date } from '../lib/api';
import { useData, ErrorBox } from './shared';
export default function Resources({ compact = false }: { compact?: boolean }) {
  const { data, error, refresh } = useData('/admin/resources');
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  if (compact)
    return data?.warning ? (
      <div role="alert" className="notice">
        {data.warning} <Link href="/teacher/settings">查看用量记录</Link>
      </div>
    ) : null;
  const s = data?.snapshot;
  return (
    <section className="panel">
      <h2>免费额度保护</h2>
      <ErrorBox error={error || message} />
      {data?.warning && (
        <p role="alert" className="notice">
          {data.warning}
        </p>
      )}
      <p>最近核对：{s ? `${s.used} / ${s.quota} 资源点` : '尚未记录'}</p>
      {s && (
        <p>
          记录时间：{date(s.checkedAt)} · 本周期结束：{date(s.periodEnd)}
        </p>
      )}
      <p className="intro">
        这是用量记录，不是实时余额。云平台计量有延迟；达到 80%
        显示提醒。网站不会升级套餐、购买资源或开启按量付费。
      </p>
      {data?.stale && <p className="notice">用量记录已过期或尚未核对，请查看腾讯云最新数据。</p>}
      {data?.consoleUrl && (
        <a href={data.consoleUrl} target="_blank" rel="noreferrer">
          打开腾讯云套餐用量 ↗
        </a>
      )}
      <details>
        <summary>更新核对记录</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            const f = new FormData(e.currentTarget);
            try {
              await api('/admin/resources', 'PUT', {
                used: Number(f.get('used')),
                quota: Number(f.get('quota')),
                periodEnd: new Date(String(f.get('periodEnd')) + 'T23:59:59+08:00').toISOString(),
              });
              await refresh();
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            腾讯云显示的已用资源点
            <input
              name="used"
              type="number"
              min="0"
              step="0.01"
              defaultValue={s?.used ?? 0}
              required
            />
          </label>
          <label>
            本周期额度
            <input name="quota" type="number" min="1" defaultValue={s?.quota ?? 3000} required />
          </label>
          <label>
            本周期结束日期（北京时间）
            <input
              name="periodEnd"
              type="date"
              defaultValue={s?.periodEnd?.slice(0, 10)}
              required
            />
          </label>
          <button disabled={busy}>{busy ? '保存中…' : '保存核对记录'}</button>
        </form>
      </details>
    </section>
  );
}
