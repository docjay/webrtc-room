/** Test-only adapter backed by SQLite's sql.js WASM engine; production uses D1. */
import initSqlJs, { type SqlValue } from 'sql.js';
import type { D1Database, D1Result, D1Statement } from '../src/server/db/types.js';
export async function sqliteD1(schema: string): Promise<D1Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys=ON');
  db.run(schema);
  return {
    prepare(query: string): D1Statement {
      let values: unknown[] = [];
      const execute = <T>(mode: 'all' | 'run') => {
        const statement = db.prepare(query);
        statement.bind(values.map((value) => value ?? null) as SqlValue[]);
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        const changes = db.getRowsModified();
        statement.free();
        return mode === 'all'
          ? { results: rows, success: true, meta: { changes } }
          : { results: [], success: true, meta: { changes } };
      };
      return {
        bind(...input: unknown[]) {
          values = input;
          return this;
        },
        first<T>() {
          return Promise.resolve(execute<T>('all').results[0] ?? null);
        },
        all<T>() {
          return Promise.resolve(execute<T>('all') as D1Result<T>);
        },
        run() {
          return Promise.resolve(execute('run'));
        },
      };
    },
    async batch(statements: D1Statement[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}
