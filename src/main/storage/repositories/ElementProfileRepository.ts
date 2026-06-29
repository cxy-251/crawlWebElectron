import type { Database } from "../Database";
import type { KuaishouElementProfile } from "../../../shared/kuaishou/types";

type Row = {
  profile_json: string;
};

export class ElementProfileRepository {
  constructor(private readonly db: Database) {}

  ensureDefault(profile: KuaishouElementProfile): KuaishouElementProfile {
    const existing = this.getById(profile.id);

    if (existing) {
      const merged: KuaishouElementProfile = {
        ...existing,
        version: Math.max(existing.version || 0, profile.version),
        uploadUrlCandidates: existing.uploadUrlCandidates?.length ? existing.uploadUrlCandidates : profile.uploadUrlCandidates,
        elements: {
          ...profile.elements,
          ...existing.elements
        }
      };

      const hasMissingElements = Object.keys(profile.elements).some((key) => !existing.elements[key as keyof typeof profile.elements]);
      return hasMissingElements || merged.version !== existing.version ? this.save(merged) : existing;
    }

    return this.save(profile);
  }

  getActiveKuaishouProfile(): KuaishouElementProfile {
    const row = this.db
      .prepare("SELECT profile_json FROM element_profiles WHERE platform = ? ORDER BY updated_at DESC LIMIT 1")
      .get("kuaishou") as Row | undefined;

    if (!row) {
      throw new Error("Kuaishou element profile not found");
    }

    return JSON.parse(row.profile_json) as KuaishouElementProfile;
  }

  getById(id: string): KuaishouElementProfile | null {
    const row = this.db.prepare("SELECT profile_json FROM element_profiles WHERE id = ?").get(id) as Row | undefined;
    return row ? (JSON.parse(row.profile_json) as KuaishouElementProfile) : null;
  }

  save(profile: KuaishouElementProfile): KuaishouElementProfile {
    const now = Date.now();
    const next = {
      ...profile,
      updatedAt: now,
      createdAt: profile.createdAt || now
    };
    this.db
      .prepare(
        `INSERT INTO element_profiles (id, platform, name, version, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           version = excluded.version,
           profile_json = excluded.profile_json,
           updated_at = excluded.updated_at`
      )
      .run(next.id, next.platform, next.name, next.version, JSON.stringify(next), next.createdAt, next.updatedAt);
    return next;
  }
}
