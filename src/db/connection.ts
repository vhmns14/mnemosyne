import { Database } from "bun:sqlite";
import { CONFIG } from "../config.ts";
import { initSchema } from "./schema.ts";

let dbInstance: Database | null = null;

export function getDatabase(customPath?: string): Database {
  if (!dbInstance || customPath) {
    const dbPath = customPath || CONFIG.DB_PATH;
    const db = new Database(dbPath, { create: true });
    initSchema(db);
    if (!customPath) {
      dbInstance = db;
    }
    return db;
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.query("PRAGMA wal_checkpoint(TRUNCATE);").get();
    } catch {
      // ignore
    }
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
  }
}
