import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CloudbasePgAdapter, bindSql } from '../src/cloudbase-db.js';
import { fixtureDatabase } from './database-fixture.js';

test('SQL parameters cannot escape literals or replace quoted placeholders', () => {
  const sql = bindSql({
    sql: `SELECT $1, '$1', "$2", $$ $2 $$, $tag$ $1 $tag$, $2 -- $1`,
    args: ["中文'; DROP TABLE User; --\\", 3],
  });
  assert.equal(
    sql,
    `SELECT E'中文''; DROP TABLE User; --\\\\', '$1', "$2", $$ $2 $$, $tag$ $1 $tag$, 3 -- $1`,
  );
  assert.throws(() => bindSql({ sql: 'SELECT $2', args: [1] }));
  assert.throws(() => bindSql({ sql: 'SELECT $1', args: [Infinity] }));
});

test(
  'transaction protocol rolls back previews, detects concurrent changes and retries a lost commit response exactly once',
  { skip: !process.env.CLOUDBASE_TEST_SCHEMA },
  async () => {
    const db = await fixtureDatabase('unused');
    const schema = process.env.CLOUDBASE_TEST_SCHEMA!;
    const envId = process.env.CLOUDBASE_ENV_ID!;
    const key = process.env.CLOUDBASE_API_KEY!;
    const adapter = await new CloudbasePgAdapter(envId, key, fetch, schema).connect();
    const id = 'tx-' + randomUUID();
    await db.systemSetting.create({ data: { id, value: 'before' } });
    const statement = (value: string) => ({
      sql: `UPDATE "${schema}"."SystemSetting" SET "value" = $1 WHERE id = $2 RETURNING "value"`,
      args: [value, id],
      argTypes: [],
    });
    try {
      const cancelled = await adapter.startTransaction();
      await cancelled.queryRaw(statement('preview'));
      assert.equal((await db.systemSetting.findUniqueOrThrow({ where: { id } })).value, 'before');
      await cancelled.rollback();
      assert.equal((await db.systemSetting.findUniqueOrThrow({ where: { id } })).value, 'before');

      const conflict = await adapter.startTransaction();
      await conflict.queryRaw({
        sql: `SELECT value FROM "${schema}"."SystemSetting" WHERE id=$1`,
        args: [id],
        argTypes: [],
      });
      await db.systemSetting.update({ where: { id }, data: { value: 'concurrent' } });
      await assert.rejects(conflict.queryRaw(statement('must-not-commit')), { code: 'P2034' });
      await conflict.rollback();
      assert.equal(
        (await db.systemSetting.findUniqueOrThrow({ where: { id } })).value,
        'concurrent',
      );

      let lost = false,
        commits = 0;
      const dropResponse: typeof fetch = async (input, init) => {
        const body = JSON.parse(init!.body as string);
        const response = await fetch(input, init);
        if (body.p_commit) {
          commits++;
          if (!lost && response.ok) {
            lost = true;
            await response.text();
            throw new TypeError('simulated lost response');
          }
        }
        return response;
      };
      const unreliable = await new CloudbasePgAdapter(envId, key, dropResponse, schema).connect();
      await unreliable.queryRaw({
        sql: `UPDATE "${schema}"."SystemSetting" SET value = value || '-once' WHERE id=$1 RETURNING value`,
        args: [id],
        argTypes: [],
      });
      assert.equal(commits, 2);
      assert.equal(
        (await db.systemSetting.findUniqueOrThrow({ where: { id } })).value,
        'concurrent-once',
      );

      // A later error aborts every earlier write in the final database transaction.
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.systemSetting.update({ where: { id }, data: { value: 'aborted' } });
          await tx.systemSetting.create({ data: { id, value: 'duplicate' } });
        }),
      );
      assert.equal(
        (await db.systemSetting.findUniqueOrThrow({ where: { id } })).value,
        'concurrent-once',
      );

      const privateUrl = `https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/kaoba_sql_transaction`;
      const anonymous = await fetch(privateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_steps: [{ sql: 'SELECT 1', mode: 'rows' }],
          p_commit: true,
          p_id: randomUUID(),
        }),
      });
      assert.notEqual(anonymous.status, 200);
      console.log(
        'Cloud checks: preview isolation, rollback, conflict, idempotent retry, anonymous RPC denial passed.',
      );
    } finally {
      await db.systemSetting.deleteMany({ where: { id } });
      await db.$disconnect();
    }
  },
);
