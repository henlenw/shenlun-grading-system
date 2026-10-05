import { api, saveSession, message, token } from '../../services/api';
Page({
  data: {
    busy: false,
    error: '',
    bindToken: '',
    bindingCode: '',
    username: '',
    password: '',
    useWeb: false,
    agreed: false,
  },
  onLoad() {
    if (token()) wx.switchTab({ url: '/pages/index/index' });
  },
  agree(e: any) {
    this.setData({ agreed: e.detail.value.length > 0 });
  },
  code(e: any) {
    this.setData({ bindingCode: e.detail.value });
  },
  privacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },
  async login() {
    if (!this.data.agreed) {
      this.setData({ error: '请先阅读并同意隐私说明' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const login = await wx.login();
      if (!login.code) throw Error('微信登录失败');
      const result = await api('/auth/wechat', 'POST', { code: login.code });
      if (result.needsBinding) this.setData({ bindToken: result.bindToken });
      else {
        saveSession(result);
        wx.switchTab({ url: '/pages/index/index' });
      }
    } catch (e) {
      this.setData({ error: message(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
  toggleWeb() {
    this.setData({ useWeb: !this.data.useWeb, error: '' });
  },
  credential(e: any) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  async link() {
    this.setData({ busy: true, error: '' });
    try {
      const result = await api('/auth/wechat/link', 'POST', {
        bindToken: this.data.bindToken,
        username: this.data.username,
        password: this.data.password,
      });
      saveSession(result);
      wx.switchTab({ url: '/pages/index/index' });
    } catch (e) {
      this.setData({ error: message(e) });
    } finally {
      this.setData({ busy: false, password: '' });
    }
  },
  async bind() {
    this.setData({ busy: true, error: '' });
    try {
      const result = await api('/auth/wechat/bind', 'POST', {
        bindToken: this.data.bindToken,
        bindingCode: this.data.bindingCode,
      });
      saveSession(result);
      wx.switchTab({ url: '/pages/index/index' });
    } catch (e) {
      this.setData({ error: message(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
  restart() {
    this.setData({ bindToken: '', bindingCode: '', error: '' });
  },
});
