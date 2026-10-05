'use client';
import { useEffect, useRef, useState } from 'react';
import { api, csrfToken } from '../../lib/api';
import { ErrorMessage } from './StudentApp';
async function compress(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type))
    throw Error('请选择 JPG、PNG 或手机照片');
  if (file.size > 30 * 1024 * 1024) throw Error('原照片超过 30 MB，请先裁剪');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(Error('浏览器无法读取这张照片，请改用 JPG 或 PNG'));
      i.src = url;
    });
    if (img.naturalWidth * img.naturalHeight > 60000000) throw Error('图片像素过大，请裁剪后重试');
    const ratio = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * ratio);
    canvas.height = Math.round(img.naturalHeight * ratio);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [0.88, 0.82, 0.76]) {
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(Error('照片压缩失败'))),
          'image/jpeg',
          quality,
        ),
      );
      if (blob.size <= 2 * 1024 * 1024) break;
    }
    if (!blob || blob.size > 2 * 1024 * 1024) throw Error('照片内容过大，请裁掉空白或分成两张拍摄');
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
const modes = [
  ['text', '文字输入', '用键盘输入答案'],
  ['image', '图片作答', '拍照或从相册选图'],
  ['mixed', '文字 + 图片', '输入文字，也可附图'],
] as const;
export default function Draft({
  initial,
  userId,
  wordLimit,
  beforeSubmit,
  onSubmitted,
}: {
  initial: any;
  userId: string;
  wordLimit: number;
  beforeSubmit: () => Promise<void>;
  onSubmitted: () => Promise<void>;
}) {
  const key = 'kaoba-draft:' + userId + ':' + initial.id;
  const modeKey = key + ':mode';
  const version = useRef(initial.version),
    saved = useRef(initial.text || ''),
    savedMode = useRef(initial.answer_type || '');
  const queue = useRef(Promise.resolve()),
    recovering = useRef(false),
    halt = useRef(false),
    alive = useRef(true),
    locked = useRef(false);
  const [text, setText] = useState(initial.text || ''),
    [mode, setMode] = useState(initial.answer_type || '');
  const [files, setFiles] = useState<any[]>(initial.attachments || []),
    [status, setStatus] = useState('云端草稿已载入');
  const [recovery, setRecovery] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(false);
  const current = useRef(text),
    currentMode = useRef(mode);
  current.current = text;
  currentMode.current = mode;
  useEffect(() => {
    alive.current = true;
    try {
      const old = localStorage.getItem(key),
        oldMode = localStorage.getItem(modeKey);
      if (oldMode && ['text', 'image', 'mixed'].includes(oldMode)) setMode(oldMode);
      if (old !== null && old !== initial.text) {
        recovering.current = true;
        setRecovery(old);
      }
    } catch {}
    return () => {
      alive.current = false;
    };
  }, [key, initial.text, modeKey]);
  function enqueue() {
    if (recovering.current) return Promise.reject(Error('请先选择恢复本机草稿或使用云端内容'));
    const value = current.current,
      type = currentMode.current;
    const pending = queue.current.then(async () => {
      if (halt.current) throw Error('草稿版本冲突，请重新载入后恢复本机草稿');
      if (!type || (value === saved.current && type === savedMode.current)) return;
      if (alive.current) setStatus('正在保存…');
      try {
        const r = await api('/student/attempts/' + initial.id + '/draft', 'PUT', {
          text: value,
          answer_type: type,
          version: version.current,
        });
        version.current = r.version;
        saved.current = value;
        savedMode.current = type;
        if (alive.current) {
          setStatus('草稿已保存');
          setError('');
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (/其他设备|版本|已提交/.test(msg)) halt.current = true;
        if (alive.current) {
          setStatus('本机草稿已保留，云端未保存');
          setError(msg);
        }
        throw e;
      }
    });
    queue.current = pending.catch(() => {});
    return pending;
  }
  function changeText(value: string) {
    current.current = value;
    setText(value);
    try {
      localStorage.setItem(key, value);
    } catch {}
  }
  function choose(type: string) {
    if (busy) return;
    if ((type === 'text' && files.length) || (type === 'image' && current.current.trim()))
      type = 'mixed';
    currentMode.current = type;
    setMode(type);
    try {
      localStorage.setItem(modeKey, type);
    } catch {}
    void enqueue().catch((e) => setError(e.message));
  }
  useEffect(() => {
    if (recovering.current || busy) return;
    const timer = setTimeout(() => {
      void enqueue().catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [text, mode, busy]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (current.current !== saved.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, []);
  async function upload(selected: File[]) {
    if (locked.current || !selected.length) return;
    if (selected.length + files.length > 5) {
      setError('每轮最多 5 张图片，本轮还可添加 ' + (5 - files.length) + ' 张');
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await enqueue();
      const token = await csrfToken();
      for (let i = 0; i < selected.length; i++) {
        setStatus(`正在压缩并上传 ${i + 1}/${selected.length}…`);
        const file = await compress(selected[i]),
          form = new FormData();
        form.append('file', file);
        const response = await fetch(
          '/api/student/attempts/' + initial.id + '/files?name=' + encodeURIComponent(file.name),
          {
            method: 'POST',
            body: form,
            credentials: 'same-origin',
            headers: { 'X-CSRF-Token': token },
          },
        );
        const r = await response.json();
        if (!response.ok) throw Error(r.message || '上传失败');
        version.current = r.version;
        setFiles((old) => (old.some((f) => f.id === r.id) ? old : [...old, r]));
        setStatus(
          `已上传 ${i + 1}/${selected.length} · ${(file.size / 1024 / 1024).toFixed(2)} MB`,
        );
      }
    } catch (e) {
      setError((e as Error).message + '；已成功上传的图片已保留。');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function remove(id: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await enqueue();
      const r = await api('/student/files/' + id, 'DELETE');
      version.current = r.version;
      setFiles((old) => old.filter((f) => f.id !== id));
      setStatus('图片已移除，可重新选择');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function move(index: number, offset: number) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await enqueue();
      const ordered = [...files];
      [ordered[index], ordered[index + offset]] = [ordered[index + offset], ordered[index]];
      const r = await api('/student/attempts/' + initial.id + '/files/order', 'PUT', {
        version: version.current,
        ids: ordered.map((f) => f.id),
      });
      version.current = r.version;
      setFiles(ordered);
      setStatus('图片顺序已保存');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function submit() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await beforeSubmit();
      await enqueue();
      await api('/student/attempts/' + initial.id + '/submit', 'POST', {
        version: version.current,
      });
      halt.current = true;
      try {
        localStorage.removeItem(key);
        localStorage.removeItem(modeKey);
      } catch {}
      await onSubmitted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const count = Array.from(text.replace(/\s/g, '')).length;
  const hasText = mode === 'text' || mode === 'mixed' || !!text;
  const hasImages = mode === 'image' || mode === 'mixed' || !!files.length;
  return (
    <section className="student-panel draft-panel">
      <div className="card-top">
        <h2>第 {initial.roundNo} 轮作答</h2>
        <span role="status">{status}</span>
      </div>
      <h3>{mode ? '答题方式' : '请选择答题方式'}</h3>
      <div className="answer-mode-options">
        {modes.map(([type, title, description]) => (
          <button
            key={type}
            className={mode === type ? 'selected' : 'secondary'}
            aria-pressed={mode === type}
            disabled={busy || halt.current}
            onClick={() => choose(type)}
          >
            <b>{title}</b>
            <small>{description}</small>
          </button>
        ))}
      </div>
      {mode && (
        <>
          <p className="student-tip">
            切换方式会保留已有答案。提交时按实际内容记录为文字、图片或图文混合。
          </p>
          {recovery !== null && (
            <div className="student-notice">
              发现未同步的本机文字。
              <button
                className="secondary"
                onClick={() => {
                  recovering.current = false;
                  changeText(recovery);
                  setRecovery(null);
                }}
              >
                恢复本机草稿
              </button>
              <button
                className="text-button"
                onClick={() => {
                  recovering.current = false;
                  try {
                    localStorage.setItem(key, current.current);
                  } catch {}
                  setRecovery(null);
                }}
              >
                使用云端内容
              </button>
            </div>
          )}
          {hasText && (
            <label>
              学生文字答案
              <textarea
                aria-label="学生文字答案"
                className="answer-textarea"
                rows={18}
                maxLength={30000}
                value={text}
                disabled={busy || recovering.current}
                onChange={(e) => changeText(e.target.value)}
                placeholder="请输入你的答案……"
              />
            </label>
          )}
          {hasText && (
            <p className="student-tip">
              {count} / {wordLimit} 字
              {count > wordLimit && <strong className="word-warning"> · 已超过建议字数</strong>}
              <br />
              停止输入 5 秒自动保存，提交前也会保存。
            </p>
          )}
          {hasImages && (
            <div className="answer-image-section">
              <h3>作答图片</h3>
              <div className="answer-image-list">
                {files.map((f, i) => (
                  <article key={f.id}>
                    {f.mimeType.startsWith('image/') ? (
                      <a href={'/api/files/' + f.id + '/preview'} target="_blank" rel="noreferrer">
                        <img
                          loading="lazy"
                          src={'/api/files/' + f.id + '/preview'}
                          alt={`作答图片 ${i + 1}：${f.fileName}`}
                        />
                      </a>
                    ) : (
                      <a href={'/api/files/' + f.id}>{f.fileName}</a>
                    )}
                    <p>
                      第 {i + 1} 张 · {f.fileName}
                    </p>
                    <div className="image-order-actions">
                      <button
                        className="secondary"
                        disabled={busy || i === 0}
                        aria-label={`图片 ${i + 1} 上移`}
                        onClick={() => void move(i, -1)}
                      >
                        上移
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || i === files.length - 1}
                        aria-label={`图片 ${i + 1} 下移`}
                        onClick={() => void move(i, 1)}
                      >
                        下移
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        aria-label={`删除图片 ${i + 1}`}
                        onClick={() => void remove(f.id)}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="photo-upload-options">
                <label className="upload-area">
                  拍照
                  <input
                    type="file"
                    aria-label="拍照上传"
                    accept="image/*"
                    capture="environment"
                    disabled={busy || files.length >= 5 || recovering.current}
                    onChange={(e) => {
                      const selected = Array.from(e.target.files || []);
                      e.target.value = '';
                      void upload(selected);
                    }}
                  />
                </label>
                <label className="upload-area">
                  从相册选图（可多选）
                  <input
                    type="file"
                    aria-label="从相册选择作答图片"
                    accept="image/*"
                    multiple
                    disabled={busy || files.length >= 5 || recovering.current}
                    onChange={(e) => {
                      const selected = Array.from(e.target.files || []);
                      e.target.value = '';
                      void upload(selected);
                    }}
                  />
                </label>
              </div>
              <p className="student-tip">
                自动压缩，每张不超过 2 MB，最多 5 张。上传后请点开图片检查字迹，模糊时删除并重拍。
              </p>
            </div>
          )}
          <ErrorMessage value={error} />
          {halt.current && (
            <button className="secondary" onClick={() => window.location.reload()}>
              重新载入云端版本
            </button>
          )}
          {confirming ? (
            <div className="submit-confirm" role="group" aria-label="提交确认">
              <p>提交后，本轮答案和材料勾画将锁定。确认交给老师批改？</p>
              <button disabled={busy || recovering.current} onClick={() => void submit()}>
                {busy ? '正在提交…' : '确认提交'}
              </button>
              <button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                继续编辑
              </button>
            </div>
          ) : (
            <div className="draft-actions">
              <button
                className="secondary"
                disabled={busy || halt.current || recovering.current}
                onClick={() => void enqueue().catch((e) => setError(e.message))}
              >
                保存草稿
              </button>
              <button
                disabled={
                  busy || halt.current || recovering.current || (!text.trim() && !files.length)
                }
                onClick={() => setConfirming(true)}
              >
                提交本轮作答
              </button>
            </div>
          )}
        </>
      )}
      {!mode && <ErrorMessage value={error} />}
    </section>
  );
}
