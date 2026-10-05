'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ErrorBox, message } from './shared';
const tools = [
  ['select', '选择 / 移动'],
  ['check', '打勾'],
  ['cross', '打叉'],
  ['circle', '圈选'],
  ['rectangle', '矩形'],
  ['underline', '下划线'],
  ['strike', '删除线'],
  ['arrow', '箭头'],
  ['highlight', '高亮'],
  ['text', '文字'],
  ['comment', '批注框'],
];
function Shape({ a, h, selected }: { a: any; h: number; selected: boolean }) {
  const x = a.x * 1000,
    y = a.y * h,
    w = a.width * 1000,
    height = a.height * h,
    color = a.color;
  const common = {
    stroke: color,
    strokeWidth: 2.5,
    fill: 'none',
    vectorEffect: 'non-scaling-stroke' as const,
  };
  let shape;
  if (a.type === 'check')
    shape = (
      <path
        {...common}
        d={`M ${x} ${y + height * 0.5} L ${x + w * 0.35} ${y + height} L ${x + w} ${y}`}
      />
    );
  else if (a.type === 'cross')
    shape = (
      <path
        {...common}
        d={`M ${x} ${y} L ${x + w} ${y + height} M ${x + w} ${y} L ${x} ${y + height}`}
      />
    );
  else if (a.type === 'circle')
    shape = <ellipse {...common} cx={x + w / 2} cy={y + height / 2} rx={w / 2} ry={height / 2} />;
  else if (a.type === 'rectangle')
    shape = <rect {...common} x={x} y={y} width={w} height={height} />;
  else if (a.type === 'highlight')
    shape = <rect x={x} y={y} width={w} height={height} fill={color} opacity=".25" />;
  else if (['underline', 'strike', 'arrow'].includes(a.type)) {
    const startX =
      a.type === 'arrow' && a.endX !== undefined && a.endX < a.x + a.width / 2 ? x + w : x;
    const startY =
      a.type === 'arrow' && a.endY !== undefined && a.endY < a.y + a.height / 2 ? y + height : y;
    const endX = a.type === 'arrow' ? (a.endX ?? a.x + a.width) * 1000 : x + w,
      endY =
        a.type === 'arrow'
          ? (a.endY ?? a.y + a.height) * h
          : a.type === 'strike'
            ? y + height / 2
            : y + height;
    const sy = a.type === 'arrow' ? startY : endY,
      angle = Math.atan2(endY - sy, endX - startX),
      len = 13;
    shape = (
      <>
        <line {...common} x1={startX} y1={sy} x2={endX} y2={endY} />
        {a.type === 'arrow' && (
          <path
            {...common}
            d={
              'M ' +
              (endX - len * Math.cos(angle - 0.5)) +
              ' ' +
              (endY - len * Math.sin(angle - 0.5)) +
              ' L ' +
              endX +
              ' ' +
              endY +
              ' L ' +
              (endX - len * Math.cos(angle + 0.5)) +
              ' ' +
              (endY - len * Math.sin(angle + 0.5))
            }
          />
        )}
      </>
    );
  } else
    shape = (
      <>
        <rect
          x={x}
          y={y}
          width={w}
          height={height}
          fill="white"
          fillOpacity=".9"
          stroke={a.type === 'comment' ? color : 'none'}
        />
        <foreignObject
          x={x + 4}
          y={y + 3}
          width={Math.max(1, w - 8)}
          height={Math.max(1, height - 6)}
        >
          <div
            style={{
              fontSize: 18,
              lineHeight: 1.35,
              color,
              overflowWrap: 'anywhere',
              whiteSpace: 'pre-wrap',
            }}
          >
            {a.content}
          </div>
        </foreignObject>
      </>
    );
  return (
    <g data-annotation={a.id} style={{ cursor: 'move' }}>
      {shape}
      {selected && (
        <rect
          x={x - 3}
          y={y - 3}
          width={w + 6}
          height={height + 6}
          stroke="#2477bb"
          strokeWidth="1"
          strokeDasharray="6 4"
          fill="none"
        />
      )}
    </g>
  );
}
export default function OriginalAnnotations({
  files,
  value,
  onChange,
  locked,
}: {
  files: any[];
  value: any[];
  onChange: (v: any[]) => void;
  locked: boolean;
}) {
  const supported = files.filter(
    (f) => f.mimeType.startsWith('image/') || f.mimeType === 'application/pdf',
  );
  const [fileId, setFile] = useState(supported[0]?.id || ''),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(1),
    [h, setH] = useState(1414),
    [tool, setTool] = useState('circle'),
    [color, setColor] = useState('#c53932'),
    [content, setContent] = useState(''),
    [selected, setSelected] = useState(''),
    [ghost, setGhost] = useState<any>(null),
    [zoom, setZoom] = useState(1),
    [err, setErr] = useState(''),
    [past, setPast] = useState<any[][]>([]),
    [future, setFuture] = useState<any[][]>([]);
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<any>(null);
  const fileMime = supported.find((f) => f.id === fileId)?.mimeType;
  useEffect(() => {
    let alive = true;
    setErr('');
    setTotal(1);
    if (fileId && fileMime === 'application/pdf')
      api('/files/' + fileId + '/preview?info=true')
        .then((x) => {
          if (alive) {
            setTotal(x.total);
            if (x.actualTotal > 100) setErr('此 PDF 超过 100 页，请下载原稿查看后续页面。');
          }
        })
        .catch((e) => {
          if (alive) setErr(message(e));
        });
    return () => {
      alive = false;
    };
  }, [fileId, fileMime]);
  if (!supported.length)
    return (
      <div className="notice">
        上传图片或 PDF 后可在原稿上标注。其他文档可下载查看，并在文字区域添加批注。
      </div>
    );
  function commit(next: any[]) {
    setPast((x) => [...x.slice(-49), value]);
    setFuture([]);
    onChange(next);
  }
  function pos(e: React.PointerEvent) {
    const box = svg.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
    };
  }
  function down(e: React.PointerEvent<SVGSVGElement>) {
    if (locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pos(e);
    const id = (e.target as Element).closest('[data-annotation]')?.getAttribute('data-annotation');
    if (tool === 'select') {
      setSelected(id || '');
      if (id) {
        const original = value.find((a) => a.id === id);
        gesture.current = { p, original };
        setGhost(original);
      }
      return;
    }
    if (['text', 'comment'].includes(tool) && !content.trim()) {
      setErr('先填写批注文字，再点击原稿放置。');
      return;
    }
    gesture.current = { p };
    setGhost({
      id: crypto.randomUUID(),
      fileId,
      page,
      type: tool,
      color,
      content,
      x: p.x,
      y: p.y,
      width: 0,
      height: 0,
    });
  }
  function move(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const p = pos(e);
    if (g.original) {
      const a = g.original,
        dx = Math.max(-a.x, Math.min(1 - a.x - a.width, p.x - g.p.x)),
        dy = Math.max(-a.y, Math.min(1 - a.y - a.height, p.y - g.p.y));
      setGhost({
        ...a,
        x: a.x + dx,
        y: a.y + dy,
        endX: a.endX === undefined ? undefined : a.endX + dx,
        endY: a.endY === undefined ? undefined : a.endY + dy,
      });
    } else
      setGhost((a: any) =>
        a
          ? {
              ...a,
              x: Math.min(p.x, g.p.x),
              y: Math.min(p.y, g.p.y),
              width: Math.abs(p.x - g.p.x),
              height: Math.abs(p.y - g.p.y),
              endX: p.x,
              endY: p.y,
            }
          : a,
      );
  }
  function up() {
    if (!gesture.current || !ghost) {
      gesture.current = null;
      return;
    }
    let a = ghost;
    if (['text', 'comment'].includes(a.type) && a.width < 0.05) {
      const width = 0.28,
        height = 0.1;
      a = { ...a, x: Math.min(a.x, 1 - width), y: Math.min(a.y, 1 - height), width, height };
    }
    if (a.width >= 0.002 || a.height >= 0.002) {
      commit(gesture.current.original ? value.map((x) => (x.id === a.id ? a : x)) : [...value, a]);
      setSelected(a.id);
      setErr('');
    }
    gesture.current = null;
    setGhost(null);
  }
  const current = value.filter((a) => a.fileId === fileId && a.page === page && a.id !== ghost?.id),
    sel = value.find((a) => a.id === selected);
  return (
    <section className="original-workspace">
      <div className="annotation-toolbar">
        <select
          aria-label="选择原稿"
          value={fileId}
          onChange={(e) => {
            setFile(e.target.value);
            setPage(1);
            setSelected('');
          }}
        >
          {supported.map((f) => (
            <option key={f.id} value={f.id}>
              {f.fileName}
            </option>
          ))}
        </select>
        <button
          className="secondary small"
          disabled={page <= 1}
          onClick={() => {
            setPage(page - 1);
            setSelected('');
          }}
        >
          上一页
        </button>
        <span>
          {page} / {total}
        </span>
        <button
          className="secondary small"
          disabled={page >= total}
          onClick={() => {
            setPage(page + 1);
            setSelected('');
          }}
        >
          下一页
        </button>
        <button
          className="secondary small"
          aria-label="缩小原稿"
          onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          className="secondary small"
          aria-label="放大原稿"
          onClick={() => setZoom(Math.min(3, zoom + 0.25))}
        >
          ＋
        </button>
      </div>
      {!locked && (
        <>
          <div className="annotation-toolbar">
            {tools.map(([k, l]) => (
              <button
                type="button"
                className={tool === k ? 'small' : 'secondary small'}
                key={k}
                onClick={() => setTool(k)}
              >
                {l}
              </button>
            ))}
            <label>
              颜色{' '}
              <input
                aria-label="批注颜色"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
            <button
              className="secondary small"
              disabled={!past.length}
              onClick={() => {
                setFuture((f) => [value, ...f]);
                onChange(past[past.length - 1]);
                setPast((p) => p.slice(0, -1));
              }}
            >
              撤销
            </button>
            <button
              className="secondary small"
              disabled={!future.length}
              onClick={() => {
                setPast((p) => [...p, value]);
                onChange(future[0]);
                setFuture((f) => f.slice(1));
              }}
            >
              重做
            </button>
            <button
              className="secondary small"
              onClick={() => {
                if (window.confirm('清空当前页的人工批注？原稿不会改变。'))
                  commit(value.filter((a) => a.fileId !== fileId || a.page !== page));
              }}
            >
              清空本页
            </button>
          </div>
          <div className="field">
            <label htmlFor="pageComment">批注文字（文字 / 批注框工具）</label>
            <input
              id="pageComment"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入说明，再在原稿上拖动框选或点击放置"
            />
          </div>
        </>
      )}
      <ErrorBox error={err} />
      <div className="original-scroll">
        <div className="original-sheet" style={{ width: zoom * 100 + '%' }}>
          <img
            draggable={false}
            src={'/api/files/' + fileId + '/preview?page=' + page}
            alt={'学生原稿，第 ' + page + ' 页'}
            onLoad={(e) =>
              setH((e.currentTarget.naturalHeight / e.currentTarget.naturalWidth) * 1000)
            }
            onError={() => setErr('原稿暂时无法预览，请重试或下载附件。')}
          />
          <svg
            ref={svg}
            viewBox={'0 0 1000 ' + h}
            preserveAspectRatio="none"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => {
              gesture.current = null;
              setGhost(null);
            }}
            style={{ touchAction: locked ? 'auto' : 'none' }}
          >
            {current.map((a) => (
              <Shape key={a.id} a={a} h={h} selected={a.id === selected} />
            ))}
            {ghost && <Shape a={ghost} h={h} selected />}
          </svg>
        </div>
      </div>
      {!locked && sel && (
        <div className="note">
          <b>已选批注 · 可拖动调整位置</b>
          <textarea
            aria-label="所选原稿批注文字"
            value={sel.content}
            onChange={(e) =>
              commit(value.map((a) => (a.id === sel.id ? { ...a, content: e.target.value } : a)))
            }
          />
          <div className="actions compact">
            <input
              aria-label="所选批注颜色"
              type="color"
              value={sel.color}
              onChange={(e) =>
                commit(value.map((a) => (a.id === sel.id ? { ...a, color: e.target.value } : a)))
              }
            />
            <button
              className="secondary small"
              onClick={() => {
                commit(value.filter((a) => a.id !== sel.id));
                setSelected('');
              }}
            >
              删除批注
            </button>
          </div>
        </div>
      )}
      <p className="muted">
        {locked
          ? '原稿与已发布批注 · 可缩放、翻页查看。'
          : '原稿保持不变。共 ' + value.length + ' 条页面批注，保存并发布后学生才可查看。'}
      </p>
    </section>
  );
}
