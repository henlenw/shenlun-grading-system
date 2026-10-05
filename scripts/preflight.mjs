import path from 'node:path';
try { process.loadEnvFile(path.resolve('.env')); } catch { console.error('缺少 .env'); process.exit(1); }
for(const [label,ok] of [
 ['会话密钥',(process.env.SESSION_SECRET||'').length>=32],
 ['初始化密钥',(process.env.BOOTSTRAP_TOKEN||'').length>=32],
 ['HTTPS 网站地址',process.env.APP_URL?.startsWith('https://')],
 ['人工或本地模型模式',['manual','disabled','ollama','remote-worker'].includes(process.env.AI_PROVIDER||'manual')],
]) console.log((ok?'OK':'待配置')+' '+label);
console.log('当前仅维护手机网站与教师后台；无需微信 AppID。');
