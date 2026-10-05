'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, date, labels, categories } from '../../lib/api';
import OriginalAnnotations from '../OriginalAnnotations';
import { ErrorMessage } from './StudentApp';
import Draft from './Draft';
import MaterialReader, { type MaterialReaderHandle } from './MaterialReader';
export default function Question({ id, user }: { id: string; user: any }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<any>(null),
    [reference, setReference] = useState<any>(null),
    [selected, setSelected] = useState('');
  const material = useRef<MaterialReaderHandle>(null),
    starting = useRef<Promise<any> | null>(null);
  const refresh = useCallback(async () => {
    const d = await api('/student/questions/' + id);
    setData(d);
    return d;
  }, [id]);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  async function ensureAttempt() {
    const existing = draft || data?.attempts?.find((a: any) => a.status === 'DRAFT');
    if (existing) return existing;
    if (!starting.current)
      starting.current = api('/student/questions/' + id + '/start', 'POST', {})
        .then((a) => {
          setData((d: any) => ({
            ...d,
            attempts: [a, ...d.attempts.filter((x: any) => x.id !== a.id)],
          }));
          setSelected(a.id);
          return a;
        })
        .finally(() => {
          starting.current = null;
        });
    return starting.current;
  }
  async function start() {
    setBusy(true);
    setError('');
    try {
      setDraft(await ensureAttempt());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <>
        <Link href="/student">← 我的训练</Link>
        <ErrorMessage value={error} />
        {!error && <p role="status">正在载入题目…</p>}
      </>
    );
  const q = data.question,
    latest = data.attempts[0],
    shown = data.attempts.find((a: any) => a.id === selected) || latest,
    reading = draft || shown;
  const canStart =
    data.authorized &&
    (!latest || latest.status === 'DRAFT' || (latest.finalGrade && latest.roundNo < 3));
  return (
    <>
      <Link className="student-back" href="/student">
        ← 我的训练
      </Link>
      <section className="student-panel question-intro">
        <div className="card-top">
          <span>
            {q.category} / {q.type}
          </span>
          <span>{data.scores.length} / 3 轮已完成</span>
        </div>
        <h1>{data.title}</h1>
        <p>
          {q.wordLimit} 字以内 · 满分 {q.maxScore} 分
        </p>
      </section>
      <MaterialReader
        ref={material}
        key={id + ':' + (reading?.roundNo || 1)}
        raw={q.materials}
        userId={user.id}
        questionId={id}
        round={reading?.roundNo || 1}
        initial={reading}
        editable={data.authorized && (!reading || reading.status === 'DRAFT')}
        ensureAttempt={ensureAttempt}
      />
      <section className="student-panel question-requirements-panel">
        <h2>题目要求</h2>
        <p className="pre-wrap">{q.prompt}</p>
        {q.requirements && <p className="question-requirements">{q.requirements}</p>}
        <p className="student-tip">
          建议字数：{q.wordLimit} 字以内 · 满分 {q.maxScore} 分
        </p>
      </section>
      <ErrorMessage value={error} />
      {draft ? (
        <Draft
          key={draft.id}
          initial={draft}
          userId={user.id}
          wordLimit={q.wordLimit}
          beforeSubmit={async () => {
            await material.current?.flush();
          }}
          onSubmitted={async () => {
            setDraft(null);
            setSelected('');
            await refresh();
          }}
        />
      ) : (
        <>
          {canStart && (
            <button className="student-start" disabled={busy} onClick={start}>
              {busy
                ? '正在载入…'
                : latest?.status === 'DRAFT'
                  ? '继续答题'
                  : latest
                    ? '再次训练 · 第 ' + (latest.roundNo + 1) + ' 轮'
                    : '开始答题'}
            </button>
          )}
          {!data.authorized && (
            <div className="student-notice">本题授权已结束，历史作答与已发布批改仍可查看。</div>
          )}
          {data.scores.length > 0 && (
            <div className="score-journey">
              <span>我的进步</span>
              <b>{data.scores.map((s: any) => s.score + ' 分').join(' → ')}</b>
              {data.scores.length > 1 && (
                <small>
                  较首轮 {data.improvement >= 0 ? '+' : ''}
                  {data.improvement} 分
                </small>
              )}
            </div>
          )}
          {!!data.attempts.length && (
            <section className="student-panel">
              <div className="filter-pills">
                {data.attempts.map((a: any) => (
                  <button
                    className={a.id === shown?.id ? 'selected' : ''}
                    key={a.id}
                    onClick={() => setSelected(a.id)}
                  >
                    第 {a.roundNo} 轮 · {a.finalGrade ? '已批改' : labels[a.status]}
                  </button>
                ))}
              </div>
              {shown.status === 'DRAFT' ? (
                <p>草稿已保存，可继续作答。</p>
              ) : shown.finalGrade ? (
                <Feedback attempt={shown} />
              ) : (
                <div className="submission-wait">
                  <b>提交成功，等待老师批改</b>
                  <p>{date(shown.submittedAt)} 提交。老师发布后，你就能看到成绩和完整反馈。</p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? '正在刷新…' : '查看最新批改'}
                  </button>
                </div>
              )}
              <details>
                <summary>查看本轮作答与附件</summary>
                <p>
                  答题方式：
                  {({ text: '文字输入', image: '图片作答', mixed: '文字 + 图片' } as any)[
                    shown.answer_type
                  ] || '文字输入'}
                </p>
                <p className="pre-wrap">
                  {shown.text || shown.extractedText || '本次通过附件作答'}
                </p>
                <div className="file-list">
                  {shown.attachments.map((f: any) => (
                    <a key={f.id} href={'/api/files/' + f.id}>
                      {f.fileName} ↓
                    </a>
                  ))}
                </div>
              </details>
            </section>
          )}
          {data.referenceUnlocked && (
            <section className="student-panel">
              <h2>参考答案与得分要点</h2>
              {reference ? (
                <>
                  <p className="pre-wrap">{reference.referenceAnswer || '老师暂未填写参考答案'}</p>
                  <h3>评分标准</h3>
                  <p className="pre-wrap">{reference.rubric}</p>
                  {reference.scoringPoints.map((p: any, i: number) => (
                    <div className="reference-point" key={i}>
                      <b>
                        {p.label} · {p.points} 分
                      </b>
                      <p>{p.description}</p>
                    </div>
                  ))}
                </>
              ) : (
                <button
                  className="secondary"
                  onClick={() =>
                    api('/student/questions/' + id + '/reference')
                      .then(setReference)
                      .catch((e) => setError(e.message))
                  }
                >
                  查看已解锁参考
                </button>
              )}
            </section>
          )}
          {latest?.roundNo >= 3 && latest.finalGrade && (
            <div className="student-success">
              本题三轮训练已完成。每一轮作答和老师反馈都已保留，随时回来复盘。
            </div>
          )}
        </>
      )}
    </>
  );
}
function Feedback({ attempt: a }: { attempt: any }) {
  const f = a.finalGrade;
  const text = a.text || a.extractedText || '';
  const cuts = [
    ...new Set<number>([
      0,
      text.length,
      ...(f.annotations || []).flatMap((x: any) => [x.startOffset, x.endOffset]),
    ]),
  ]
    .filter((n) => n >= 0 && n <= text.length)
    .sort((x, y) => x - y);
  return (
    <div className="published-feedback">
      <div className="final-score">
        <span>老师最终评分</span>
        <b>
          {f.finalScore}
          <small> / {a.question.maxScore}</small>
        </b>
        <span>{date(f.publishedAt)}</span>
      </div>
      <h3>本轮总评</h3>
      <p className="pre-wrap">{f.summary}</p>
      {[
        ['做得好的地方', f.strengths],
        ['还需改进', f.weaknesses],
        ['下一轮重点', f.nextFocus],
        ['推荐资料', f.recommendedResources],
      ]
        .filter(([, v]) => v)
        .map(([title, value]) => (
          <div className="feedback-note" key={title}>
            <h3>{title}</h3>
            <p className="pre-wrap">{value}</p>
          </div>
        ))}
      {!!f.annotations?.length && (
        <>
          <h3>文字批注</h3>
          <p className="marked-answer pre-wrap">
            {cuts.slice(0, -1).map((n, i) => {
              const hit = f.annotations.find(
                (x: any) => x.startOffset <= n && x.endOffset >= cuts[i + 1],
              );
              return hit ? (
                <mark key={n}>{text.slice(n, cuts[i + 1])}</mark>
              ) : (
                <span key={n}>{text.slice(n, cuts[i + 1])}</span>
              );
            })}
          </p>
          {f.annotations.map((n: any, i: number) => (
            <article className="feedback-note" key={i}>
              <b>
                {i + 1}. {categories[n.category] || n.category}
              </b>
              <blockquote>{n.selectedText}</blockquote>
              <p>{n.comment}</p>
              {n.suggestion && <p>建议：{n.suggestion}</p>}
            </article>
          ))}
        </>
      )}
      {a.attachments.some(
        (x: any) => x.mimeType.startsWith('image/') || x.mimeType === 'application/pdf',
      ) && (
        <>
          <h3>原稿与老师批注</h3>
          <OriginalAnnotations
            key={a.id}
            files={a.attachments}
            value={f.pageAnnotations || []}
            locked
            onChange={() => {}}
          />
          {f.pageAnnotations
            ?.filter((n: any) => n.content)
            .map((n: any) => (
              <div className="feedback-note" key={n.id}>
                <b>第 {n.page} 页 · 老师批注</b>
                <p>{n.content}</p>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
