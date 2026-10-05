import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { mkdir, writeFile, readFile, unlink, stat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Config } from './config.js';
import { fail } from './security.js';
import { cloudbaseObjectStore } from './cloudbase-store.js';
export interface ObjectStore {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
}
export function localPath(c: Config, key: string) {
  if (!/^[0-9a-f-]{36}\.(pdf|docx|txt|jpg|jpeg|png)$/.test(key)) fail(400, '文件路径不合法');
  return path.join(c.storage, 'submissions', key);
}
const stores = new WeakMap<Config, ObjectStore>();
export function objectStore(c: Config): ObjectStore {
  const cached = stores.get(c);
  if (cached) return cached;
  let store: ObjectStore;
  if (c.storageProvider === 's3') {
    if (!c.s3Bucket || !c.s3Region || !c.s3AccessKey || !c.s3SecretKey)
      throw Error('私有对象存储尚未配置');
    const client = new S3Client({
      region: c.s3Region,
      endpoint: c.s3Endpoint || undefined,
      forcePathStyle: c.s3PathStyle,
      credentials: { accessKeyId: c.s3AccessKey, secretAccessKey: c.s3SecretKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    const input = (key: string) => {
      localPath(c, key);
      return { Bucket: c.s3Bucket, Key: 'submissions/' + key };
    };
    store = {
      async put(key, bytes, mime) {
        await client.send(
          new PutObjectCommand({
            ...input(key),
            Body: bytes,
            ContentType: mime,
            CacheControl: 'private, no-store',
          }),
        );
      },
      async read(key) {
        const r = await client.send(new GetObjectCommand(input(key)));
        if (!r.Body) throw Error('原稿不存在');
        return Buffer.from(await r.Body.transformToByteArray());
      },
      async exists(key) {
        try {
          await client.send(new HeadObjectCommand(input(key)));
          return true;
        } catch (e: any) {
          if (e.$metadata?.httpStatusCode === 404) return false;
          throw e;
        }
      },
      async remove(key) {
        await client.send(new DeleteObjectCommand(input(key)));
      },
    };
  } else if (c.storageProvider === 'cloudbase-pg') {
    store = cloudbaseObjectStore(
      c.cloudbaseEnvId,
      c.cloudbaseStorageBucket,
      c.cloudbaseApiKey,
      (key) => {
        localPath(c, key);
      },
    );
  } else if (c.storageProvider === 'local') {
    store = {
      async put(key, bytes) {
        const dest = localPath(c, key);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, bytes, { flag: 'wx' });
      },
      read(key) {
        return readFile(localPath(c, key));
      },
      async exists(key) {
        try {
          return (await stat(localPath(c, key))).isFile();
        } catch (e: any) {
          if (e.code === 'ENOENT') return false;
          throw e;
        }
      },
      async remove(key) {
        await unlink(localPath(c, key)).catch((e: any) => {
          if (e.code !== 'ENOENT') throw e;
        });
      },
    };
  } else throw Error('不支持的原稿存储类型');
  stores.set(c, store);
  return store;
}
export async function withLocalObject<T>(
  c: Config,
  key: string,
  fn: (file: string) => Promise<T>,
): Promise<T> {
  localPath(c, key);
  if (c.storageProvider === 'local') return fn(localPath(c, key));
  const dir = await mkdtemp(path.join(tmpdir(), 'kaoba-original-'));
  try {
    const file = path.join(dir, key);
    await writeFile(file, await objectStore(c).read(key));
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
