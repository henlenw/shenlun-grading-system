'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, categories, date } from '../lib/api';
import { useData, ErrorBox, Heading, Field, Badge, message } from './shared';
import OriginalAnnotations from './OriginalAnnotations';
import MaterialContent from './MaterialContent';
const blank = {
  version: 0,
  finalScore: 0,
  summary: '',
  strengths: '',
  weaknesses: '',
  nextFocus: '',
  recommendedResources: '',
  internalNote: '',
  annotations: [] as any[],
  pageAnnotations: [] as any[],
};
export default function Review({
  id,
  onPublished,
  onDirty,
  batch = false,
}: {
  id: string;
  onPublished?: () => Promise<void>;
  onDirty?: (dirty: boolean) => void;
  batch?: boolean;
}) {
  const { data: a, error, refresh } = useData('/teacher/submissions/' + id);
  const [r, setR] = useState<any>(blank),
    [err, setErr] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [selection, setSelection] = useState<any>(null),
    [comment, setComment] = useState(''),
    [category, setCategory] = useState('CONTENT'),
    [dirty, setDirty] = useState(false),
    [revision, setRevision] = useState({ reason: '', requirements: '', dueAt: '' });
  const essay = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (a) {
      setR(
        a.review
          ? { ...blank, ...a.review, pageAnnotations: JSON.parse(a.review.pageAnnotations || '[]') }
          : blank,
      );
      setDirty(false);
    }
  }, [a]);
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  if (!a)
    return (
      <>
        <ErrorBox error={error} />
        <p>正在载入批改…</p>
      </>
    );
  const locked = ['PUBLISHED', 'REVISION_REQUESTED', 'ARCHIVED', 'DRAFT', 'PROCESSING'].includes(
    a.status,
  );
  const text = a.text || a.extractedText;
  const q = JSON.parse(a.questionSnapshot || a.submission.assignment.questionSnapshot);
  const ai = a.aiGrade ? JSON.parse(a.aiGrade.resultJson) : null;
  function change(n: string, v: any) {
    setR((x: any) => ({ ...x, [n]: v }));
    setDirty(true);
  }
  function select() {
    const s = window.getSelection();
    if (!s?.rangeCount || !essay.current) return;
    const range = s.getRangeAt(0);
    if (!essay.current.contains(range.commonAncestorContainer) || !s.toString()) return;
    const pre = range.cloneRange();
    pre.selectNodeContents(essay.current);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    setSelection({
      startOffset: start,
      endOffset: start + s.toString().length,
      selectedText: s.toString(),
    });
  }
  function add() {
    if (!selection || !comment.trim()) return;
    change('annotations', [
      ...r.annotations,
      { ...selection, category, severity: 'MEDIUM', comment, suggestion: '' },
    ]);
    setSelection(null);
    setComment('');
  }
  async function save() {
    const saved = await api('/teacher/submissions/' + id + '/review', 'PUT', r);
    setR({ ...blank, ...saved, pageAnnotations: JSON.parse(saved.pageAnnotations || '[]') });
    setDirty(false);
    return saved;
  }
  async function action(publish = false, next = false) {
    if (
      publish &&
      !window.confirm(
        '确认发布 ' +
          r.finalScore +
          ' / ' +
          q.maxScore +
          ' 分、教师评语及 ' +
          (r.annotations.length + r.pageAnnotations.length) +
          ' 条批注？学生将看到本次结果，发布后不能修改。',
      )
    )
      return;
    setBusy(true);
    setErr('');
    try {
      const saved = await save();
      if (publish) {
        await api('/teacher/submissions/' + id + '/publish', 'POST', {
          reviewVersion: saved.version,
        });
        await refresh();
        if (next) await onPublished?.();
      }
      setNotice(publish ? '已发布给学生' : '批改已保存，尚未对学生公开');
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function requestRevision(e: React.FormEvent) {
    e.preventDefault();
    if (dirty && !window.confirm('有未保存的批改。直接要求重做将不发布这些修改，是否继续？'))
      return;
    setBusy(true);
    try {
      await api('/teacher/submissions/' + id + '/revision', 'POST', {
        ...revision,
        dueAt: new Date(revision.dueAt).toISOString(),
      });
      await refresh();
      setNotice('已通知学生重做，历史成绩和批注保持不变');
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  const endpoints = [
    ...new Set([
      0,
      text.length,
      ...r.annotations.flatMap((n: any) => [n.startOffset, n.endOffset]),
    ]),
  ].sort((x: any, y: any) => x - y) as number[];
  return (
    <>
      <Heading
        title={a.submission.assignment.title}
        desc={
          a.submission.student.name + ' · 第 ' + a.roundNo + ' / 3 次作答 · ' + date(a.submittedAt)
        }
      >
        <div className="actions compact">
          <Badge status={a.status} />
          <button
            className="secondary"
            onClick={() => {
              if (!dirty || window.confirm('放弃未保存的修改并刷新？')) void refresh();
            }}
          >
            刷新
          </button>
          <Link
            className="link"
            href="/teacher/submissions"
            onClick={(e) => {
              if (dirty && !window.confirm('放弃未保存的修改并离开？')) e.preventDefault();
            }}
          >
            返回列表
          </Link>
        </div>
      </Heading>
      <ErrorBox error={err || error} />
      {notice && <div className="success">{notice}</div>}
      <details className={'panel reference-panel ' + (batch ? 'sticky-reference' : '')}>
        <summary className="link">评分依据 · 参考答案 / 得分点 / 教师要求（本次训练快照）</summary>
        <div className="reference-body">
          <h3>参考答案</h3>
          <p className="feedback">{q.referenceAnswer || '尚未填写'}</p>
          <h3>评分标准</h3>
          <p className="feedback">{q.rubric || '尚未填写'}</p>
          {q.scoringPoints?.map((p: any) => (
            <p key={p.id}>
              <b>
                {p.label} · {p.points} 分
              </b>
              　{p.description}
            </p>
          ))}
          <p className="feedback">{q.teacherInstructions}</p>
        </div>
      </details>
      {a.status === 'PROCESSING' && (
        <div className="notice">
          本地 AI / OCR 正在处理。
          <button
            className="secondary small"
            onClick={async () => {
              try {
                await api('/teacher/submissions/' + id + '/manual', 'POST');
                await refresh();
              } catch (e) {
                setErr(message(e));
              }
            }}
          >
            立即人工批改
          </button>
        </div>
      )}
      <div className={'review-grid' + (!ai ? ' manual-review' : '')}>
        <section className="panel">
          <h2>学生文字答案</h2>
          <p className="muted">
            第 {a.roundNo} 轮 ·{' '}
            {({ text: '文字输入', image: '图片作答', mixed: '文字 + 图片' } as any)[a.answerType] ||
              '作答记录'}
          </p>
          <details>
            <summary className="link">查看题目与材料</summary>
            <p className="feedback">{q.prompt}</p>
            <div className="material-text">
              <MaterialContent raw={q.materials} />
            </div>
            <p>{q.requirements}</p>
          </details>
          <p className="muted">
            要求约 {q.wordLimit} 字 · 当前 {Array.from(text.replace(/\s/g, '')).length} 字
          </p>
          <div className="notice">选中原文中的文字，在下方添加人工批注。</div>
          <pre className="essay" ref={essay} onMouseUp={select}>
            {endpoints
              .slice(0, -1)
              .map((start, i) =>
                r.annotations.some(
                  (n: any) => n.startOffset <= start && n.endOffset >= endpoints[i + 1],
                ) ? (
                  <mark key={start}>{text.slice(start, endpoints[i + 1])}</mark>
                ) : (
                  <span key={start}>{text.slice(start, endpoints[i + 1])}</span>
                ),
              )}
          </pre>
          {!text && <p className="notice">本轮未填写文字答案，请在下方查看作答图片。</p>}
          {a.attachments.map((f: any) => (
            <p key={f.id}>
              <a className="link" href={'/api/files/' + f.id} target="_blank" rel="noreferrer">
                下载附件：{f.fileName}
              </a>
            </p>
          ))}
          {!locked && !!text && (
            <div>
              <div className="note">
                {selection ? '已选：' + selection.selectedText : '请先选中一段原文'}
              </div>
              <div className="field">
                <label htmlFor="category">批注类别</label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {Object.entries(categories).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <label htmlFor="newComment">人工批注</label>
                <textarea
                  id="newComment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="说明问题，并给出修改方向"
                />
              </div>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={!selection || !comment.trim()}
                  onClick={add}
                >
                  添加批注
                </button>
              </div>
            </div>
          )}
          {!!a.attachments.length && (
            <div className="review-images">
              <h2>学生作答图片</h2>
              <OriginalAnnotations
                files={a.attachments}
                value={r.pageAnnotations}
                onChange={(v) => change('pageAnnotations', v)}
                locked={locked || busy}
              />
            </div>
          )}
        </section>
        {ai && (
          <section className="panel">
            <div className="heading">
              <h2>辅助初批</h2>
              <span className="ai-label">仅教师可见</span>
            </div>
            {ai ? (
              <>
                <div className="score">
                  {ai.estimatedScore}
                  <small style={{ fontSize: 16 }}> / {q.maxScore}</small>
                </div>
                <p className="muted">置信度 {Math.round(ai.confidence * 100)}% · 仅供参考</p>
                <p className="feedback">{ai.summary}</p>
                {!!a.attachments.length && (
                  <p className="notice">AI 已完成文字分析，请教师人工标注。</p>
                )}
                {!!ai.pointAssessments?.length && (
                  <>
                    <h3>逐项得分</h3>
                    {ai.pointAssessments.map((p: any) => (
                      <div className="note" key={p.pointId}>
                        <b>
                          {p.label} · {p.awarded} 分 ·{' '}
                          {
                            ({ HIT: '完全命中', PARTIAL: '部分命中', MISS: '未命中' } as any)[
                              p.status
                            ]
                          }
                        </b>
                        <p>{p.evidence}</p>
                        <p>{p.reason}</p>
                      </div>
                    ))}
                  </>
                )}
                {[
                  ['strengths', '优点'],
                  ['weaknesses', '主要问题'],
                  ['pointsCovered', '覆盖要点'],
                  ['pointsMissing', '遗漏要点'],
                  ['suggestions', '改进建议'],
                ].map(([key, label]) => (
                  <div key={key}>
                    <h3>{label}</h3>
                    <ul>
                      {ai[key].map((v: string, i: number) => (
                        <li className="feedback" key={i}>
                          {v}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <h3>结构分析</h3>
                <p className="feedback">{ai.structureAnalysis}</p>
                <h3>语言分析</h3>
                <p className="feedback">{ai.languageAnalysis}</p>
                <h3>建议批注 · {ai.annotations.length}</h3>
                {ai.annotations.map((n: any, i: number) => (
                  <div className="note" key={i}>
                    <blockquote>{n.selectedText}</blockquote>
                    <p>{n.comment}</p>
                    <p>{n.suggestion}</p>
                    <button
                      className="secondary small"
                      disabled={locked}
                      onClick={() => change('annotations', [...r.annotations, { ...n }])}
                    >
                      采纳到教师批注
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <>
                <p className="feedback">
                  {a.job?.error ||
                    (a.status === 'PROCESSING'
                      ? '正在提取文字或执行本地初批，请稍后刷新。'
                      : '尚无初批结果，可由老师直接批改。')}
                </p>
                {a.job?.status === 'FAILED' && !locked && (
                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        await api('/teacher/submissions/' + id + '/retry-ai', 'POST');
                        await refresh();
                      } catch (e) {
                        setErr(message(e));
                      }
                    }}
                  >
                    重试本地初批
                  </button>
                )}
              </>
            )}
          </section>
        )}
        <section className="panel">
          <h2>教师最终反馈</h2>
          {a.finalGrade && (
            <div className="success">
              正式成绩：{a.finalGrade.finalScore} / {q.maxScore}
              <br />
              发布于 {date(a.finalGrade.publishedAt)}
            </div>
          )}
          <fieldset disabled={locked || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="form-grid">
              {[
                ['finalScore', '最终分数（满分 ' + q.maxScore + '）', 'number'],
                ['summary', '教师总评 *', 'textarea'],
                ['strengths', '得分点', 'textarea'],
                ['weaknesses', '主要问题 / 扣分点', 'textarea'],
                ['nextFocus', '下一次重点', 'textarea'],
                ['recommendedResources', '推荐资料', 'textarea'],
                ['internalNote', '内部备注（学生不可见）', 'textarea'],
              ].map(([n, l, t]) => (
                <Field key={n} name={n} label={l} type={t} full value={r[n]} onChange={change} />
              ))}
            </div>
            <h3>教师批注 · {r.annotations.length}</h3>
            {r.annotations.map((n: any, i: number) => (
              <div className="note" key={i}>
                <blockquote>
                  {categories[n.category]} · {n.selectedText}
                </blockquote>
                <textarea
                  aria-label={'批注 ' + (i + 1)}
                  value={n.comment}
                  onChange={(e) =>
                    change(
                      'annotations',
                      r.annotations.map((x: any, j: number) =>
                        j === i ? { ...x, comment: e.target.value } : x,
                      ),
                    )
                  }
                />
                <textarea
                  aria-label={'修改建议 ' + (i + 1)}
                  value={n.suggestion}
                  placeholder="修改建议"
                  onChange={(e) =>
                    change(
                      'annotations',
                      r.annotations.map((x: any, j: number) =>
                        j === i ? { ...x, suggestion: e.target.value } : x,
                      ),
                    )
                  }
                />
                <button
                  className="secondary small"
                  onClick={() =>
                    change(
                      'annotations',
                      r.annotations.filter((_: any, j: number) => i !== j),
                    )
                  }
                >
                  删除批注
                </button>
              </div>
            ))}
            <div className="actions">
              <button className="secondary" onClick={() => action()}>
                保存批改
              </button>
              <button onClick={() => action(true)}>发布给学生</button>
              {batch && <button onClick={() => action(true, true)}>发布并下一份</button>}
            </div>
          </fieldset>
          {a.finalGrade && a.roundNo < 3 && (
            <form onSubmit={requestRevision}>
              <div className="line" />
              <h3>要求重做</h3>
              <div className="form-grid">
                {[
                  ['reason', '原因', 'text'],
                  ['requirements', '重做要求', 'textarea'],
                  ['dueAt', '新的截止时间', 'datetime-local'],
                ].map(([n, l, t]) => (
                  <Field
                    key={n}
                    name={n}
                    label={l}
                    type={t}
                    full
                    value={(revision as any)[n]}
                    onChange={(n, v) => setRevision((x) => ({ ...x, [n]: v }))}
                    required
                  />
                ))}
              </div>
              <div className="actions">
                <button className="danger" disabled={busy}>
                  通知学生重做
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
