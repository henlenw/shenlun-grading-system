import type { ObjectStore } from './object-store.js';

const MAX_BYTES = 10 * 1024 * 1024;
export function cloudbaseObjectStore(
  envId: string,
  bucket: string,
  apiKey: string,
  validateKey: (key: string) => void,
  request: typeof fetch = fetch,
): ObjectStore {
  if (
    !/^[a-z0-9][a-z0-9-]{4,99}$/.test(envId) ||
    !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket) ||
    !apiKey
  )
    throw Error('CloudBase 私有对象存储尚未配置');
  const base = `https://${envId}.api.tcloudbasegateway.com/v1/storages`;
  const objectPath = (key: string) => {
    validateKey(key);
    return `${bucket}/${encodeURIComponent(key)}`;
  };
  async function send(route: string, init: RequestInit = {}) {
    return request(base + route, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  }
  function checked(r: Response) {
    if (!r.ok) throw Error(`原稿存储请求失败（HTTP ${r.status}）`);
    return r;
  }
  return {
    async put(key, bytes, mime) {
      const route = '/object/' + objectPath(key);
      if (bytes.length > MAX_BYTES) throw Error('原稿不能超过 10 MB');
      checked(
        await send(route, {
          method: 'POST',
          headers: {
            'Content-Type': mime,
            'Cache-Control': 'private, max-age=0, no-store',
            'x-upsert': 'false',
          },
          body: new Uint8Array(bytes),
        }),
      );
    },
    async read(key) {
      const r = checked(await send('/object/' + objectPath(key)));
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw Error('原稿超过存储读取上限');
      return bytes;
    },
    async exists(key) {
      const r = await send('/object/info/' + objectPath(key));
      if (r.status === 404) return false;
      if (r.status === 400) {
        const error = (await r.json().catch(() => ({}))) as {
          code?: string;
          error?: string;
          statusCode?: string | number;
        };
        if (
          String(error.statusCode) === '404' ||
          [error.code, error.error].some((x) =>
            /^(NoSuchKey|not_found|ObjectNotFound)$/.test(x || ''),
          )
        )
          return false;
      }
      checked(r);
      return true;
    },
    async remove(key) {
      objectPath(key);
      checked(
        await send('/object/' + bucket, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: [key] }),
        }),
      );
    },
  };
}
