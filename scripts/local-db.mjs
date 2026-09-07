import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import initSqlJs from 'sql.js';

const databasePath = new URL('../.local-data/webrtc-room.sqlite', import.meta.url);
const migrationDirectory = new URL('../src/server/migrations/', import.meta.url);
export async function resetLocalDatabase() {
  await rm(databasePath, { force: true });
}
export async function localD1() {
  const SQL = await initSqlJs();
  let bytes;
  try {
    bytes = await readFile(databasePath);
  } catch {
    bytes = undefined;
  }
  const db = new SQL.Database(bytes);
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const migration of migrations) {
    const version = Number(migration.slice(0, migration.indexOf('_')));
    let applied = false;
    try {
      applied = Boolean(
        db.exec(`SELECT version FROM schema_migrations WHERE version=${version}`)[0]?.values.length,
      );
    } catch {
      // The initial migration creates the migration inventory.
    }
    if (!applied) db.run(await readFile(new URL(migration, migrationDirectory), 'utf8'));
  }
  const save = async () => {
    await mkdir(dirname(databasePath.pathname), { recursive: true });
    await writeFile(databasePath, db.export());
  };
  const statement = (query) => {
    let values = [];
    const execute = async (mode) => {
      const prepared = db.prepare(query);
      prepared.bind(values.map((value) => value ?? null));
      const results = [];
      while (prepared.step()) results.push(prepared.getAsObject());
      const changes = db.getRowsModified();
      prepared.free();
      if (mode === 'run') await save();
      return { results: mode === 'all' ? results : [], success: true, meta: { changes } };
    };
    return {
      bind(...input) {
        values = input;
        return this;
      },
      first() {
        return execute('all').then((value) => value.results[0] ?? null);
      },
      all() {
        return execute('all');
      },
      run() {
        return execute('run');
      },
    };
  };
  return {
    prepare: statement,
    async batch(statements) {
      return Promise.all(statements.map((item) => item.run()));
    },
  };
}
