import { randomUUID } from 'node:crypto';
import type { SqlDriverAdapterFactory } from '@prisma/client/runtime/client';

type Driver = Awaited<ReturnType<SqlDriverAdapterFactory['connect']>>;
type Query = Parameters<Driver['queryRaw']>[0];
type Result = Awaited<ReturnType<Driver['queryRaw']>>;
type Step = { sql: string; mode: 'rows' | 'count'; expected?: string };
type Reply = { result: Result | number; digest: string };

/** Only the server calls this RPC. SQL is produced by Prisma, never accepted from an HTTP client.
 * Interactive transactions preview their SQL in rolled-back PG subtransactions. Commit replays
 * the entire plan under one database lock, checking every observed result before committing.
 * This preserves read-your-writes and detects phantoms as well as changed/deleted rows.
 */
export class CloudbaseDatabaseError extends Error {
  constructor(public code: string) {
    super('Cloud database request failed (' + code + ')');
    this.name = 'CloudbaseDatabaseError';
  }
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('Non-finite SQL parameter');
    return String(value);
  }
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) value = value.toISOString();
  if (value instanceof Uint8Array)
    return "decode('" + Buffer.from(value).toString('hex') + "','hex')";
  if (Array.isArray(value)) return 'ARRAY[' + value.map(literal).join(',') + ']';
  if (typeof value !== 'string') throw Error('Unsupported SQL parameter');
  if (value.includes('\0')) throw Error('NUL is not a valid PostgreSQL text character');
  // Explicit E quoting is independent of the connection's standard_conforming_strings setting.
  return "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
}

/** Replace only unquoted positional parameters; quoted SQL, identifiers and comments are opaque. */
export function bindSql(query: Pick<Query, 'sql' | 'args'>): string {
  const token =
    /[eE]'(?:''|\\.|[^'\\])*'|'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\/|\$([A-Za-z_][A-Za-z_0-9]*|)\$[\s\S]*?\$\1\$|\$(\d+)/g;
  return query.sql.replace(token, (match, _tag, position) => {
    if (position === undefined) return match;
    const index = Number(position) - 1;
    if (index < 0 || index >= query.args.length) throw Error('SQL parameter index out of range');
    return literal(query.args[index]);
  });
}

export class CloudbasePgAdapter implements SqlDriverAdapterFactory {
  readonly provider = 'postgres' as const;
  readonly adapterName = 'kaoba167/cloudbase-pg-http';
  private readonly url: string;
  constructor(
    envId: string,
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
    private readonly schema = 'public',
  ) {
    if (!/^[a-z0-9][a-z0-9-]{4,99}$/.test(envId) || !apiKey)
      throw Error('CloudBase database configuration is missing or invalid');
    if (schema !== 'public' && !/^kaoba_test_[a-f0-9]{32}$/.test(schema))
      throw Error('Invalid isolated test schema');
    this.url = `https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/kaoba_sql_transaction`;
  }

  private async run(steps: Step[], commit: boolean, id: string): Promise<Reply> {
    const body = JSON.stringify({ p_steps: steps, p_commit: commit, p_id: id });
    if (Buffer.byteLength(body) > 8 * 1024 * 1024 || steps.length > 1000)
      throw new CloudbaseDatabaseError('TRANSACTION_TOO_LARGE');
    // A retry uses the same id and byte-identical body. The database stores committed receipts,
    // so a dropped response can never increment a redemption counter or publish a grade twice.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.request(this.url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(45000),
          headers: { Authorization: 'Bearer ' + this.apiKey, 'Content-Type': 'application/json' },
          body,
        });
        const result = (await response.json()) as any;
        if (!response.ok) {
          const code =
            typeof result?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(result.code)
              ? result.code.replace(/^DATABASE_/, '')
              : 'HTTP_' + response.status;
          throw new CloudbaseDatabaseError(
            ({ '23505': 'P2002', '40001': 'P2034', '23503': 'P2003' } as Record<string, string>)[
              code
            ] || code,
          );
        }
        if (!result || typeof result.digest !== 'string' || !('result' in result))
          throw new CloudbaseDatabaseError('INVALID_RESPONSE');
        return result;
      } catch (error) {
        if (error instanceof CloudbaseDatabaseError || attempt === 2) {
          if (error instanceof CloudbaseDatabaseError) throw error;
          throw new CloudbaseDatabaseError('NETWORK');
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    throw new CloudbaseDatabaseError('NETWORK');
  }

  async connect(): Promise<Driver> {
    const info = { provider: this.provider, adapterName: this.adapterName };
    const single = async (query: Query, mode: Step['mode']) => {
      const sql = bindSql(query);
      const reply = await this.run([{ sql, mode }], !/^\s*SELECT\b/i.test(sql), randomUUID());
      return reply.result;
    };
    return {
      ...info,
      queryRaw: async (query) => (await single(query, 'rows')) as Result,
      executeRaw: async (query) => (await single(query, 'count')) as number,
      executeScript: async () => {
        throw Error('Use the versioned CloudBase migration script');
      },
      getConnectionInfo: () => ({ schemaName: this.schema, supportsRelationJoins: false }),
      dispose: async () => {},
      startTransaction: async () => {
        const steps: Step[] = [];
        const id = randomUUID();
        let ended = false;
        let pending = Promise.resolve();
        const query = (q: Query, mode: Step['mode']) => {
          // Prisma can dispatch independent relation reads concurrently. Serialize their plan
          // construction so expected results always refer to a complete ordered SQL prefix.
          const next = pending.then(async () => {
            if (ended) throw new CloudbaseDatabaseError('TRANSACTION_CLOSED');
            const step: Step = { sql: bindSql(q), mode };
            steps.push(step);
            const reply = await this.run(steps, false, id);
            step.expected = reply.digest;
            return reply.result;
          });
          pending = next.then(() => {});
          void pending.catch(() => {});
          return next;
        };
        return {
          ...info,
          options: { usePhantomQuery: true },
          queryRaw: async (q) => (await query(q, 'rows')) as Result,
          executeRaw: async (q) => (await query(q, 'count')) as number,
          commit: async () => {
            await pending;
            if (ended) throw new CloudbaseDatabaseError('TRANSACTION_CLOSED');
            ended = true;
            if (steps.length) await this.run(steps, true, id);
          },
          rollback: async () => {
            ended = true;
          },
        };
      },
    };
  }
}
