'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import MaterialContent from './MaterialContent';
import { api, date } from '../lib/api';
import { useData, Heading, Field, ErrorBox, Empty, message } from './shared';
const initial = {
  title: '',
  type: '概括归纳',
  category: '专项训练',
  year: undefined as number | undefined,
  region: '',
  examType: '',
  materials: '',
  prompt: '',
  requirements: '',
  wordLimit: 300,
  maxScore: 20,
  rubric: '',
  referenceAnswer: '',
  teacherInstructions: '',
  aiInstructions: '',
  internalNote: '',
  allowReference: true,
  autoUnlockReference: true,
  scoringPoints: [] as any[],
};
export default function QuestionBank({ id }: { id?: string }) {
  const materialInput = useRef<HTMLTextAreaElement>(null);
  const { data, error, refresh } = useData<any[]>('/teacher/questions');
  const [b, setB] = useState<any>(initial),
    [editing, setEditing] = useState<string | undefined>(id),
    [open, setOpen] = useState(!!id),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('全部'),
    [search, setSearch] = useState('');
  useEffect(() => {
    if (id && id !== 'create')
      api('/teacher/questions/' + id)
        .then((q) => {
          setB({ ...q, year: q.year ?? undefined });
          setEditing(q.id);
          setOpen(true);
        })
        .catch((e) => setErr(message(e)));
  }, [id]);
  function change(n: string, v: any) {
    setB((x: any) => ({ ...x, [n]: v }));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api(
        editing && editing !== 'create' ? '/teacher/questions/' + editing : '/teacher/questions',
        editing && editing !== 'create' ? 'PUT' : 'POST',
        { ...b, year: b.year || undefined },
      );
      setOpen(false);
      setEditing(undefined);
      setB(initial);
      await refresh();
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
    }
  }
  const points = b.scoringPoints || [];
  return (
    <>
      <Heading title="申论题库" desc="一次建题，重复授权。已开始训练的题目与评分依据保留独立快照。">
        <button
          onClick={() => {
            setEditing(undefined);
            setB(initial);
            setOpen(!open);
          }}
        >
          {open ? '收起表单' : '+ 创建题目'}
        </button>
      </Heading>
      <ErrorBox error={err || error} />
      {open && (
        <form className="panel" onSubmit={save}>
          <h2>{editing && editing !== 'create' ? '编辑题目' : '新建训练题'}</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="category">题库分类</label>
              <select
                id="category"
                value={b.category}
                onChange={(e) => change('category', e.target.value)}
              >
                {['国考', '省考', '专项训练', '大作文', '自定义试卷'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
            {(
              [
                ['title', '题目名称', 'text'],
                ['type', '题型（可自定义）', 'text'],
                ['year', '年份（选填）', 'number'],
                ['examType', '考试类型', 'text'],
                ['region', '地区', 'text'],
                ['wordLimit', '要求字数', 'number'],
                ['maxScore', '满分', 'number'],
                ['prompt', '题目 / 问题', 'textarea'],
                ['requirements', '作答要求', 'textarea'],
                ['referenceAnswer', '参考答案', 'textarea'],
                ['rubric', '评分标准', 'textarea'],
                ['teacherInstructions', '教师批改要求', 'textarea'],
                ['internalNote', '教师备注（学生不可见）', 'textarea'],
              ] as const
            ).map(([n, l, t]) => (
              <Field
                key={n}
                name={n}
                label={l}
                type={t}
                full={t === 'textarea'}
                value={b[n]}
                onChange={change}
                required={['title', 'type', 'prompt', 'wordLimit', 'maxScore'].includes(n)}
              />
            ))}
            <div className="field full">
              <label htmlFor="materials">给定材料</label>
              <textarea
                id="materials"
                ref={materialInput}
                rows={12}
                value={b.materials}
                onChange={(e) => change('materials', e.target.value)}
              />
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const el = materialInput.current;
                    if (!el || el.selectionStart === el.selectionEnd) {
                      setErr('请先在给定材料中选中需要加下划线的文字');
                      return;
                    }
                    change(
                      'materials',
                      b.materials.slice(0, el.selectionStart) +
                        '<u>' +
                        b.materials.slice(el.selectionStart, el.selectionEnd) +
                        '</u>' +
                        b.materials.slice(el.selectionEnd),
                    );
                    setErr('');
                  }}
                >
                  为选中文字加下划线
                </button>
              </div>
              <p className="muted">可粘贴材料文字并标注下划线。预览中的格式会保留到学生端。</p>
              <details>
                <summary>材料预览</summary>
                <div className="material-text">
                  <MaterialContent raw={b.materials} />
                </div>
              </details>
            </div>
          </div>
          <h3>得分点与分值</h3>
          <p className="muted">填写后，各得分点合计必须等于满分，供教师逐项批改。</p>
          {points.map((p: any, i: number) => (
            <div className="point-row" key={i}>
              <label>
                得分点 {i + 1}
                <input
                  required
                  aria-label={'得分点 ' + (i + 1)}
                  value={p.label}
                  onChange={(e) =>
                    change(
                      'scoringPoints',
                      points.map((x: any, j: number) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                分值
                <input
                  aria-label={'分值 ' + (i + 1)}
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={p.points}
                  onChange={(e) =>
                    change(
                      'scoringPoints',
                      points.map((x: any, j: number) =>
                        j === i ? { ...x, points: Number(e.target.value) } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                判定说明
                <input
                  value={p.description}
                  onChange={(e) =>
                    change(
                      'scoringPoints',
                      points.map((x: any, j: number) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="secondary small"
                onClick={() =>
                  change(
                    'scoringPoints',
                    points.filter((_: any, j: number) => j !== i),
                  )
                }
              >
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() =>
              change('scoringPoints', [...points, { label: '', description: '', points: 1 }])
            }
          >
            添加得分点
          </button>
          <span className="muted">
            　合计 {points.reduce((s: number, p: any) => s + Number(p.points), 0)} / {b.maxScore} 分
          </span>
          <div className="checklist" style={{ marginTop: 20 }}>
            <label>
              <input
                type="checkbox"
                checked={b.allowReference}
                onChange={(e) => change('allowReference', e.target.checked)}
              />
              允许查看参考答案和评分标准
            </label>
            <label>
              <input
                type="checkbox"
                checked={b.autoUnlockReference}
                onChange={(e) => change('autoUnlockReference', e.target.checked)}
              />
              首轮发布后自动解锁
            </label>
          </div>
          <p className="muted">首次作答前保持独立思考。关闭自动解锁后，可在权限管理中逐个解锁。</p>
          <div className="actions">
            <button disabled={busy}>保存题目</button>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              取消
            </button>
          </div>
        </form>
      )}
      <section className="panel">
        <div className="bank-filter">
          <input
            aria-label="搜索题目"
            placeholder="搜索题目、年份、地区"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select aria-label="筛选分类" value={filter} onChange={(e) => setFilter(e.target.value)}>
            {['全部', '国考', '省考', '专项训练', '大作文', '自定义试卷'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        {data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>题目</th>
                  <th>分类 / 年份</th>
                  <th>字数 / 满分</th>
                  <th>参考答案</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data
                  .filter(
                    (q) =>
                      (filter === '全部' || q.category === filter) &&
                      [q.title, q.year, q.region].join(' ').includes(search),
                  )
                  .map((q) => (
                    <tr key={q.id}>
                      <td>
                        <b>{q.title}</b>
                        <div className="muted">
                          {q.type} · {q.region || q.examType || '通用'}
                        </div>
                      </td>
                      <td>
                        {q.category} / {q.year || '—'}
                      </td>
                      <td>
                        {q.wordLimit} 字 / {q.maxScore} 分
                      </td>
                      <td>
                        {q.allowReference
                          ? q.autoUnlockReference
                            ? '首轮发布后解锁'
                            : '老师手动解锁'
                          : '不开放'}
                      </td>
                      <td>
                        <button
                          className="secondary small"
                          onClick={() => {
                            setB({ ...q, year: q.year ?? undefined });
                            setEditing(q.id);
                            setOpen(true);
                            window.scrollTo(0, 0);
                          }}
                        >
                          编辑
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>创建第一道训练题，填写参考答案和评分依据。</Empty>
        )}
      </section>
    </>
  );
}
