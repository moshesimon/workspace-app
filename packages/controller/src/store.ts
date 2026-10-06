import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "../../contracts/src/errors.js";
export const tables = [
  "projects",
  "configuration_revisions",
  "discovery_reports",
  "setup_receipts",
  "runtime_resources",
  "repositories",
  "workspaces",
  "checkouts",
  "profiles",
  "service_instances",
  "port_reservations",
  "operations",
  "destroy_previews",
  "integration_installs",
] as const;
export class Store {
  private db: Database.Database;
  constructor(public root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new Database(join(root, "state.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.transaction(() => {
      for (const table of tables)
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
        );
      this.db.pragma("user_version = 1");
    })();
  }
  private table(name: string) {
    if (!(tables as readonly string[]).includes(name))
      throw new DomainError("INVALID_INPUT", "Unknown state table");
    return name;
  }
  get<T = any>(table: string, id: string): T | undefined {
    const row = this.db
      .prepare(`SELECT data FROM ${this.table(table)} WHERE id=?`)
      .get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  all<T = any>(table: string): T[] {
    return (
      this.db.prepare(`SELECT data FROM ${this.table(table)}`).all() as {
        data: string;
      }[]
    ).map((r) => JSON.parse(r.data));
  }
  put(table: string, entity: { id: string; [key: string]: any }) {
    this.db
      .prepare(
        `INSERT INTO ${this.table(table)} (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(entity.id, JSON.stringify(entity));
  }
  delete(table: string, id: string) {
    this.db.prepare(`DELETE FROM ${this.table(table)} WHERE id=?`).run(id);
  }
  close() {
    this.db.close();
  }
}
