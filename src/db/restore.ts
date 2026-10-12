import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { resolveDatabasePath } from "./client";

/**
 * Restores a backup over the live database file. Stop the panel and the worker first.
 * The current file is kept next to it as `.before-restore` so the operation is reversible.
 */
export function restoreDatabase(backupFile: string, databaseUrl?: string): { restored: string; previous: string | null } {
  const source = path.resolve(process.cwd(), backupFile);
  if (!fs.existsSync(source)) throw new Error(`Backup not found: ${source}`);
  const check = new Database(source, { readonly: true });
  try {
    const result = check.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error(`Backup failed integrity check: ${String(result)}`);
  } finally {
    check.close();
  }
  const target = resolveDatabasePath(databaseUrl);
  let previous: string | null = null;
  if (fs.existsSync(target)) {
    previous = `${target}.before-restore`;
    fs.copyFileSync(target, previous);
  }
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(target + suffix)) fs.unlinkSync(target + suffix);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return { restored: target, previous };
}

if (process.argv[1] && process.argv[1].endsWith("restore.ts")) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write("Usage: npm run db:restore -- backups/prospector-<stamp>.db\n");
    process.exit(2);
  }
  try {
    const { restored, previous } = restoreDatabase(file);
    process.stdout.write(`Restored ${restored}${previous ? ` (previous copy: ${previous})` : ""}\n`);
  } catch (error: unknown) {
    process.stderr.write(`Restore failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
