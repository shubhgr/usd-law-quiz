import "server-only";

import { Pool } from "pg";

let pool: Pool | null = null;

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  pool = new Pool({
    connectionString,
    // Neon (and most hosted PGs) already expects SSL via the URL.
    // Keep defaults for compatibility.
  });

  return pool;
}

export async function query<T = unknown>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = getPool();
  const res = await client.query(sql, params);
  return res.rows as T[];
}

