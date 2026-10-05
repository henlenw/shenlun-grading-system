import { api, requireLogin, statusLabels, date, message } from '../../services/api';
import { trainingCard } from '../../utils/training';
Page({
  data: {
    id: '',
    questionId: '',
    assignment: null as any,
    attempts: [] as any[],
    canWrite: false,
    error: '',
    progress: [] as any[],
  },
  onLoad(o) {
    this.setData({ id: o.id || '', questionId: o.questionId || '' });
  },
  onShow() {
    if (requireLogin()) void this.load();
  },
  async load() {
    try {
      const raw = await api(
        this.data.questionId
          ? '/student/questions/' + this.data.questionId
          : '/student/assignments/' + this.data.id,
      );
      const a = trainingCard(raw),
        assignmentId = this.data.questionId ? raw.assignmentId : raw.id;
      this.setData({
        id: assignmentId,
        questionId: raw.questionId || raw.question?.id || this.data.questionId || raw.id,
        assignment: {
          ...a,
          dueText: new Date(a.dueAt).getFullYear() > 2090 ? '不限时训练' : date(a.dueAt),
        },
        attempts: a.attempts.map((x: any) => ({
          ...x,
          statusText: statusLabels[x.status],
          submittedText: date(x.submittedAt),
          revisionDueText: date(x.revisionDueAt),
        })),
        canWrite: a.canWrite,
        progress: [1, 2, 3].map((round) => {
          const attempt = a.attempts.find((x: any) => x.roundNo === round);
          return {
            round,
            label: attempt?.finalGrade
              ? attempt.finalGrade.finalScore + ' 分'
              : attempt
                ? statusLabels[attempt.status]
                : '未开始',
            done: !!attempt?.finalGrade,
          };
        }),
        error: '',
      });
    } catch (e) {
      this.setData({ error: message(e) });
    }
  },
  write() {
    wx.navigateTo({ url: '/pages/submit/index?id=' + this.data.id });
  },
  reference() {
    wx.navigateTo({ url: '/pages/reference/index?id=' + this.data.questionId });
  },
  result(e: any) {
    wx.navigateTo({
      url:
        '/pages/result/index?assignmentId=' +
        this.data.id +
        '&attemptId=' +
        e.currentTarget.dataset.id,
    });
  },
});
