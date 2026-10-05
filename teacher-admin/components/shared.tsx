'use client';
import { useEffect, useState } from 'react';
import { api, labels } from '../lib/api';
export function useData<T = any>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError('');
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [path]);
  return { data, error, loading, refresh };
}
export const message = (e: unknown) => (e instanceof Error ? e.message : '操作未完成，请重试');
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Badge({ status }: { status: string }) {
  return <span className={'badge ' + status}>{labels[status] || status}</span>;
}
export function Empty({ children = '暂无记录' }: { children?: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Heading({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">考吧167 / TEACHER WORKSPACE</div>
        <h1>{title}</h1>
        {desc && <p className="intro">{desc}</p>}
      </div>
      {children}
    </div>
  );
}
export function Field({
  label,
  name,
  type = 'text',
  value,
  onChange,
  full = false,
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  value: any;
  onChange: (name: string, value: any) => void;
  full?: boolean;
  required?: boolean;
}) {
  return (
    <div className={'field ' + (full ? 'full' : '')}>
      <label htmlFor={name}>{label}</label>
      {type === 'textarea' ? (
        <textarea
          id={name}
          value={value ?? ''}
          onChange={(e) => onChange(name, e.target.value)}
          required={required}
        />
      ) : (
        <input
          id={name}
          type={type}
          value={value ?? ''}
          onChange={(e) =>
            onChange(name, type === 'number' ? Number(e.target.value) : e.target.value)
          }
          required={required}
        />
      )}
    </div>
  );
}
