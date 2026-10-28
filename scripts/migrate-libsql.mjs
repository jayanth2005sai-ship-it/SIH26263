import { createClient } from '@libsql/client';
import nextEnv from '@next/env';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('Set TURSO_DATABASE_URL before applying migrations.');
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN ?? process.env.TURSO_DATABASE_AUTH_TOKEN });
const migrationDirectory = fileURLToPath(new URL('../drizzle/', import.meta.url));
await db.execute('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)');
for (const name of readdirSync(migrationDirectory).filter(value => /^\d{4}_.*\.sql$/.test(value)).sort()) {
  const applied = await db.execute({ sql: 'SELECT 1 FROM schema_migrations WHERE name = ?', args: [name] });
  if (applied.rows.length) continue;
  const source = readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8');
  const statements = source.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean);
  const transaction = await db.transaction('write');
  try {
    for (const sql of statements) await transaction.execute(sql);
    await transaction.execute({ sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', args: [name, new Date().toISOString()] });
    await transaction.commit();
    console.log(`Applied ${name}`);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
db.close();
