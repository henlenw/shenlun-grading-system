import type { FastifyInstance } from 'fastify';
import { loginLimit } from './security.js';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import {
  auth,
  audit,
  digest,
  equal,
  fail,
  hashPassword,
  issueSession,
  opaque,
  publicUser,
  setSession,
  verifyPassword,
} from './security.js';
export interface WechatGateway {
  exchange(code: string): Promise<string>;
}
export class WechatApi implements WechatGateway {
  constructor(private config: Config) {}
  async exchange(code: string) {
    if (!this.config.wechatAppId || !this.config.wechatSecret)
      fail(503, '微信登录尚未配置，请联系老师');
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({
      appid: this.config.wechatAppId,
      secret: this.config.wechatSecret,
      js_code: code,
      grant_type: 'authorization_code',
    }).toString();
    let data: any;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error();
      data = await response.json();
    } catch {
      fail(502, '微信服务暂时无法连接，请重试');
    }
    if (data.errcode || typeof data.openid !== 'string' || !data.openid)
      fail(401, '微信凭证已失效，请重新登录');
    return data.openid as string;
  }
}
const credentials = z.object({
  username: z.string().trim().min(3).max(100),
  password: z.string().min(10).max(128),
});
export function registerAuth(
  app: FastifyInstance,
  db: PrismaClient,
  c: Config,
  wechat: WechatGateway,
) {
  const limited = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };
  app.get('/api/auth/setup', async () => ({
    needsSetup: !(await db.user.findFirst({ where: { role: 'ADMIN' } })),
  }));
  app.post('/api/auth/setup', limited, async (req, reply) => {
    const body = credentials
      .extend({ name: z.string().trim().min(1).max(80), bootstrapToken: z.string() })
      .parse(req.body);
    if (c.bootstrapToken.length < 32 || !equal(body.bootstrapToken, c.bootstrapToken))
      fail(403, '初始化密钥不正确');
    if (await db.user.findFirst({ where: { role: 'ADMIN' } })) fail(409, '系统已初始化');
    const passwordHash = await hashPassword(body.password);
    const user = await db.$transaction(async (tx) => {
      await tx.systemSetting.create({ data: { id: 'initialized', value: 'true' } });
      const user = await tx.user.create({
        data: {
          username: body.username.toLowerCase(),
          name: body.name,
          role: 'ADMIN',
          passwordHash,
          teacher: { create: {} },
        },
      });
      await audit(tx, user.id, 'create_user', user.id);
      return user;
    });
    const session = await issueSession(db, c, user.id);
    setSession(reply, session.token, c);
    return { user: publicUser(user), csrfToken: session.csrfToken };
  });
  app.post('/api/auth/login', loginLimit(c), async (req, reply) => {
    const body = credentials.parse(req.body);
    const user = await db.user.findUnique({ where: { username: body.username.toLowerCase() } });
    const valid = await verifyPassword(body.password, user?.passwordHash || '');
    if (!valid || !user || user.disabled || !['ADMIN', 'TEACHER'].includes(user.role))
      fail(401, '账号或密码不正确');
    const session = await issueSession(db, c, user!.id);
    setSession(reply, session.token, c);
    await audit(db, user!.id, 'login', user!.id);
    return { user: publicUser(user!), csrfToken: session.csrfToken };
  });
  app.get('/api/auth/me', { preHandler: auth(db, c) }, async (req) => ({
    user: req.actor,
    csrfToken: req.csrf,
  }));
  app.post('/api/auth/logout', { preHandler: auth(db, c) }, async (req, reply) => {
    await db.session.deleteMany({ where: { id: req.sessionId } });
    await audit(db, req.actor.id, 'logout');
    reply.clearCookie('shenlun_session', { path: '/api' });
    return { ok: true };
  });
  app.post('/api/auth/wechat', limited, async (req) => {
    const { code } = z.object({ code: z.string().min(1).max(256) }).parse(req.body);
    const openid = await wechat.exchange(code);
    const identity = await db.wechatIdentity.findUnique({
      where: { openid },
      include: { user: true },
    });
    if (identity) {
      if (identity.user.disabled) fail(403, '账号已停用，请联系老师');
      const s = await issueSession(db, c, identity.userId);
      await audit(db, identity.userId, 'login');
      return {
        needsBinding: false,
        token: s.token,
        expiresAt: s.expiresAt,
        user: publicUser(identity.user),
      };
    }
    const ticket = opaque();
    await db.bindingTicket.create({
      data: { id: digest(ticket, c.secret), openid, expiresAt: new Date(Date.now() + 5 * 60000) },
    });
    return { needsBinding: true, bindToken: ticket };
  });
  app.post('/api/auth/wechat/bind', limited, async (req) => {
    const body = z
      .object({ bindToken: z.string().min(20).max(100), bindingCode: z.string().regex(/^\d{6}$/) })
      .parse(req.body);
    const ticketId = digest(body.bindToken, c.secret);
    const ticket = await db.bindingTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.expiresAt < new Date() || ticket.attempts >= 5)
      fail(401, '绑定请求已失效，请重新微信登录');
    // Persist failed attempts as well; a rolled back transaction must not reset this counter.
    const counted = await db.bindingTicket.updateMany({
      where: { id: ticketId, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
    if (!counted.count) fail(429, '尝试次数过多，请重新登录');
    const profile = await db.studentProfile.findUnique({
      where: { bindingHash: digest(body.bindingCode, c.secret) },
      include: { user: true },
    });
    if (
      !profile ||
      !profile.bindingExpiresAt ||
      profile.bindingExpiresAt < new Date() ||
      profile.user.disabled
    )
      fail(400, '绑定码无效或过期，请联系老师');
    await db.$transaction(async (tx) => {
      await tx.wechatIdentity.create({ data: { openid: ticket!.openid, userId: profile!.userId } });
      await tx.studentProfile.update({
        where: { id: profile!.id },
        data: { bindingHash: null, bindingExpiresAt: null },
      });
      await tx.bindingTicket.deleteMany({ where: { openid: ticket!.openid } });
      await audit(tx, profile!.userId, 'bind_wechat', profile!.userId);
    });
    const session = await issueSession(db, c, profile!.userId);
    return { token: session.token, expiresAt: session.expiresAt, user: publicUser(profile!.user) };
  });
}
