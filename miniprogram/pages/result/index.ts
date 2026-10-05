import { api, requireLogin, statusLabels, message, openFile, date } from '../../services/api';
import { trainingCard } from '../../utils/training';
Page({
  data: {
    assignmentId: '',
    attemptId: '',
    a: null as any,
    assignment: null as any,
    segments: [] as any[],
    error: '',
    canWrite: false,
    hasOriginal: false,
  },
  onLoad(o) {
    this.setData({ assignmentId: o.assignmentId || '', attemptId: o.attemptId || '' });
  },
  onShow() {
    if (requireLogin()) void this.load();
  },
  async load() {
    try {
      const assignment = await api('/student/assignments/' + this.data.assignmentId);
      const a = assignment.attempts.find((x: any) => x.id === this.data.attemptId);
      if (!a) throw Error('未找到本次作答');
      const text = a.text || a.extractedText || '';
      const annotations = a.finalGrade?.annotations || [];
      const ends = [
        ...new Set<number>([
          0,
          text.length,
          ...annotations.flatMap((n: any) => [n.startOffset, n.endOffset]),
        ]),
      ].sort((x, y) => x - y);
      this.setData({
        assignment: { ...assignment, question: a.question || assignment.question },
        canWrite: trainingCard(assignment).canWrite,
        hasOriginal:
          !!a.finalGrade &&
          a.attachments.some(
            (f: any) => f.mimeType.startsWith('image/') || f.mimeType === 'application/pdf',
          ),
        a: { ...a, statusText: statusLabels[a.status], revisionDueText: date(a.revisionDueAt) },
        segments: ends.slice(0, -1).map((start, i) => ({
          text: text.slice(start, ends[i + 1]),
          highlight: annotations.some(
            (n: any) => n.startOffset <= start && n.endOffset >= ends[i + 1],
          ),
        })),
        error: '',
      });
    } catch (e) {
      this.setData({ error: message(e) });
    }
  },
  async file(e: any) {
    try {
      await openFile(this.data.a.attachments[e.currentTarget.dataset.index]);
    } catch (e) {
      this.setData({ error: message(e) });
    }
  },
  redo() {
    wx.navigateTo({ url: '/pages/submit/index?id=' + this.data.assignmentId });
  },
  original() {
    wx.navigateTo({
      url:
        '/pages/original/index?assignmentId=' +
        this.data.assignmentId +
        '&attemptId=' +
        this.data.attemptId,
    });
  },
});
