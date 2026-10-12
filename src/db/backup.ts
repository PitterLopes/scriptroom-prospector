import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { resolveDatabasePath } from "./client";

/** Consistent online backup through SQLite's backup API (safe while the app is running). */
export async function backupDatabase(options: { databaseUrl?: string; backupDir?: string; now?: Date } = {}): Promise<string> {
  const source = resolveDatabasePath(options.databaseUrl);
  const dir = path.resolve(process.cwd(), options.backupDir ?? process.env.BACKUP_DIR ?? "./backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const target = path.join(dir, `prospector-${stamp}.db`);
  const sqlite = new Database(source, { readonly: true, timeout: 5000 });
  try {
    await sqlite.backup(target);
  } finally {
    sqlite.close();
  }
  pruneOldBackups(dir, 30);
  return target;
}

function pruneOldBackups(dir: string, keep: number): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("prospector-") && f.endsWith(".db"))
    .sort();
  for (const file of files.slice(0, Math.max(files.length - keep, 0))) {
    fs.unlinkSync(path.join(dir, file));
  }
}

if (process.argv[1] && process.argv[1].endsWith("backup.ts")) {
  backupDatabase()
    .then((target) => process.stdout.write(`Backup written to ${target}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`Backup failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
