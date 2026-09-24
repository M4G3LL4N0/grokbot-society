import type { SocietyDB } from "../god/db.ts";
import type { Clock } from "../god/clock.ts";

export interface TimelineEntry {
  id: number;
  personId: string | null;
  circleId: string | null;
  eventId: string | null;
  kind: string;
  content: string;
  createdAt: number;
}

export interface NewTimelineEntry {
  personId?: string | null;
  circleId?: string | null;
  eventId?: string | null;
  kind: string;
  content: string;
  at?: number;
}

/**
 * TimelineService persists the observable social timeline per Person and
 * per Circle. Pure storage — no inference.
 */
export class TimelineService {
  private insert: ReturnType<SocietyDB["prepare"]>;
  private byPersonStmt: ReturnType<SocietyDB["prepare"]>;
  private byCircleStmt: ReturnType<SocietyDB["prepare"]>;
  private recentStmt: ReturnType<SocietyDB["prepare"]>;

  constructor(
    private readonly db: SocietyDB,
    private readonly clock: Clock,
  ) {
    this.insert = db.prepare(
      "INSERT INTO timeline (person_id, circle_id, event_id, kind, content, created_at) VALUES (?,?,?,?,?,?)",
    );
    this.byPersonStmt = db.prepare(
      "SELECT * FROM timeline WHERE person_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    );
    this.byCircleStmt = db.prepare(
      "SELECT * FROM timeline WHERE circle_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    );
    this.recentStmt = db.prepare(
      "SELECT * FROM timeline ORDER BY created_at DESC, id DESC LIMIT ?",
    );
  }

  append(entry: NewTimelineEntry): TimelineEntry {
    const at = entry.at ?? this.clock.now();
    const inserted = this.insert.run(
      entry.personId ?? null,
      entry.circleId ?? null,
      entry.eventId ?? null,
      entry.kind,
      entry.content,
      at,
    );
    return {
      id: Number(inserted.lastInsertRowid),
      personId: entry.personId ?? null,
      circleId: entry.circleId ?? null,
      eventId: entry.eventId ?? null,
      kind: entry.kind,
      content: entry.content,
      createdAt: at,
    };
  }

  appendMany(entries: NewTimelineEntry[]): TimelineEntry[] {
    return this.db.transaction(() => {
      const out: TimelineEntry[] = [];
      for (const e of entries) {
        out.push(this.append(e));
      }
      return out;
    });
  }

  forPerson(personId: string, limit = 20): TimelineEntry[] {
    return this.toEntries(this.byPersonStmt.all(personId, limit));
  }

  forCircle(circleId: string, limit = 20): TimelineEntry[] {
    return this.toEntries(this.byCircleStmt.all(circleId, limit));
  }

  recent(limit = 20): TimelineEntry[] {
    return this.toEntries(this.recentStmt.all(limit));
  }

  private toEntries(rows: unknown[]): TimelineEntry[] {
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: Number(r.id),
      personId: (r.person_id as string | null) ?? null,
      circleId: (r.circle_id as string | null) ?? null,
      eventId: (r.event_id as string | null) ?? null,
      kind: r.kind as string,
      content: r.content as string,
      createdAt: Number(r.created_at),
    }));
  }
}