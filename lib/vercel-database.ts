import 'server-only';
import { createClient, type InValue } from '@libsql/client';

type Statement = D1PreparedStatement & { sql: string; args: InValue[] };
let client: ReturnType<typeof createClient> | undefined;

function getClient() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error('TURSO_DATABASE_URL is required for workspace storage.');
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN ?? process.env.TURSO_DATABASE_AUTH_TOKEN });
  }
  return client;
}

function prepare(sql: string, args: InValue[] = []): Statement {
  return {
    sql,
    args,
    bind(...values: unknown[]) { return prepare(sql, values as InValue[]); },
    async first<T>() {
      const result = await getClient().execute({ sql, args });
      return (result.rows[0] as T | undefined) ?? null;
    },
    async all<T>() {
      const result = await getClient().execute({ sql, args });
      return { success: true, results: result.rows as T[] };
    },
    async run() {
      const result = await getClient().execute({ sql, args });
      return { success: true, results: result.rows, meta: { changes: result.rowsAffected } };
    },
  } as unknown as Statement;
}

export const database = {
  prepare,
  async batch(statements: D1PreparedStatement[]) {
    const queries = statements.map(statement => {
      const item = statement as Statement;
      return { sql: item.sql, args: item.args };
    });
    return getClient().batch(queries, 'write');
  },
} as unknown as D1Database;
