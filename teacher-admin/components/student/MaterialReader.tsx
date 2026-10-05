'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api } from '../../lib/api';
import MaterialContent from '../MaterialContent';
import { materialText, type StudentMark } from '../../../backend/src/material-text';
export type MaterialReaderHandle = { flush: () => Promise<void> };
const kinds = [
  ['underline', '下划线'],
  ['highlight', '高亮'],
  ['strike', '删除线'],
  ['circle', '圈选/标记'],
] as const;
const MaterialReader = forwardRef<
  MaterialReaderHandle,
  {
    raw: string;
    userId: string;
    questionId: string;
    round: number;
    initial?: any;
    editable: boolean;
    ensureAttempt: () => Promise<any>;
  }
>(function MaterialReader(
  { raw, userId, questionId, round, initial, editable, ensureAttempt },
  ref,
) {
  const [marks, setMarks] = useState<StudentMark[]>(initial?.student_annotations || []);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
    selectedText: string;
  } | null>(null);
  const [status, setStatus] = useState(''),
    [error, setError] = useState('');
  const [recovery, setRecovery] = useState<StudentMark[] | null>(null);
  const root = useRef<HTMLDivElement>(null),
    attempt = useRef(initial),
    version = useRef(initial?.annotationsVersion || 0);
  const current = useRef(marks),
    queue = useRef(Promise.resolve()),
    alive = useRef(true),
    failed = useRef(''),
    blocked = useRef(false);
  const selected = useRef(selection);
  selected.current = selection;
  const key = `kaoba-material:${userId}:${questionId}:${round}`;
  const text = materialText(raw).text;
  useEffect(() => {
    alive.current = true;
    try {
      const old = JSON.parse(localStorage.getItem(key) || 'null');
      if (
        old &&
        old.raw === raw &&
        Array.isArray(old.marks) &&
        JSON.stringify(old.marks) !== JSON.stringify(current.current)
      )
        setRecovery(old.marks);
      else if (old) localStorage.removeItem(key);
    } catch {}
    return () => {
      alive.current = false;
    };
  }, [key, raw]);
  useEffect(() => {
    const capture = () => {
      const s = window.getSelection(),
        el = root.current;
      if (!s || s.isCollapsed || !s.rangeCount || !el) return;
      const r = s.getRangeAt(0);
      if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return;
      const prefix = r.cloneRange();
      prefix.selectNodeContents(el);
      prefix.setEnd(r.startContainer, r.startOffset);
      const start = prefix.toString().length,
        selectedText = r.toString();
      setSelection({ start, end: start + selectedText.length, selectedText });
    };
    document.addEventListener('selectionchange', capture);
    return () => document.removeEventListener('selectionchange', capture);
  }, []);
  function local(next: StudentMark[]) {
    try {
      localStorage.setItem(key, JSON.stringify({ raw, marks: next, version: version.current }));
    } catch {}
  }
  function save(next: StudentMark[]) {
    current.current = next;
    setMarks(next);
    local(next);
    setStatus('正在保存勾画…');
    setError('');
    const pending = queue.current
      .then(async () => {
        if (blocked.current) throw Error(failed.current);
        attempt.current ||= await ensureAttempt();
        // This independent version does not invalidate the answer draft or image upload queue.
        if (version.current === 0 && attempt.current.annotationsVersion)
          version.current = attempt.current.annotationsVersion;
        local(current.current);
        const r = await api(
          '/student/attempts/' + attempt.current.id + '/material-annotations',
          'PUT',
          { version: version.current, annotations: next },
        );
        version.current = r.version;
        failed.current = '';
        if (JSON.stringify(current.current) === JSON.stringify(next)) {
          try {
            localStorage.removeItem(key);
          } catch {}
          if (alive.current) setStatus('勾画已保存');
        }
      })
      .catch((e) => {
        failed.current = e.message;
        if (/其他设备|已提交/.test(e.message)) blocked.current = true;
        if (alive.current) {
          setError(e.message);
          setStatus('本机已保留，尚未同步');
        }
        throw e;
      });
    queue.current = pending.catch(() => {});
    return pending;
  }
  useImperativeHandle(ref, () => ({
    flush: async () => {
      await queue.current;
      if (recovery) throw Error('请先处理未同步的材料勾画');
      if (failed.current) throw Error('材料勾画尚未保存：' + failed.current);
    },
  }));
  function add(type: StudentMark['type']) {
    const s = selected.current;
    if (!s || !editable || recovery || blocked.current) return;
    if (s.selectedText.length > 10000) {
      setError('一次请选择不超过 10000 字的重点');
      return;
    }
    if (current.current.length >= 100) {
      setError('本轮最多保存 100 处勾画，请先移除不需要的标记');
      return;
    }
    if (text.slice(s.start, s.end) !== s.selectedText) {
      setError('选区已改变，请重新选择材料文字');
      return;
    }
    if (current.current.some((m) => m.start === s.start && m.end === s.end && m.type === type))
      return;
    void save([...current.current, { ...s, type, id: crypto.randomUUID() }]).catch(() => {});
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }
  return (
    <section className="student-panel material-reader">
      <div className="card-top">
        <h2>题目材料</h2>
        <span>第 {round} 轮</span>
      </div>
      <p className="student-tip">长按选择文字，可用系统菜单复制，或在下方勾画重点。</p>
      {recovery && (
        <div className="student-notice">
          发现尚未同步的本机勾画。
          <button
            className="secondary"
            disabled={!editable}
            onClick={() => {
              const next = recovery;
              setRecovery(null);
              void save(next).catch(() => {});
            }}
          >
            恢复本机勾画
          </button>
          <button
            className="text-button"
            onClick={() => {
              setRecovery(null);
              localStorage.removeItem(key);
            }}
          >
            使用云端勾画
          </button>
        </div>
      )}
      <div ref={root} className="material-text" aria-label="题目材料正文">
        <MaterialContent raw={raw || '本题无额外材料'} annotations={marks} />
      </div>
      <div className="material-tools" aria-label="材料勾画工具">
        <p>
          {selection
            ? `已选：${selection.selectedText.slice(0, 42)}${selection.selectedText.length > 42 ? '…' : ''}`
            : '先在材料中选择文字'}
        </p>
        <div className="material-tool-buttons">
          {kinds.map(([type, label]) => (
            <button
              key={type}
              className="secondary"
              disabled={!selection || !editable || !!recovery || blocked.current}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(type)}
            >
              {label}
            </button>
          ))}
          <button
            className="secondary"
            disabled={!selection}
            onMouseDown={(e) => e.preventDefault()}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(selected.current!.selectedText);
                setStatus('已复制所选文字');
              } catch {
                setStatus('请使用长按后出现的系统复制菜单');
              }
            }}
          >
            复制所选
          </button>
        </div>
        {!editable && <p className="student-tip">本轮勾画已随提交保留，仍可选中文字并复制。</p>}
        <span role="status">{status}</span>
        {error && (
          <div role="alert" className="student-notice">
            {error}
            {blocked.current ? (
              <button className="secondary" onClick={() => window.location.reload()}>
                重新载入
              </button>
            ) : (
              <button
                className="secondary"
                onClick={() => void save(current.current).catch(() => {})}
              >
                重试保存勾画
              </button>
            )}
          </div>
        )}
      </div>
      {!!marks.length && (
        <details className="material-mark-list">
          <summary>我的勾画（{marks.length}）</summary>
          {marks.map((m, i) => (
            <div key={m.id}>
              <p>
                <b>{kinds.find(([k]) => k === m.type)?.[1]}</b> · {m.selectedText}
              </p>
              {editable && (
                <button
                  className="text-button"
                  disabled={blocked.current || !!recovery}
                  aria-label={`移除勾画 ${i + 1}`}
                  onClick={() =>
                    void save(current.current.filter((x) => x.id !== m.id)).catch(() => {})
                  }
                >
                  移除
                </button>
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
});
export default MaterialReader;
