import { app } from "electron";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "./migrations";

type SqlValue = string | number | boolean | null | undefined;

class Statement {
  constructor(
    private readonly database: Database,
    private readonly sql: string
  ) {}

  run(...params: SqlValue[]): void {
    this.database.exec(this.database.interpolate(this.sql, params));
  }

  get(...params: SqlValue[]): unknown {
    return this.database.query(this.database.interpolate(this.sql, params))[0];
  }

  all(...params: SqlValue[]): unknown[] {
    return this.database.query(this.database.interpolate(this.sql, params));
  }
}

export class Database {
  readonly filePath: string;

  constructor() {
    const dataDir = path.join(app.getPath("userData"), "data");
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, "crawl-web-electron.sqlite");
    runMigrations(this);
  }

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  exec(sql: string): void {
    execFileSync("sqlite3", [this.filePath], {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"]
    });
  }

  query(sql: string): unknown[] {
    const output = execFileSync("sqlite3", ["-json", this.filePath, sql], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();

    return output ? (JSON.parse(output) as unknown[]) : [];
  }

  interpolate(sql: string, params: SqlValue[]): string {
    let index = 0;
    return sql.replace(/\?/g, () => this.toSql(params[index++]));
  }

  private toSql(value: SqlValue): string {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
    if (typeof value === "boolean") return value ? "1" : "0";
    return `'${value.replace(/'/g, "''")}'`;
  }
}

