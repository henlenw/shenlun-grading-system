import { api, token, requireLogin, message } from '../../services/api';
import { API_BASE_URL } from '../../config';
Page({
  data: {
    assignmentId: '',
    attemptId: '',
    files: [] as any[],
    annotations: [] as any[],
    comments: [] as any[],
    fileIndex: 0,
    page: 1,
    total: 1,
    error: '',
    loading: false,
    canvasWidth: 320,
    canvasHeight: 440,
    zoomed: false,
  },
  previewPath: '',
  imageWidth: 0,
  imageHeight: 0,
  requestId: 0,
  onLoad(o) {
    this.setData({ assignmentId: o.assignmentId || '', attemptId: o.attemptId || '' });
  },
  onShow() {
    if (requireLogin()) void this.load();
  },
  async load() {
    try {
      const d = await api('/student/assignments/' + this.data.assignmentId),
        a = d.attempts.find((x: any) => x.id === this.data.attemptId);
      if (!a?.finalGrade) throw Error('老师尚未发布本次批注');
      this.setData({
        files: a.attachments.filter(
          (f: any) => f.mimeType.startsWith('image/') || f.mimeType === 'application/pdf',
        ),
        annotations: a.finalGrade.pageAnnotations || [],
      });
      await this.loadPage();
    } catch (e) {
      this.setData({ error: message(e) });
    }
  },
  async loadPage() {
    const file = this.data.files[this.data.fileIndex];
    if (!file) return;
    const request = ++this.requestId;
    this.setData({ loading: true, error: '' });
    try {
      const meta = await api('/files/' + file.id + '/preview?info=true');
      const res = await new Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>(
        (resolve, reject) =>
          wx.downloadFile({
            url: API_BASE_URL + '/files/' + file.id + '/preview?page=' + this.data.page,
            header: { Authorization: 'Bearer ' + token() },
            success: resolve,
            fail: reject,
          }),
      );
      if (res.statusCode !== 200) throw Error('原稿暂时无法预览，请稍后重试');
      const info = await wx.getImageInfo({ src: res.tempFilePath });
      if (request !== this.requestId) return;
      this.previewPath = res.tempFilePath;
      this.imageWidth = info.width;
      this.imageHeight = info.height;
      this.setData({
        total: meta.total,
        comments: this.data.annotations.filter(
          (a: any) => a.fileId === file.id && a.page === this.data.page,
        ),
      });
      this.draw();
    } catch (e) {
      if (request === this.requestId) this.setData({ error: message(e) });
    } finally {
      if (request === this.requestId) this.setData({ loading: false });
    }
  },
  draw() {
    if (!this.previewPath) return;
    const width = (wx.getWindowInfo().windowWidth - 32) * (this.data.zoomed ? 2 : 1),
      height = (width * this.imageHeight) / this.imageWidth;
    this.setData({ canvasWidth: width, canvasHeight: height });
    wx.nextTick(() => {
      const ctx = wx.createCanvasContext('original', this),
        scale = width / 700;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(this.previewPath, 0, 0, width, height);
      for (const a of this.data.comments) {
        const x = a.x * width,
          y = a.y * height,
          w = a.width * width,
          h = a.height * height;
        ctx.save();
        ctx.setStrokeStyle(a.color);
        ctx.setFillStyle(a.color);
        ctx.setLineWidth(Math.max(1.5, scale * 2.5));
        if (a.type === 'check' || a.type === 'cross') {
          ctx.beginPath();
          if (a.type === 'check') {
            ctx.moveTo(x, y + h * 0.5);
            ctx.lineTo(x + w * 0.35, y + h);
            ctx.lineTo(x + w, y);
          } else {
            ctx.moveTo(x, y);
            ctx.lineTo(x + w, y + h);
            ctx.moveTo(x + w, y);
            ctx.lineTo(x, y + h);
          }
          ctx.stroke();
        } else if (a.type === 'circle') {
          ctx.translate(x + w / 2, y + h / 2);
          ctx.scale(Math.max(w / 2, 0.1), Math.max(h / 2, 0.1));
          ctx.beginPath();
          ctx.arc(0, 0, 1, 0, Math.PI * 2);
          ctx.setLineWidth(2 / Math.max(w / 2, 1));
          ctx.stroke();
        } else if (a.type === 'rectangle') ctx.strokeRect(x, y, w, h);
        else if (a.type === 'highlight') {
          ctx.setGlobalAlpha(0.25);
          ctx.fillRect(x, y, w, h);
        } else if (['underline', 'strike', 'arrow'].includes(a.type)) {
          const endX = a.type === 'arrow' ? (a.endX ?? a.x + a.width) * width : x + w,
            endY =
              a.type === 'arrow'
                ? (a.endY ?? a.y + a.height) * height
                : a.type === 'strike'
                  ? y + h / 2
                  : y + h;
          const startX = a.type === 'arrow' && endX < x + w / 2 ? x + w : x,
            startY = a.type === 'arrow' ? (endY < y + h / 2 ? y + h : y) : endY;
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          if (a.type === 'arrow') {
            const angle = Math.atan2(endY - startY, endX - startX),
              len = 10 * scale;
            ctx.moveTo(endX - len * Math.cos(angle - 0.5), endY - len * Math.sin(angle - 0.5));
            ctx.lineTo(endX, endY);
            ctx.lineTo(endX - len * Math.cos(angle + 0.5), endY - len * Math.sin(angle + 0.5));
          }
          ctx.stroke();
        } else {
          ctx.setFillStyle('#ffffff');
          ctx.setGlobalAlpha(0.9);
          ctx.fillRect(x, y, w, h);
          ctx.setGlobalAlpha(1);
          if (a.type === 'comment') ctx.strokeRect(x, y, w, h);
          ctx.setFillStyle(a.color);
          ctx.setFontSize(Math.max(11, (18 * width) / 1000));
          let line = '',
            dy = (20 * width) / 1000;
          for (const char of Array.from(String(a.content))) {
            if (char === '\n' || ctx.measureText(line + char).width > w - 8) {
              ctx.fillText(line, x + 4, y + dy);
              line = char === '\n' ? '' : char;
              dy += (24 * width) / 1000;
              if (dy > h) break;
            } else line += char;
          }
          if (dy <= h) ctx.fillText(line, x + 4, y + dy);
        }
        ctx.restore();
      }
      ctx.draw();
    });
  },
  selectFile(e: any) {
    this.setData({ fileIndex: Number(e.currentTarget.dataset.index), page: 1 });
    void this.loadPage();
  },
  prev() {
    if (this.data.page > 1) {
      this.setData({ page: this.data.page - 1 });
      void this.loadPage();
    }
  },
  next() {
    if (this.data.page < this.data.total) {
      this.setData({ page: this.data.page + 1 });
      void this.loadPage();
    }
  },
  zoom() {
    this.setData({ zoomed: !this.data.zoomed });
    this.draw();
  },
  onUnload() {
    this.requestId++;
  },
});
