import { api, requireLogin, message } from '../../services/api';
Page({
  data: { code: '', busy: false, error: '', success: '' },
  onShow() {
    requireLogin();
  },
  input(e: any) {
    this.setData({ code: e.detail.value });
  },
  async redeem() {
    if (this.data.busy || !this.data.code.trim()) return;
    this.setData({ busy: true, error: '', success: '' });
    try {
      const r = await api('/student/redeem', 'POST', { code: this.data.code });
      this.setData({ code: '', success: '兑换成功：' + r.name });
    } catch (e) {
      this.setData({ error: message(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
  questions() {
    wx.switchTab({ url: '/pages/assignments/index' });
  },
});
