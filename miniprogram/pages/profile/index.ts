import { api, requireLogin, user, message } from '../../services/api';
Page({
  data: {
    name: '',
    stats: null as any,
    error: '',
    average: 0,
    best: 0,
    rate: 0,
    courses: [] as any[],
    serviceType: '',
  },
  account() {
    wx.navigateTo({ url: '/pages/account/index' });
  },
  onShow() {
    if (requireLogin()) void this.load();
  },
  async load() {
    try {
      const stats = await api('/student/stats');
      const access = await api('/student/courses');
      const scores = stats.scores.map((s: any) => s.score);
      this.setData({
        name: user()?.name || '',
        stats,
        courses: access.courses,
        serviceType: access.serviceType || '',
        average: scores.length
          ? Math.round(
              (scores.slice(-5).reduce((x: number, y: number) => x + y, 0) /
                Math.min(5, scores.length)) *
                10,
            ) / 10
          : 0,
        best: scores.length ? Math.max(...scores) : 0,
        rate: stats.total ? Math.round((stats.completed / stats.total) * 100) : 0,
        error: '',
      });
      wx.nextTick(() => this.draw(stats.scores));
    } catch (e) {
      this.setData({ error: message(e) });
    }
  },
  draw(scores: any[]) {
    const ctx = wx.createCanvasContext('trend', this);
    const width = wx.getWindowInfo().windowWidth - 64;
    ctx.clearRect(0, 0, width, 180);
    if (!scores.length) {
      ctx.draw();
      return;
    }
    const points = scores.slice(-10);
    ctx.setStrokeStyle('#1a6259');
    ctx.setLineWidth(2);
    ctx.beginPath();
    points.forEach((s, i) => {
      const x = 20 + (i * (width - 40)) / Math.max(1, points.length - 1),
        y = 145 - (s.score / s.maxScore) * 110;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    points.forEach((s, i) => {
      const x = 20 + (i * (width - 40)) / Math.max(1, points.length - 1),
        y = 145 - (s.score / s.maxScore) * 110;
      ctx.setFillStyle('#1a6259');
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.setFontSize(12);
      ctx.fillText(String(s.score), x - 8, y - 12);
    });
    ctx.draw();
  },
  open(e: any) {
    wx.navigateTo({ url: '/pages/assignment-detail/index?id=' + e.currentTarget.dataset.id });
  },
  privacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },
  redeem() {
    wx.navigateTo({ url: '/pages/redeem/index' });
  },
  async logout() {
    const decision = await wx.showModal({
      title: '退出登录',
      content: '未提交草稿仍保留在本机，重新登录后可继续。',
      confirmText: '退出',
    });
    if (!decision.confirm) return;
    try {
      await api('/auth/logout', 'POST');
      wx.removeStorageSync('session');
      wx.removeStorageSync('user');
      wx.navigateTo({ url: '/pages/login/index' });
    } catch (e) {
      this.setData({ error: message(e) });
    }
  },
});
