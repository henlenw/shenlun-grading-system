import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import {
  auth,
  audit,
  digest,
  fail,
  hashPassword,
  issueSession,
  publicUser,
  setSession,
  verifyPassword,
  loginLimit,
} from './security.js';
const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9_.@-]+$/, '账号请使用字母、数字或 . _ @ -'),
  password: z.string().min(10).max(128),
});
export function registerStudentAuth(app: FastifyInstance, db: PrismaClient, c: Config) {
  const limited = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };
  app.post('/api/auth/student/login', loginLimit(c), async (req, reply) => {
    const b = credentials.parse(req.body);
    const u = await db.user.findUnique({ where: { username: b.username.toLowerCase() } });
    if (
      !(await verifyPassword(b.password, u?.passwordHash || '')) ||
      !u ||
      u.role !== 'STUDENT' ||
      u.disabled
    )
      fail(401, '账号或密码不正确');
    const s = await issueSession(db, c, u!.id);
    setSession(reply, s.token, c);
    await audit(db, u!.id, 'student_web_login', u!.id);
    return { user: publicUser(u!), csrfToken: s.csrfToken };
  });
  app.post('/api/auth/student/activate', limited, async (req, reply) => {
    const b = credentials.extend({ bindingCode: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const bindingHash = digest(b.bindingCode, c.secret);
    const hash = await hashPassword(b.password);
    const u = await db.$transaction(async (tx) => {
      const p = await tx.studentProfile.findUnique({
        where: { bindingHash },
        include: { user: true },
      });
      if (
        !p ||
        !p.bindingExpiresAt ||
        p.bindingExpiresAt < new Date() ||
        p.user.disabled ||
        p.user.passwordHash
      )
        fail(400, '激活码无效、过期或账号已激活，请联系老师');
      const consumed = await tx.studentProfile.updateMany({
        where: { id: p!.id, bindingHash },
        data: { bindingHash: null, bindingExpiresAt: null },
      });
      if (!consumed.count) fail(409, '激活码已使用');
      const user = await tx.user.update({
        where: { id: p!.userId },
        data: { username: b.username.toLowerCase(), passwordHash: hash },
      });
      await audit(tx, user.id, 'activate_web_account', user.id);
      return user;
    });
    const s = await issueSession(db, c, u.id);
    setSession(reply, s.token, c);
    return { user: publicUser(u), csrfToken: s.csrfToken };
  });
  app.get('/api/student/account', { preHandler: auth(db, c, ['STUDENT']) }, async (req) => {
    const u = await db.user.findUniqueOrThrow({
      where: { id: req.actor.id },
      include: { identity: true },
    });
    return { username: u.username, webReady: !!u.passwordHash, wechatLinked: !!u.identity };
  });
  app.put(
    '/api/student/account',
    { preHandler: auth(db, c, ['STUDENT']), ...limited },
    async (req) => {
      const b = credentials
        .extend({ currentPassword: z.string().max(128).optional() })
        .parse(req.body);
      const u = await db.user.findUniqueOrThrow({ where: { id: req.actor.id } });
      if (u.passwordHash && !(await verifyPassword(b.currentPassword || '', u.passwordHash)))
        fail(400, '原密码不正确');
      const hash = await hashPassword(b.password);
      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: u.id },
          data: { username: b.username.toLowerCase(), passwordHash: hash },
        });
        await tx.session.deleteMany({ where: { userId: u.id, id: { not: req.sessionId } } });
        await audit(tx, u.id, 'update_web_account', u.id);
      });
      return { ok: true };
    },
  );
  // A WeChat login ticket plus the existing web credentials link exactly one User; no new student is created.
  app.post('/api/auth/wechat/link', limited, async (req) => {
    const b = credentials.extend({ bindToken: z.string().min(20).max(100) }).parse(req.body);
    const id = digest(b.bindToken, c.secret);
    const ticket = await db.bindingTicket.findUnique({ where: { id } });
    if (!ticket || ticket.expiresAt < new Date() || ticket.attempts >= 5)
      fail(401, '微信请求已失效，请重新微信登录');
    const count = await db.bindingTicket.updateMany({
      where: { id, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
    if (!count.count) fail(429, '尝试次数过多');
    const u = await db.user.findUnique({ where: { username: b.username.toLowerCase() } });
    if (
      !(await verifyPassword(b.password, u?.passwordHash || '')) ||
      !u ||
      u.disabled ||
      u.role !== 'STUDENT'
    )
      fail(401, '账号或密码不正确');
    await db.$transaction(async (tx) => {
      if (await tx.wechatIdentity.findUnique({ where: { userId: u!.id } }))
        fail(409, '此学生账号已绑定微信，请使用原微信登录');
      await tx.wechatIdentity.create({ data: { openid: ticket!.openid, userId: u!.id } });
      await tx.bindingTicket.deleteMany({ where: { openid: ticket!.openid } });
      await audit(tx, u!.id, 'link_existing_web_account', u!.id);
    });
    const s = await issueSession(db, c, u!.id);
    return { token: s.token, expiresAt: s.expiresAt, user: publicUser(u!) };
  });
}
