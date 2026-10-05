import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PrismaClient, User } from '@prisma/client';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Config } from './config.js';
const scrypt = promisify(scryptCallback);
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
export const opaque = () => randomBytes(32).toString('base64url');
export const digest = (value: string, secret: string) =>
  createHmac('sha256', secret).update(value).digest('hex');
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, hash] = encoded.split(':');
  const derived = (await scrypt(password, salt || 'unregistered-user-salt', 64)) as Buffer;
  return !!hash && equal(derived.toString('hex'), hash);
}
export type Actor = Pick<User, 'id' | 'name' | 'role' | 'username'>;
declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
    sessionId: string;
    csrf: string;
  }
}
export const publicUser = (u: Actor) => ({
  id: u.id,
  name: u.name,
  role: u.role,
  username: u.username,
});
export async function issueSession(db: PrismaClient, config: Config, userId: string) {
  const token = opaque(),
    csrfToken = opaque();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await db.session.create({
    data: { id: digest(token, config.secret), userId, csrfToken, expiresAt },
  });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return { token, csrfToken, expiresAt };
}
export function setSession(reply: FastifyReply, token: string, config: Config) {
  reply.setCookie('shenlun_session', token, {
    httpOnly: true,
    secure: config.production,
    sameSite: 'strict',
    path: '/api',
    maxAge: 7 * 24 * 3600,
  });
}
export function auth(db: PrismaClient, config: Config, roles?: string[]) {
  return async (req: FastifyRequest) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined;
    const token = bearer || req.cookies.shenlun_session;
    if (!token) fail(401, '请先登录');
    const session = await db.session.findUnique({
      where: { id: digest(token!, config.secret) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || session.user.disabled)
      fail(401, '登录已失效，请重新登录');
    if (roles && !roles.includes(session!.user.role)) fail(403, '无权执行此操作');
    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        req.headers.origin !== config.appUrl ||
        !equal(String(req.headers['x-csrf-token'] || ''), session!.csrfToken)
      )
        fail(403, '请求校验失败，请刷新后重试');
    }
    req.actor = publicUser(session!.user);
    req.sessionId = session!.id;
    req.csrf = session!.csrfToken;
  };
}
export function teacherScope(user: Actor) {
  // One teaching team, as requested. Student endpoints still enforce ownership.
  if (!['ADMIN', 'TEACHER'].includes(user.role)) fail(403, '仅教师可访问教学数据');
  return {};
}
export const audit = (
  db: any,
  actorId: string | null,
  action: string,
  targetId?: string,
  detail = '',
) => db.auditLog.create({ data: { actorId, action, targetId, detail } });

export function loginLimit(config: Config) {
  return {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
        hook: 'preHandler' as const,
        keyGenerator: (req: FastifyRequest) => {
          const username = (req.body as { username?: unknown })?.username;
          return typeof username === 'string'
            ? digest(username.trim().toLowerCase().slice(0, 100), config.secret)
            : req.ip;
        },
      },
    },
  };
}
