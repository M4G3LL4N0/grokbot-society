import type { SocietyDB } from "../god/db.ts";
import type { Clock } from "../god/clock.ts";
import type { EventEngine } from "../events/EventEngine.ts";
import type { TimelineService } from "../events";
import type {
  SocietySession,
  SessionKind,
  SessionMessageRecord,
} from "../god/types.ts";

export interface SessionRuntimeDeps {
  db: SocietyDB;
  clock: Clock;
  events: EventEngine;
  timeline: TimelineService;
  /** Deterministic tiny person descriptor for bounded participant cards. */
  describePerson(personId: string): { id: string; name: string; roleIds: string[] };
  config: { rollingMessageWindow: number; maxParticipantCards: number };
}

/**
 * SessionRuntime — long-session abstraction (road trips, walks, evenings,
 * group hangs, ambient companionship). Never ships the full transcript into a
 * prompt: every compile is a bounded ROLLING window + participant cards +
 * retrieval (landmarks/recents ~ less context). Session state is
 * SocialOS-owned, not model-owned.
 */
export class SessionRuntime {
  constructor(private readonly deps: SessionRuntimeDeps) {}

  private stmt(kind: "start" | "insert" | "messages" | "session" | "update") {
    const db = this.deps.db;
    switch (kind) {
      case "start":
        return db.prepare(
          `INSERT INTO sessions (id, kind, circle_id, participant_ids_json, context_json, status, started_at)
           VALUES (?,?,?,?,?,?,?)`,
        );
      case "insert":
        return db.prepare(
          `INSERT INTO session_messages (id, session_id, person_id, is_user, text, created_at)
           VALUES (?,?,?,?,?,?)`,
        );
      case "messages":
        return db.prepare(
          `SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 400`,
        );
      case "session":
        return db.prepare(`SELECT * FROM sessions WHERE id = ?`);
      case "update":
        return db.prepare(
          `UPDATE sessions SET context_json = ?, status = ?, ended_at = ? WHERE id = ?`,
        );
    }
    throw new Error("unreachable");
  }

  start(opts: { kind: SessionKind; circleId?: string | null; participantIds: string[] }): SocietySession {
    const id = `sess_${crypto.randomUUID().slice(0, 12)}`;
    const now = this.deps.clock.now();
    this.stmt("start").run(
      id,
      opts.kind,
      opts.circleId ?? null,
      JSON.stringify(opts.participantIds),
      JSON.stringify({}),
      "active",
      now,
    );
    return this.get(id) as SocietySession;
  }

  get(sessionId: string): SocietySession | null {
    const row = this.stmt("session").get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const context = JSON.parse(String(row.context_json)) as { messageCount?: number } | undefined;
    return {
      id: String(row.id),
      kind: row.kind as SessionKind,
      label: labelForKind(row.kind as SessionKind),
      circleId: (row.circle_id as string | null) ?? null,
      participantIds: JSON.parse(String(row.participant_ids_json)) as string[],
      createdAt: Number(row.started_at),
      lastActiveAt: (row.ended_at as number | null) ?? Number(row.started_at),
      messageCount: context?.messageCount ?? 0,
      status: String(row.status) as SocietySession["status"],
    };
  }

  end(sessionId: string): SocietySession | null {
    const session = this.get(sessionId);
    if (!session || session.status !== "active") return session;
    const now = this.deps.clock.now();
    const count = this.messages(sessionId).length;
    this.stmt("update").run(
      JSON.stringify({ messageCount: count, kind: session.kind }),
      "ended",
      now,
      sessionId,
    );
    return this.get(sessionId);
  }

  messages(sessionId: string): SessionMessageRecord[] {
    const rows = this.stmt("messages").all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      personId: (r.person_id as string | null) ?? null,
      role: Number(r.is_user) === 1 ? "user" : "person",
      text: String(r.text),
      createdAt: Number(r.created_at),
    }));
  }

  /** Append one bounded session message (user or person). */
  append(
    sessionId: string,
    input: { personId?: string | null; role: "user" | "person"; text: string },
  ): SessionMessageRecord {
    const session = this.get(sessionId);
    if (!session) throw new Error(`unknown session ${sessionId}`);
    const id = `msg_${crypto.randomUUID().slice(0, 12)}`;
    const now = this.deps.clock.now();
    this.stmt("insert").run(
      id,
      sessionId,
      input.personId ?? null,
      input.role === "user" ? 1 : 0,
      input.text,
      now,
    );
    // keep bounded: remember only the last rolling window worth of bookkeeping
    const all = this.messages(sessionId);
    this.stmt("update").run(
      JSON.stringify({ messageCount: all.length }),
      session.status,
      null,
      sessionId,
    );
    return { id, sessionId, role: input.role, personId: input.personId ?? null, text: input.text, createdAt: now };
  }

  /**
   * Bound the session context: closest N messages + ≤ maxParticipantCards
   * participant cards. Everything older simply falls out of the window.
   */
  compileContext(sessionId: string): {
    messages: SessionMessageRecord[];
    participants: Array<{ id: string; name: string; roleIds: string[] }>;
  } {
    const session = this.get(sessionId);
    if (!session) return { messages: [], participants: [] };
    const all = this.messages(sessionId);
    const recent = all.slice(-this.deps.config.rollingMessageWindow);
    const participants = session.participantIds
      .slice(0, this.deps.config.maxParticipantCards)
      .map((p) => this.deps.describePerson(p));
    return { messages: recent, participants };
  }
}

export function labelForKind(kind: SessionKind): string {
  switch (kind) {
    case "road_trip":
      return "Road trip";
    case "walking":
      return "Walk";
    case "evening_social":
      return "Evening together";
    case "group_conversation":
      return "Group conversation";
    case "ambient_companionship":
      return "Ambient company";
  }
}

export function parseSessionRow(row: Record<string, unknown>): SocietySession {
  const context = JSON.parse(String(row.context_json)) as { messageCount?: number } | undefined;
  return {
    id: String(row.id),
    kind: row.kind as SessionKind,
    label: labelForKind(row.kind as SessionKind),
    circleId: (row.circle_id as string | null) ?? null,
    participantIds: JSON.parse(String(row.participant_ids_json)) as string[],
    createdAt: Number(row.started_at),
    lastActiveAt: (row.ended_at as number | null) ?? Number(row.started_at),
    messageCount: context?.messageCount ?? 0,
    status: String(row.status) as SocietySession["status"],
  };
}