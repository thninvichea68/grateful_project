#!/usr/bin/env node
/**
 * pnpm db:snapshot — save the current database's data as the seed (apps/api/src/db/seed/data/snapshot.sql).
 * `pnpm db:seed` then restores this data instead of generating the demo dataset.
 *
 *   PG_BIN  folder containing pg_dump if it isn't on PATH (Windows default is detected)
 *
 * Data only (the schema comes from the migrations), one INSERT per row with column names so the
 * snapshot still loads after a migration adds a column with a default.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fail = (msg) => {
  console.error(`✖ Snapshot failed: ${msg}`);
  process.exit(1);
};

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) fail('DATABASE_URL is not set (run from the project folder: pnpm db:snapshot)');
const url = new URL(dbUrl);
const outFile = path.resolve('apps/api/src/db/seed/data/snapshot.sql');

function findPgDump() {
  const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, exe);
  if (process.platform === 'win32') {
    for (const v of [18, 17, 16, 15]) {
      const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\pg_dump.exe`;
      if (fs.existsSync(p)) return p;
    }
  }
  return exe; // rely on PATH
}

const res = spawnSync(
  findPgDump(),
  [
    '--data-only',
    '--column-inserts',
    '--rows-per-insert=200',
    '--schema=public',
    '--no-owner',
    '--no-privileges',
    `--host=${url.hostname}`,
    `--port=${url.port || 5432}`,
    `--username=${decodeURIComponent(url.username)}`,
    url.pathname.slice(1),
  ],
  {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
if (res.error)
  fail(`could not run pg_dump (${res.error.message}). Set PG_BIN to PostgreSQL's bin folder.`);
if (res.status !== 0) fail(`pg_dump exited with code ${res.status}`);

// The seed runs this through node-postgres, not psql: drop psql meta-commands (\restrict …) and comments,
// settings older servers reject (transaction_timeout is PostgreSQL 17+; Docker runs 16), and the empty
// search_path (the inserts name public.* already, but the cut-stock triggers' functions don't).
const sqlText = res.stdout
  .split(/\r?\n/)
  .filter(
    (line) =>
      !line.startsWith('\\') &&
      !line.startsWith('--') &&
      !line.startsWith('SET transaction_timeout') &&
      !line.startsWith("SELECT pg_catalog.set_config('search_path'"),
  )
  .join('\n')
  .replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(outFile, sqlText);

const tables = (sqlText.match(/^INSERT INTO /gm) ?? []).length;
console.log(
  `✔ Snapshot saved: ${path.relative(process.cwd(), outFile)} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB, ${tables} insert statement(s))`,
);
