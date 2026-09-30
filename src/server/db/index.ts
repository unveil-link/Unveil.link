import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config } from "../config";

const g = globalThis as unknown as { __unveilPool?: Pool };

export function pool(): Pool {
  if (!g.__unveilPool) {
    g.__unveilPool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  }
  return g.__unveilPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pool().query<T>(text, params)).rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  return (await query<T>(text, params))[0] ?? null;
}

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
