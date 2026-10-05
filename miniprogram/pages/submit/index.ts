import { api, requireLogin, user, upload, message } from '../../services/api';
import { DraftSync } from '../../utils/draft-sync';
Page({
  data: {
    assignmentId: '',
    attemptId: '',
    title: '',
    wordLimit: 0,
    text: '',
    count: 0,
    saveState: '载入草稿…',
    error: '',
    busy: false,
    ready: false,
    files: [] as any[],
  },
  sync: null as DraftSync | null,
  localKey: '',
  onLoad(o) {
    this.setData({ assignmentId: o.id || '' });
    if (requireLogin()) void this.load();
  },
  async load() {
    this.setData({ error: '', ready: false });
    try {
      if (this.sync) {
        await this.sync.flush().catch(() => {});
        this.sync.dispose();
        this.sync = null;
      }
      const a = await api('/student/assignments/' + this.data.assignmentId);
      const draft = await api('/student/assignments/' + this.data.assignmentId + '/draft', 'POST');
      this.localKey = 'draft:' + user()!.id + ':' + draft.id;
      const cache = wx.getStorageSync(this.localKey) as
        { text: string; version: number } | undefined;
      let text = draft.text;
      let restore = false;
      if (cache && cache.text !== draft.text) {
        const decision = await wx.showModal({
          title: '发现本机草稿',
          content:
            cache.version === draft.version
              ? '本机有尚未同步的内容，是否恢复？'
              : '云端草稿已更新。本机也有不同的内容。恢复本机会替换云端当前草稿；两份内容仍可先复制保存。',
          confirmText: '恢复本机',
          cancelText: '使用云端',
        });
        restore = decision.confirm;
        if (restore) text = cache.text;
        else wx.setStorageSync(this.localKey + ':recovery', cache);
      }
      wx.setStorageSync(this.localKey, { text, version: draft.version });
      this.sync = new DraftSync(
        draft.text,
        draft.version,
        (text, version) =>
          api('/student/attempts/' + draft.id + '/draft', 'PUT', { text, version }),
        (text, version) => wx.setStorageSync(this.localKey, { text, version }),
        (saveState) => this.setData({ saveState }),
      );
      this.setData({
        attemptId: draft.id,
        title: a.title,
        wordLimit: a.question.wordLimit,
        text,
        count: Array.from(text.replace(/\s/g, '')).length,
        files: draft.attachments,
        ready: true,
        saveState: '草稿已载入',
      });
      if (restore) this.sync.change(text);
    } catch (e) {
      this.setData({ error: message(e) });
    }
  },
  input(e: any) {
    const text = e.detail.value;
    this.setData({ text, count: Array.from(text.replace(/\s/g, '')).length });
    this.sync?.change(text);
  },
  async save() {
    try {
      await this.sync?.flush();
      this.setData({ error: '' });
    } catch (e) {
      this.setData({ error: message(e) });
    }
  },
  async chooseFile() {
    if (!this.sync) return;
    this.setData({ busy: true, error: '' });
    try {
      await this.sync.flush();
      await wx.requirePrivacyAuthorize({});
      const chosen = await wx.chooseMessageFile({
        count: Math.max(1, 5 - this.data.files.length),
        type: 'file',
        extension: ['pdf', 'docx', 'txt', 'jpg', 'jpeg', 'png'],
      });
      for (const f of chosen.tempFiles) await this.uploadOne(f.path, f.name);
    } catch (e: any) {
      if (!e.errMsg?.includes('cancel')) this.setData({ error: message(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async photo() {
    if (!this.sync) return;
    this.setData({ busy: true, error: '' });
    try {
      await this.sync.flush();
      await wx.requirePrivacyAuthorize({});
      const chosen = await wx.chooseMedia({
        count: Math.max(1, 5 - this.data.files.length),
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['original'],
      });
      for (const f of chosen.tempFiles) {
        const ext = f.tempFilePath.toLowerCase().endsWith('.png') ? '.png' : '.jpg';
        await this.uploadOne(f.tempFilePath, '作答照片-' + Date.now() + ext);
      }
    } catch (e: any) {
      if (!e.errMsg?.includes('cancel')) this.setData({ error: message(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async uploadOne(path: string, name: string) {
    if (/\.(png|jpe?g)$/i.test(name)) {
      const original = await wx.getImageInfo({ src: path });
      const ratio = Math.min(1, 2048 / Math.max(original.width, original.height));
      try {
        const compressed = await wx.compressImage({
          src: path,
          quality: 85,
          compressedWidth: Math.round(original.width * ratio),
          compressedHeight: Math.round(original.height * ratio),
        });
        const info = await wx.getImageInfo({ src: compressed.tempFilePath });
        path = compressed.tempFilePath;
        name = name.replace(/\.[^.]+$/, info.type === 'png' ? '.png' : '.jpg');
      } catch {
        throw Error('照片压缩未完成，请重试或在相册中缩小照片后上传。');
      }
    }
    const file = await upload(this.data.attemptId, path, name);
    this.sync!.adoptVersion(file.version);
    this.setData({ files: [...this.data.files, file] });
  },
  async remove(e: any) {
    if (!this.sync) return;
    this.setData({ busy: true });
    try {
      await this.sync.flush();
      const id = e.currentTarget.dataset.id;
      const res = await api('/student/files/' + id, 'DELETE');
      this.sync.adoptVersion(res.version);
      this.setData({ files: this.data.files.filter((f) => f.id !== id) });
    } catch (e) {
      this.setData({ error: message(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async submit() {
    if (!this.sync) return;
    const confirm = await wx.showModal({
      title: '确认提交',
      content:
        '提交后将交给老师批改，本次作答不能再修改。当前 ' +
        this.data.count +
        ' 字，' +
        this.data.files.length +
        ' 个附件。',
      confirmText: '确认提交',
    });
    if (!confirm.confirm) return;
    this.setData({ busy: true, error: '' });
    try {
      await this.sync.flush();
      await api('/student/attempts/' + this.data.attemptId + '/submit', 'POST', {
        version: this.sync.version,
      });
      this.sync.dispose();
      this.sync = null;
      wx.removeStorageSync(this.localKey);
      wx.redirectTo({
        url:
          '/pages/result/index?assignmentId=' +
          this.data.assignmentId +
          '&attemptId=' +
          this.data.attemptId,
      });
    } catch (e) {
      this.setData({ error: message(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
  copy() {
    wx.setClipboardData({ data: this.data.text });
  },
  onHide() {
    if (this.sync) void this.sync.flush().catch(() => {});
  },
  onUnload() {
    this.sync?.dispose();
  },
});
