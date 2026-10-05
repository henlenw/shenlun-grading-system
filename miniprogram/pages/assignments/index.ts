import { api, requireLogin, message } from '../../services/api';
import { trainingCard } from '../../utils/training';
Page({
  data: { items: [] as any[], all: [] as any[], tab: 'pending', error: '', loading: false },
  onShow() {
    if (requireLogin()) void this.load();
  },
  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh());
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const rows = await api<any[]>('/student/questions');
      this.setData({ all: rows.map(trainingCard) });
      this.filter();
    } catch (e) {
      this.setData({ error: message(e) });
    } finally {
      this.setData({ loading: false });
    }
  },
  tab(e: any) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    this.filter();
  },
  filter() {
    const t = this.data.tab;
    this.setData({
      items: this.data.all.filter(
        (a) =>
          t === 'all' ||
          (t === 'pending' && a.canWrite) ||
          (t === 'review' && a.latest && !a.latest.finalGrade && a.latest.status !== 'DRAFT') ||
          (t === 'done' && a.completed),
      ),
    });
  },
  open(e: any) {
    wx.navigateTo({
      url: '/pages/assignment-detail/index?questionId=' + e.currentTarget.dataset.id,
    });
  },
  redeem() {
    wx.navigateTo({ url: '/pages/redeem/index' });
  },
});
