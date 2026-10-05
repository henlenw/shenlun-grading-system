let csrf = '';
const pendingReads = new Map<string, Promise<any>>();
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (method === 'GET') {
    const existing = pendingReads.get(path);
    if (existing) return existing;
    const request = requestApi<T>(path, method, body).finally(() => pendingReads.delete(path));
    pendingReads.set(path, request);
    return request;
  }
  return requestApi<T>(path, method, body);
}
async function requestApi<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (method !== 'GET' && !csrf && !path.startsWith('/auth/')) {
    const me = await api('/auth/me');
    csrf = me.csrfToken;
  }
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), 'X-CSRF-Token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ message: '服务器响应异常' }));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/'))
      window.location.assign(
        window.location.pathname.startsWith('/student') ? '/student/login' : '/teacher/login',
      );
    throw new Error(data.message || '操作未完成');
  }
  if (data.csrfToken) csrf = data.csrfToken;
  if (path === '/auth/logout') csrf = '';
  return data;
}
export async function csrfToken() {
  if (!csrf) await api('/auth/me');
  return csrf;
}
export async function backup() {
  if (!csrf) await api('/auth/me');
  const res = await fetch('/api/admin/backup', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrf },
  });
  if (!res.ok) throw Error((await res.json()).message);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export const labels: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  PROCESSING: '处理中',
  AI_GRADED: '待复核',
  TEACHER_REVIEWING: '复核中',
  REVISION_REQUESTED: '需重做',
  PUBLISHED: '已发布',
  ARCHIVED: '已归档',
};
export const categories: Record<string, string> = {
  CONTENT: '内容',
  POINT: '要点',
  LOGIC: '逻辑',
  STRUCTURE: '结构',
  LANGUAGE: '语言',
  WORDING: '措辞',
  MATERIAL: '材料',
  ARGUMENT: '论证',
  POLICY: '政策',
  TASK_REQUIREMENT: '任务要求',
  OTHER: '其他',
};
export const date = (v?: string) =>
  v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—';
