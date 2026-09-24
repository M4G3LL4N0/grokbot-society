import type { SocietyDB } from "../god/db.ts";
import { id } from "../god/id.ts";
import type { Clock } from "../god/clock.ts";
import type { CircleService } from "../circles";
import type { MemoryRecord, MemoryScope, NewMemoryInput } from "../god/types.ts";

/**
 * MemoryService implements HOT / WARM / COLD tiers and knowledge-privacy
 * scopes. There is NO omniscient hive mind: information flows only through
 * allowed pathways (private / person-user-shared / circle / public).
 */
export class MemoryService {
  private insert: ReturnType<SocietyDB["prepare"]>;
  private selectById: ReturnType<SocietyDB["prepare"]>;
  private byPersonStmt: ReturnType<SocietyDB["prepare"]>;
  private countStmt: ReturnType<SocietyDB["prepare"]>;

  constructor(
    private readonly db: SocietyDB,
    private readonly clock: Clock,
    private readonly circles: CircleService,
    private readonly hotWindow = 8,
    private readonly warmLimit = 6,
    private readonly coldLimit = 3,
  ) {
    this.insert = db.prepare(
      `INSERT INTO memories (id, person_id, scope, scope_ref, type, content, source,
        created_at, importance, confidence, relationship_relevance, emotional_significance)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    this.selectById = db.prepare("SELECT * FROM memories WHERE id = ?");
    this.byPersonStmt = db.prepare(
      "SELECT * FROM memories WHERE person_id = ? ORDER BY created_at DESC LIMIT 200",
    );
    this.countStmt = db.prepare("SELECT COUNT(*) AS n FROM memories");
  }

  store(input: NewMemoryInput): MemoryRecord {
    const record: MemoryRecord = {
      id: id("mem"),
      personId: input.personId,
      scope: input.scope,
      scopeRef: input.scopeRef ?? null,
      type: input.type,
      content: input.content,
      source: input.source ?? "manual",
      createdAt: this.clock.now(),
      importance: clamp01(input.importance ?? 0.5),
      confidence: clamp01(input.confidence ?? 0.8),
      relationshipRelevance: clamp01(input.relationshipRelevance ?? 0),
      emotionalSignificance: clamp01(input.emotionalSignificance ?? 0),
    };
    this.insert.run(
      record.id,
      record.personId,
      record.scope,
      record.scopeRef,
      record.type,
      record.content,
      record.source,
      record.createdAt,
      record.importance,
      record.confidence,
      record.relationshipRelevance,
      record.emotionalSignificance,
    );
    return record;
  }

  storeMany(inputs: NewMemoryInput[]): MemoryRecord[] {
    return this.db.transaction(() => inputs.map((i) => this.store(i)));
  }

  get(memoryId: string): MemoryRecord | null {
    const row = this.selectById.get(memoryId) as Record<string, unknown> | undefined;
    return row ? this.toRecord(row) : null;
  }

  count(): number {
    return (this.countStmt.get() as { n: number }).n;
  }

  /**
   * Retrieve the small relevant memory set for a scene, respecting privacy.
   * HOT  : most recent window (session chat context).
   * WARM : important + relationship-relevant memories, scoped to this circle
   *        and co-participants.
   * COLD : long-term, only pulled when `includeCold` is true.
   */
  retrieveForScene(
    personId: string,
    opts: { participantIds: string[]; circleId: string | null; includeCold?: boolean },
  ): { hot: MemoryRecord[]; warm: MemoryRecord[]; cold: MemoryRecord[] } {
    // Load the memories owned by everyone in the scene (the viewer plus all
    // co-participants), then gate each record by the viewer's access scope.
    // No omniscient hive mind: private stays on its owner, circle flows only
    // to co-members of the shared circle.
    const ownerIds = [...new Set([personId, ...opts.participantIds])];
    const placeholders = ownerIds.map(() => "?").join(", ");
    const rows = (
      this.db
        .prepare(
          `SELECT * FROM memories WHERE person_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 400`,
        )
        .all(...ownerIds) as Record<string, unknown>[]
    ).map(this.toRecord);
    const allowed = rows.filter((r) => this.isVisible(personId, r, opts.circleId));

    const hot = allowed.slice(0, this.hotWindow);
    const rest = allowed.slice(this.hotWindow);
    const warm = rest
      .filter((r) => (r.importance >= 0.5 || r.relationshipRelevance >= 0.4) && r.createdAt > -1)
      .sort(
        (a, b) =>
          b.importance * 0.6 +
          b.relationshipRelevance * 0.4 -
          (a.importance * 0.6 + a.relationshipRelevance * 0.4),
      )
      .slice(0, this.warmLimit);

    const cold = opts.includeCold
      ? allowed
          .slice(this.hotWindow)
          .sort((a, b) => b.importance - a.importance)
          .slice(0, this.coldLimit)
      : [];

    return { hot, warm, cold };
  }

  search(personId: string, query: string, limit = 10): MemoryRecord[] {
    const q = `%${query.toLowerCase()}%`;
    const stmt = this.db.prepare(
      "SELECT * FROM memories WHERE person_id = ? AND lower(content) LIKE ? ORDER BY importance DESC LIMIT ?",
    );
    return (stmt.all(personId, q, limit) as Record<string, unknown>[]).map(this.toRecord);
  }

  applyCandidates(
    candidates: Array<{
      personId: string;
      scope: MemoryScope;
      scopeRef?: string | null;
      type: string;
      content: string;
      importance?: number;
      confidence?: number;
      relationshipRelevance?: number;
      emotionalSignificance?: number;
    }>,
  ): MemoryRecord[] {
    return this.storeMany(candidates.map((c) => ({ source: "scene", ...c })));
  }

  /**
   * Store a shared-history landmark (shared trip, inside joke, conflict,
   * reconciliation, tradition, promise, future plan, milestone...). One row per
   * involved person so each actor's memory stays private but shared. Trivia is
   * NOT stored — memoryCandidates from the scene swat all noise.
   */
  storeLandmark(input: {
    a: string;
    b: string;
    kind: string;
    content: string;
    importance?: number;
  }): MemoryRecord[] {
    const importance = clamp01(input.importance ?? 0.8);
    const content = `${input.kind}: ${input.content}`;
    return this.storeMany([
      {
        personId: input.a,
        scope: "person_user_shared",
        scopeRef: input.b,
        type: "landmark",
        content,
        source: "landmark",
        importance,
        confidence: 1,
        relationshipRelevance: 0.9,
        emotionalSignificance: clamp01(importance),
      },
      {
        personId: input.b,
        scope: "person_user_shared",
        scopeRef: input.a,
        type: "landmark",
        content,
        source: "landmark",
        importance,
        confidence: 1,
        relationshipRelevance: 0.9,
        emotionalSignificance: clamp01(importance),
      },
    ]);
  }

  /** Shared-history landmarks between `personId` and `otherId`. */
  landmarksFor(personId: string, otherId: string | null = null, limit = 6): MemoryRecord[] {
    const where = otherId
      ? `type = 'landmark' AND ((person_id = ? AND scope_ref = ?) OR (person_id = ? AND scope_ref = ?))`
      : `type = 'landmark' AND person_id = ?`;
    const args = otherId
      ? [personId, otherId, otherId, personId]
      : [personId];
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE ${where}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...args, limit) as Array<Record<string, unknown>>;
    return rows.map(this.toRecord);
  }

  private isVisible(
    viewerId: string,
    record: MemoryRecord,
    circleId: string | null,
  ): boolean {
    switch (record.scope) {
      case "private":
        return record.personId === viewerId;
      case "person_user_shared":
        // visible to the owning person; the user is always a party.
        return record.personId === viewerId;
      case "circle":
        if (!record.scopeRef) return false;
        if (record.personId === viewerId) return true;
        if (!circleId || circleId !== record.scopeRef) return false;
        return this.circles
          .memberPersonIds(record.scopeRef)
          .includes(viewerId);
      case "public":
        return true;
      default:
        return false;
    }
  }

  private toRecord(row: Record<string, unknown>): MemoryRecord {
    return {
      id: String(row.id),
      personId: String(row.person_id),
      scope: row.scope as MemoryScope,
      scopeRef: (row.scope_ref as string | null) ?? null,
      type: String(row.type),
      content: String(row.content),
      source: String(row.source),
      createdAt: Number(row.created_at),
      importance: Number(row.importance),
      confidence: Number(row.confidence),
      relationshipRelevance: Number(row.relationship_relevance),
      emotionalSignificance: Number(row.emotional_significance),
    };
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}