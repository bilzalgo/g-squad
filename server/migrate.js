import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getPool } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(here, '../db/migrations');
const migrations = (await readdir(migrationDirectory))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
  .sort();
const pool = getPool();

try {
  for (const name of migrations) {
    await pool.query(await readFile(resolve(migrationDirectory, name), 'utf8'));
    console.log(`Database migration ${name} applied.`);
  }
} finally {
  await pool.end();
}
