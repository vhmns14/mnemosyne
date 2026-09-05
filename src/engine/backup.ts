import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { CONFIG } from "../config.ts";

export interface BackupRecord {
  path: string;
  filename: string;
  sizeBytes: number;
  createdAt: number;
}

export interface BackupResult {
  success: boolean;
  backupPath: string;
  sizeBytes: number;
  timestamp: number;
  message?: string;
}

export function getDefaultBackupDir(customDbPath?: string): string {
  const activePath = customDbPath || CONFIG.DB_PATH;
  const dbDir = dirname(resolve(activePath));
  const dir = join(dbDir, "backups");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Fallback
    }
  }
  return dir;
}

/**
 * Creates an atomic, hot online backup of the SQLite database using native VACUUM INTO.
 * Does not block readers or writers and produces a clean, defragmented .db file.
 */
export function createBackup(db: Database, targetDir?: string): BackupResult {
  if (targetDir && targetDir.includes("\0")) {
    return {
      success: false,
      backupPath: "",
      sizeBytes: 0,
      timestamp: Date.now(),
      message: "Invalid target directory: null bytes detected",
    };
  }

  const dir = targetDir ? resolve(targetDir) : getDefaultBackupDir(db.filename);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = `mnemosyne-backup-${timestamp}.db`;
  const backupPath = join(dir, filename);

  try {
    // Native SQLite atomic snapshot with escaped path literal
    const escapedPath = backupPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedPath}'`);

    const stats = statSync(backupPath);
    return {
      success: true,
      backupPath,
      sizeBytes: stats.size,
      timestamp,
      message: `Successfully created atomic backup at ${backupPath} (${(stats.size / 1024).toFixed(1)} KB)`,
    };
  } catch (err: any) {
    return {
      success: false,
      backupPath,
      sizeBytes: 0,
      timestamp,
      message: `Backup failed: ${err.message}`,
    };
  }
}

/**
 * Lists all existing backups in the backup directory, sorted from newest to oldest.
 */
export function listBackups(targetDir?: string, customDbPath?: string): BackupRecord[] {
  const dir = targetDir ? resolve(targetDir) : getDefaultBackupDir(customDbPath);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".db") && f.startsWith("mnemosyne-backup-"));
  const records: BackupRecord[] = [];

  for (const file of files) {
    const fullPath = join(dir, file);
    try {
      const stats = statSync(fullPath);
      records.push({
        path: fullPath,
        filename: file,
        sizeBytes: stats.size,
        createdAt: stats.mtimeMs,
      });
    } catch {
      // Ignore unreadable files
    }
  }

  return records.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Restores a backup file into the active database path.
 * Cleans up leftover -wal and -shm files to prevent lock contention.
 */
export function restoreBackup(
  backupFilePath: string,
  targetDbPath?: string
): { success: boolean; message: string } {
  const source = resolve(backupFilePath);
  if (!existsSync(source)) {
    return { success: false, message: `Backup file does not exist: ${source}` };
  }

  const dest = targetDbPath ? resolve(targetDbPath) : CONFIG.DB_PATH;

  try {
    // Copy the snapshot
    copyFileSync(source, dest);

    // Clean up wal and shm companions if they exist
    const walPath = `${dest}-wal`;
    const shmPath = `${dest}-shm`;
    if (existsSync(walPath)) try { unlinkSync(walPath); } catch {}
    if (existsSync(shmPath)) try { unlinkSync(shmPath); } catch {}

    return {
      success: true,
      message: `Successfully restored database from ${basename(source)} to ${dest}`,
    };
  } catch (err: any) {
    return { success: false, message: `Restore failed: ${err.message}` };
  }
}
