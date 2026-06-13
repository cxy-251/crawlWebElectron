import type { Database } from "./Database";

export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      name TEXT NOT NULL,
      partition TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS element_profiles (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      profile_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS upload_tasks (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      caption TEXT NOT NULL,
      cover_path TEXT,
      publish_time TEXT,
      publish_mode TEXT NOT NULL,
      element_profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_url TEXT,
      page_type TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      level TEXT NOT NULL,
      step TEXT NOT NULL,
      message TEXT NOT NULL,
      data_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}
