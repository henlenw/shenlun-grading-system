import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
export function loadConfig() {
  const secret = process.env.SESSION_SECRET || '';
  if (secret.length < 32 || secret.startsWith('CHANGE_ME'))
    throw new Error('请先运行 pnpm setup，配置 SESSION_SECRET。');
  const production = process.env.NODE_ENV === 'production';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  if (production && !appUrl.startsWith('https://'))
    throw new Error('生产环境 APP_URL 必须为 HTTPS');
  return {
    databaseProvider: process.env.DATABASE_PROVIDER || 'sqlite',
    storageProvider: process.env.STORAGE_PROVIDER || 'local',
    cloudbaseEnvId: process.env.CLOUDBASE_ENV_ID || '',
    cloudbaseStorageBucket: process.env.CLOUDBASE_STORAGE_BUCKET || 'submissions',
    cloudbaseApiKey: process.env.CLOUDBASE_API_KEY || '',
    s3Bucket: process.env.S3_BUCKET || '',
    s3Region: process.env.S3_REGION || '',
    s3Endpoint: process.env.S3_ENDPOINT || '',
    s3AccessKey: process.env.S3_ACCESS_KEY_ID || '',
    s3SecretKey: process.env.S3_SECRET_ACCESS_KEY || '',
    s3PathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    fileRetentionDays: Math.max(0, Number(process.env.FILE_RETENTION_DAYS || 0)),
    secret,
    production,
    appUrl,
    bootstrapToken: process.env.BOOTSTRAP_TOKEN || '',
    storage: path.resolve(root, process.env.STORAGE_PATH || './storage'),
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || '127.0.0.1',
    wechatAppId: process.env.WECHAT_APPID || '',
    wechatSecret: process.env.WECHAT_APPSECRET || '',
    remoteWorkerToken: process.env.REMOTE_WORKER_TOKEN || '',
    aiProvider: process.env.AI_PROVIDER || 'manual',
    ollamaUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    ocrEnabled: process.env.OCR_ENABLED === 'true',
    ocrUrl: process.env.OCR_URL || 'http://127.0.0.1:8001',
    ocrToken: process.env.OCR_TOKEN || '',
    businessUtcOffset: Number(process.env.BUSINESS_UTC_OFFSET_MINUTES || 480),
    auditRetentionDays: Math.max(30, Number(process.env.AUDIT_RETENTION_DAYS || 180)),
  };
}
export type Config = ReturnType<typeof loadConfig>;
