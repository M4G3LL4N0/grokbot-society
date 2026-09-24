import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";

/**
 * SQLite store for the society. Uses Node's built-in `node:sqlite` driver
 * (zero native compile, sync API, ideal for the deterministic core).
 *
 * Schema is deliberately clean/relational so it can be migrated later.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  biography TEXT NOT NULL DEFAULT '',
  identity_json TEXT NOT NULL DEFAULT '{}',
  personality_json TEXT NOT NULL DEFAULT '{}',
  interests_json TEXT NOT NULL DEFAULT '[]',
  preferences_json TEXT NOT NULL DEFAULT '{}',
  goals_json TEXT NOT NULL DEFAULT '[]',
  opinions_json TEXT NOT NULL DEFAULT '{}',
  communication_style_json TEXT NOT NULL DEFAULT '{}',
  current_state_json TEXT NOT NULL DEFAULT '{}',
  social_intensity TEXT NOT NULL DEFAULT 'normal',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_active_at INTEGER,
  last_state_at INTEGER
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS person_roles (
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (person_id, role_id)
);

CREATE TABLE IF NOT EXISTS relationships (
  person_a TEXT NOT NULL,
  person_b TEXT NOT NULL,
  dims_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stranger',
  interactions INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (person_a, person_b)
);

CREATE TABLE IF NOT EXISTS circles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'circle',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  member_type TEXT NOT NULL DEFAULT 'person',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (circle_id, member_id)
);

CREATE TABLE IF NOT EXISTS user_links (
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'known',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (person_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  person_ids_json TEXT NOT NULL DEFAULT '[]',
  circle_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'created',
  source TEXT NOT NULL DEFAULT 'system',
  stages_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

CREATE TABLE IF NOT EXISTS timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT,
  circle_id TEXT,
  event_id TEXT,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_timeline_person ON timeline(person_id);
CREATE INDEX IF NOT EXISTS idx_timeline_circle ON timeline(circle_id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_ref TEXT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.8,
  relationship_relevance REAL NOT NULL DEFAULT 0,
  emotional_significance REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memories_person ON memories(person_id, created_at);

CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  event_id TEXT,
  reason TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_followups_due ON followups(status, fire_at);

CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  reason TEXT,
  caller TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_class TEXT NOT NULL,
  input_size INTEGER NOT NULL DEFAULT 0,
  output_size INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  duration_ms REAL NOT NULL DEFAULT 0,
  cache_status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_event ON telemetry(event_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry(created_at);

CREATE TABLE IF NOT EXISTS intelligence_cache (
  key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  deps_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actor_sessions (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  event_id TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  materialized_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS god_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  circle_id TEXT,
  participant_ids_json TEXT NOT NULL DEFAULT '[]',
  context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  person_id TEXT,
  is_user INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id, created_at);
`;

export class SocietyDB {
  readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA foreign_keys = ON");
    }
    this.exec(SCHEMA);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return this.db.prepare(sql);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  get meta(): {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  } {
    const getStmt = this.db.prepare(
      "SELECT value_json FROM god_meta WHERE key = ?",
    );
    const setStmt = this.db.prepare(
      "INSERT INTO god_meta (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
    );
    return {
      get(key: string): unknown {
        const row = getStmt.get(key) as { value_json: string } | undefined;
        return row ? JSON.parse(row.value_json) : undefined;
      },
      set(key: string, value: unknown): void {
        setStmt.run(key, JSON.stringify(value));
      },
    };
  }

  close(): void {
    this.db.close();
  }
}

export function parseRow<T>(row: Record<string, unknown> | undefined | null): T | null {
  if (!row) return null;
  return row as T;
}

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function json<T>(value: T): string {
  return JSON.stringify(value);
}