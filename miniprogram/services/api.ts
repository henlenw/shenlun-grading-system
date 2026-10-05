import { API_BASE_URL } from '../config';
let redirecting = false;
export function user() {
  return wx.getStorageSync('user') as { id: string; name: string; role: string } | undefined;
}
export function token() {
  return wx.getStorageSync('session') as string;
}
export function saveSession(data: any) {
  wx.setStorageSync('session', data.token);
  wx.setStorageSync('user', data.user);
}
export function requireLogin() {
  if (token() && user()) return true;
  if (!redirecting) {
    redirecting = true;
    wx.navigateTo({
      url: '/pages/login/index',
      complete: () => {
        redirecting = false;
      },
    });
  }
  return false;
}
export function api<T = any>(
  url: string,
  method: WechatMiniprogram.RequestOption['method'] = 'GET',
  data?: any,
): Promise<T> {
  return new Promise((resolve, reject) =>
    wx.request({
      url: API_BASE_URL + url,
      method,
      data,
      timeout: 15000,
      header: {
        Authorization: token() ? 'Bearer ' + token() : '',
        'content-type': 'application/json',
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data as T);
        else {
          if (res.statusCode === 401 && !url.startsWith('/auth/')) {
            wx.removeStorageSync('session');
            requireLogin();
          }
          reject(Error((res.data as any)?.message || '请求失败，请稍后重试'));
        }
      },
      fail() {
        reject(Error('网络连接失败，请检查网络后重试。草稿保留在本机。'));
      },
    }),
  );
}
export function upload(attemptId: string, filePath: string, name: string): Promise<any> {
  return new Promise((resolve, reject) =>
    wx.uploadFile({
      url:
        API_BASE_URL + '/student/attempts/' + attemptId + '/files?name=' + encodeURIComponent(name),
      filePath,
      name: 'file',
      header: { Authorization: 'Bearer ' + token() },
      timeout: 60000,
      success(res) {
        try {
          const data = JSON.parse(res.data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(Error(data.message || '上传失败'));
        } catch {
          reject(Error('上传响应异常'));
        }
      },
      fail() {
        reject(Error('上传失败，请重试'));
      },
    } as WechatMiniprogram.UploadFileOption),
  );
}
export async function openFile(file: any) {
  const res = await new Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>(
    (resolve, reject) =>
      wx.downloadFile({
        url: API_BASE_URL + '/files/' + file.id,
        header: { Authorization: 'Bearer ' + token() },
        success: resolve,
        fail: reject,
      }),
  );
  if (res.statusCode !== 200) throw Error('文件下载失败');
  if (file.mimeType?.startsWith('image/')) await wx.previewImage({ urls: [res.tempFilePath] });
  else if (file.mimeType === 'text/plain') {
    const text = await new Promise<string>((resolve, reject) =>
      wx.getFileSystemManager().readFile({
        filePath: res.tempFilePath,
        encoding: 'utf8',
        success: (result) => resolve(String(result.data)),
        fail: reject,
      }),
    );
    await wx.showModal({
      title: file.fileName,
      content: text.slice(0, 3000) + (text.length > 3000 ? '\n更多内容请查看作答原文。' : ''),
      showCancel: false,
    });
  } else {
    await wx.openDocument({
      filePath: res.tempFilePath,
      fileType: file.fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx',
      showMenu: true,
    });
  }
}
export const statusLabels: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  PROCESSING: '批改中',
  AI_GRADED: '老师审核中',
  TEACHER_REVIEWING: '老师审核中',
  REVISION_REQUESTED: '需要重做',
  PUBLISHED: '已完成',
  ARCHIVED: '已归档',
};
export const date = (value: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
export const message = (e: any) => e?.message || '操作失败，请重试';
