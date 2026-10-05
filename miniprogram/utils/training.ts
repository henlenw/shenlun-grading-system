import { statusLabels } from '../services/api';
export function trainingCard(a: any) {
  const latest = a.latest || a.attempts?.[0];
  const round = latest?.roundNo || 0;
  return {
    ...a,
    statusText: !a.authorized
      ? '仅查看历史'
      : a.completed
        ? '三次训练已完成'
        : latest?.finalGrade && round < 3
          ? '可开始第 ' + (round + 1) + ' 次'
          : statusLabels[latest?.status] || '等待首次作答',
    progressText: (a.scores || [])
      .map((s: any) => '第' + s.round + '次 ' + s.score + '分')
      .join(' → '),
    canWrite:
      a.authorized &&
      (!latest || (latest.status === 'DRAFT' && round <= 3) || (!!latest.finalGrade && round < 3)),
    roundText: round ? '第 ' + round + ' / 3 次训练' : '首次独立作答',
  };
}
