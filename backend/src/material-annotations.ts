import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import { auth, fail } from './security.js';
import { idParam } from './schemas.js';
import { requireAttemptPermission } from './training.js';
import { materialText } from './material-text.js';
export const marksSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(100),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      type: z.enum(['underline', 'highlight', 'strike', 'circle']),
      selectedText: z.string().min(1).max(10000),
    }),
  )
  .max(100);
export function registerMaterialAnnotations(app: FastifyInstance, db: PrismaClient, c: Config) {
  app.put(
    '/api/student/attempts/:id/material-annotations',
    { preHandler: auth(db, c, ['STUDENT']) },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({ version: z.number().int().nonnegative(), annotations: marksSchema })
        .parse(req.body);
      return db.$transaction(async (tx) => {
        const a = await requireAttemptPermission(tx, id, req.actor.id);
        if (a.status !== 'DRAFT') fail(409, '本轮已提交，材料勾画已保留，不能修改');
        const { text } = materialText(JSON.parse(a.questionSnapshot).materials || '');
        if (
          new Set(body.annotations.map((m) => m.id)).size !== body.annotations.length ||
          body.annotations.some(
            (m) =>
              m.end <= m.start ||
              m.end > text.length ||
              text.slice(m.start, m.end) !== m.selectedText,
          )
        )
          fail(400, '勾画与本轮材料不一致，请重新载入材料');
        const updated = await tx.submissionAttempt.updateMany({
          where: { id, studentId: req.actor.id, status: 'DRAFT', annotationsVersion: body.version },
          data: {
            studentAnnotations: JSON.stringify(body.annotations),
            annotationsVersion: { increment: 1 },
          },
        });
        if (!updated.count) fail(409, '材料勾画已在其他设备更新，请重新载入后选择要保留的内容');
        return { annotations: body.annotations, version: body.version + 1 };
      });
    },
  );
}
