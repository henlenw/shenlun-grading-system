import { api, requireLogin, message } from '../../services/api';
Page({
  data: {
    username: '',
    password: '',
    currentPassword: '',
    webReady: false,
    busy: false,
    error: '',
    notice: '',
  },
  onShow() {
    if (requireLogin())
      api('/student/account')
        .then((a) => this.setData({ username: a.username || '', webReady: a.webReady }))
        .catch((e) => this.setData({ error: message(e) }));
  },
  input(e: any) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  async save() {
    this.setData({ busy: true, error: '', notice: '' });
    try {
      await api('/student/account', 'PUT', {
        username: this.data.username,
        password: this.data.password,
        currentPassword: this.data.currentPassword,
      });
      this.setData({
        webReady: true,
        password: '',
        currentPassword: '',
        notice: '网页账号已保存。网站和小程序共用同一份训练档案。其他设备需要重新登录。',
      });
    } catch (e) {
      this.setData({ error: message(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
