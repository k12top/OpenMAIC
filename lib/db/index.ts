import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const { Pool } = pg;

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _pool: InstanceType<typeof Pool> | null = null;

function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL;
}

export function getDb() {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error(
      'DATABASE_URL is not configured. PostgreSQL is required for this feature.',
    );
  }

  if (!_db) {
    _pool = new Pool({ connectionString: url });
    _db = drizzle(_pool, { schema });
  }

  return _db;
}

export function isDbConfigured(): boolean {
  return !!getDatabaseUrl();
}

export async function closeDb() {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

export { schema };
