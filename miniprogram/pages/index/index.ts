import { api, requireLogin, user, message } from '../../services/api';
import { trainingCard } from '../../utils/training';
Page({
  data: {
    name: '',
    pending: [] as any[],
    notifications: [] as any[],
    latest: null as any,
    total: 0,
    training: 0,
    unread: 0,
    error: '',
    loading: false,
  },
  onShow() {
    if (requireLogin()) void this.load();
  },
  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh());
  },
  async load() {
    this.setData({ loading: true, error: '', name: user()?.name || '同学' });
    try {
      const [questions, notes] = await Promise.all([
        api<any[]>('/student/questions'),
        api<any[]>('/student/notifications'),
      ]);
      const items = questions.map(trainingCard);
      const published = items
        .filter((a) => a.latest?.finalGrade)
        .sort(
          (a, b) =>
            new Date(b.latest.finalGrade.publishedAt).getTime() -
            new Date(a.latest.finalGrade.publishedAt).getTime(),
        );
      this.setData({
        total: items.filter((a) => a.authorized).length,
        training: items.filter((a) => a.latest && !a.completed).length,
        pending: items.filter((a) => a.canWrite).slice(0, 3),
        latest: published[0] || null,
        notifications: notes.filter((n) => !n.readAt).slice(0, 4),
        unread: notes.filter((n) => !n.readAt).length,
      });
    } catch (e) {
      this.setData({ error: message(e) });
    } finally {
      this.setData({ loading: false });
    }
  },
  open(e: any) {
    wx.navigateTo({
      url: '/pages/assignment-detail/index?questionId=' + e.currentTarget.dataset.id,
    });
  },
  notification(e: any) {
    wx.navigateTo({ url: '/pages/assignment-detail/index?id=' + e.currentTarget.dataset.id });
  },
  all() {
    wx.switchTab({ url: '/pages/assignments/index' });
  },
  redeem() {
    wx.navigateTo({ url: '/pages/redeem/index' });
  },
  async read() {
    try {
      await api('/student/notifications/read', 'POST');
      await this.load();
    } catch (e) {
      this.setData({ error: message(e) });
    }
  },
});
