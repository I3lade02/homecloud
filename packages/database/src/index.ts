import { performance } from "node:perf_hooks";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import { Pool } from "pg";

import * as schema from "./schema";

export * from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: Pool;
}

export function createDatabase(connectionString: string): DatabaseConnection {
  const pool = new Pool({
    connectionString,
  });

  const db = drizzle(pool, {
    schema,
  });

  return {
    db,
    pool,
  };
}

export async function checkDatabase(pool: Pool): Promise<number> {
  const startedAt = performance.now();

  await pool.query("select 1");

  return Math.round(performance.now() - startedAt);
}
