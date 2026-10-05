import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/db (tsx) and from dist (bundled): look for the drizzle folder upwards.
const candidates = [
  path.resolve(here, '../../drizzle'),
  path.resolve(here, '../drizzle'),
  path.resolve(process.cwd(), 'drizzle'),
];

async function main() {
  const fs = await import('node:fs');
  const migrationsFolder = candidates.find((p) =>
    fs.existsSync(path.join(p, 'meta', '_journal.json')),
  );
  if (!migrationsFolder)
    throw new Error(`Migrations folder not found (looked in ${candidates.join(', ')})`);
  await migrate(db, { migrationsFolder });
  // eslint-disable-next-line no-console
  console.log(`✔ Migrations applied from ${migrationsFolder}`);
  await pool.end();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  await pool.end();
  process.exit(1);
});
