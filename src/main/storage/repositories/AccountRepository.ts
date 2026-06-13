import type { Database } from "../Database";
import { KUAISHOU_PARTITION } from "../../session/SessionManager";

export class AccountRepository {
  constructor(private readonly db: Database) {}

  ensureDefaultKuaishouAccount(): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO accounts (id, platform, name, partition, created_at, updated_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
      )
      .run("default-kuaishou", "kuaishou", "默认快手账号", KUAISHOU_PARTITION, now, now, now);
  }
}
