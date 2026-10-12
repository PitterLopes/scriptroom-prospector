import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "drizzle");

export function resolveDatabasePath(url: string = process.env.DATABASE_URL ?? "./data/prospector.db"): string {
  if (url === ":memory:") return url;
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), url.replace(/^file:/, ""));
}

/** Opens (or creates) the SQLite file with the settings the project relies on: WAL, busy timeout, foreign keys. */
export function openDatabase(url?: string): { sqlite: Database.Database; db: Db } {
  const file = resolveDatabasePath(url);
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file, { timeout: 5000 });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { sqlite, db };
}

type Shared = { sqlite: Database.Database; db: Db };
const globalRef = globalThis as unknown as { __prospectorDb?: Shared };

/** Process-wide connection. Next.js hot reload keeps one handle through globalThis. */
export function getDb(): Db {
  if (!globalRef.__prospectorDb) globalRef.__prospectorDb = openDatabase();
  return globalRef.__prospectorDb.db;
}

export function getSqlite(): Database.Database {
  getDb();
  return globalRef.__prospectorDb!.sqlite;
}

/** Test helper: an isolated in-memory database with the real migrations applied. */
export function openTestDatabase(): Db {
  return openDatabase(":memory:").db;
}

export { schema };
