export function checkCloudEnv(env = process.env) {
  const missing = [];
  const required = ['APP_URL', 'SESSION_SECRET', 'BOOTSTRAP_TOKEN'];
  if (env.DATABASE_PROVIDER === 'postgres') required.push('DATABASE_URL');
  else if (env.DATABASE_PROVIDER === 'cloudbase-http')
    required.push('CLOUDBASE_ENV_ID', 'CLOUDBASE_API_KEY');
  else throw Error('Cloud database requires postgres or cloudbase-http');
  if (env.STORAGE_PROVIDER === 's3')
    required.push(
      'S3_REGION',
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    );
  else if (env.STORAGE_PROVIDER === 'cloudbase-pg')
    required.push('CLOUDBASE_ENV_ID', 'CLOUDBASE_API_KEY');
  else throw Error('Cloud mode requires private s3 or cloudbase-pg storage');
  for (const name of required) {
    const v = env[name] || '';
    if (!v || /REPLACE|YOUR_|CHANGE_ME/.test(v)) missing.push(name);
  }
  if (missing.length) throw Error('Cloud configuration missing: ' + missing.join(', '));
  const app = new URL(env.APP_URL);
  if (app.protocol !== 'https:' || app.origin !== env.APP_URL)
    throw Error('APP_URL must be the exact HTTPS origin, without trailing slash');
  if (env.DATABASE_PROVIDER === 'postgres' && !env.DATABASE_URL?.startsWith('postgres'))
    throw Error('DATABASE_URL requires PostgreSQL');
  if (env.SESSION_SECRET.length < 32 || env.BOOTSTRAP_TOKEN.length < 32)
    throw Error('SESSION_SECRET and BOOTSTRAP_TOKEN must be at least 32 characters');
  if (env.STORAGE_PROVIDER === 's3' && !env.S3_ENDPOINT.startsWith('https://'))
    throw Error('S3_ENDPOINT requires HTTPS');
  if (
    (env.STORAGE_PROVIDER === 'cloudbase-pg' || env.DATABASE_PROVIDER === 'cloudbase-http') &&
    !/^[a-z0-9][a-z0-9-]{4,99}$/.test(env.CLOUDBASE_ENV_ID)
  )
    throw Error('CLOUDBASE_ENV_ID is invalid');
  if (
    env.AI_PROVIDER === 'remote-worker' &&
    (!env.REMOTE_WORKER_TOKEN || env.REMOTE_WORKER_TOKEN.length < 32)
  )
    throw Error('REMOTE_WORKER_TOKEN is missing or too short');
  return true;
}
