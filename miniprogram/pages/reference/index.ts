import { api, requireLogin, message } from '../../services/api';
Page({
  data: { id: '', reference: null as any, error: '' },
  onLoad(o) {
    this.setData({ id: o.id || '' });
  },
  onShow() {
    if (requireLogin()) void this.load();
  },
  async load() {
    try {
      this.setData({
        reference: await api('/student/questions/' + this.data.id + '/reference'),
        error: '',
      });
    } catch (e) {
      this.setData({ error: message(e) });
    }
  },
});
