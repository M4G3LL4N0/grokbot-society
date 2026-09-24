import type { SocietyDB } from "../god/db.ts";
import { json, parseJson } from "../god/db.ts";
import type { Clock } from "../god/clock.ts";
import type {
  Relationship,
  RelationshipDim,
  RelationshipDims,
  RelationshipStatus,
  RelationshipSummary,
} from "../god/types.ts";
import { RELATIONSHIP_DIMENSIONS } from "../god/types.ts";

function emptyDims(): RelationshipDims {
  return {
    familiarity: 0,
    trust: 0,
    affection: 0,
    attraction: 0,
    respect: 0,
    comfort: 0,
    shared_history: 0,
    intellectual_connection: 0,
    humor_compatibility: 0,
    reciprocity: 0,
    tension: 0,
    interaction_frequency: 0,
  };
}

interface RelationshipRow {
  person_a: string;
  person_b: string;
  dims_json: string;
  status: RelationshipStatus;
  interactions: number;
  created_at: number;
  updated_at: number;
}

function rowToRel(row: RelationshipRow): Relationship {
  return {
    personA: row.person_a,
    personB: row.person_b,
    dims: parseJson(row.dims_json, emptyDims()),
    status: row.status,
    interactions: row.interactions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Deterministic status ladder with INTERTIA. A single routine interaction must
 * never transform a stranger into a spouse; promotions require both dimensional
 * floors AND many interactions.
 */
export function deriveStatus(
  dims: RelationshipDims,
  interactions: number,
  roleHint?: string,
): RelationshipStatus {
  if (["sibling", "parent_like", "cousin"].includes(roleHint ?? "")) {
    return roleHint as RelationshipStatus;
  }
  const { familiarity, trust, affection, attraction, comfort, shared_history } = dims;

  if (interactions >= 60 && trust >= 0.8 && affection >= 0.85 && familiarity >= 0.75 && shared_history >= 0.7)
    return "spouse";
  if (interactions >= 25 && trust >= 0.65 && affection >= 0.7 && familiarity >= 0.6)
    return "partner";
  if (attraction >= 0.5 && affection >= 0.5 && familiarity >= 0.4 && trust >= 0.3)
    return "romantic_interest";
  if (interactions >= 15 && familiarity >= 0.75 && trust >= 0.7 && affection >= 0.6 && shared_history >= 0.5)
    return "best_friend";
  if (interactions >= 8 && familiarity >= 0.6 && trust >= 0.55 && affection >= 0.45 && comfort >= 0.4)
    return "close_friend";
  if (interactions >= 3 && familiarity >= 0.4 && trust >= 0.3 && comfort >= 0.25)
    return "friend";
  if (interactions >= 1 && familiarity >= 0.15 && trust >= 0.05)
    return "acquaintance";
  return "stranger";
}

/**
 * RelationshipService persists Person ↔ Person bonds with dimensional state
 * and inertia. Only scheduled, validated deltas are ever applied.
 */
export class RelationshipService {
  private selectPair: ReturnType<SocietyDB["prepare"]>;
  private insertPair: ReturnType<SocietyDB["prepare"]>;
  private updatePair: ReturnType<SocietyDB["prepare"]>;
  private byPersonStmt: ReturnType<SocietyDB["prepare"]>;
  private countStmt: ReturnType<SocietyDB["prepare"]>;

  constructor(
    private readonly db: SocietyDB,
    private readonly clock: Clock,
    private readonly learningRate = 0.15,
  ) {
    this.selectPair = db.prepare(
      "SELECT * FROM relationships WHERE person_a = ? AND person_b = ?",
    );
    this.insertPair = db.prepare(
      "INSERT INTO relationships (person_a, person_b, dims_json, status, interactions, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    );
    this.updatePair = db.prepare(
      "UPDATE relationships SET dims_json = ?, status = ?, interactions = ?, updated_at = ? WHERE person_a = ? AND person_b = ?",
    );
    this.byPersonStmt = db.prepare(
      "SELECT * FROM relationships WHERE person_a = ? OR person_b = ? ORDER BY updated_at DESC",
    );
    this.countStmt = db.prepare("SELECT COUNT(*) AS n FROM relationships");
  }

  private key(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  ensure(a: string, b: string): Relationship {
    const [pa, pb] = this.key(a, b);
    const existing = this.get(pa, pb);
    if (existing) return existing;
    const now = this.clock.now();
    const rel: Relationship = {
      personA: pa,
      personB: pb,
      dims: emptyDims(),
      status: "stranger",
      interactions: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.insertPair.run(pa, pb, json(rel.dims), rel.status, 0, now, now);
    return rel;
  }

  /**
   * SEED canonical relationship state directly (used by society seeding on
   * first boot). Inertia does NOT apply — this writes final dims, not deltas.
   * Runs only for relationships that do not exist yet (idempotent).
   */
  seed(
    a: string,
    b: string,
    dims: Partial<Record<RelationshipDim, number>>,
    interactions = 1,
  ): Relationship {
    const [pa, pb] = this.key(a, b);
    const existing = this.get(pa, pb);
    if (existing) return existing;
    const now = this.clock.now();
    const next = { ...emptyDims() };
    for (const dim of Object.keys(dims) as RelationshipDim[]) {
      const value = dims[dim];
      if (typeof value === "number" && Number.isFinite(value)) {
        next[dim] = clamp(value);
      }
    }
    const status = deriveStatus(next, interactions);
    const rel: Relationship = {
      personA: pa,
      personB: pb,
      dims: next,
      status,
      interactions,
      createdAt: now,
      updatedAt: now,
    };
    this.insertPair.run(pa, pb, json(next), status, interactions, now, now);
    return rel;
  }

  get(a: string, b: string): Relationship | null {
    const [pa, pb] = this.key(a, b);
    const row = this.selectPair.get(pa, pb) as RelationshipRow | undefined;
    return row ? rowToRel(row) : null;
  }

  /**
   * Apply a delta with INERTIA: only learningRate × delta actually lands.
   * Returns the effective (post-inertia) relationship plus old one.
   */
  update(
    a: string,
    b: string,
    delta: Partial<Record<RelationshipDim, number>>,
    opts: { interactions?: number; roleHint?: string } = {},
  ): Relationship {
    const rel = this.ensure(a, b);
    const next = { ...rel.dims };
    for (const dim of Object.keys(delta) as RelationshipDim[]) {
      const value = delta[dim];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const damped = value * this.learningRate;
      next[dim] = clamp((next[dim] ?? 0) + damped);
    }
    const interactions = rel.interactions + (opts.interactions ?? 1);
    const status = deriveStatus(next, interactions, opts.roleHint);
    const now = this.clock.now();
    const updated: Relationship = {
      ...rel,
      dims: next,
      interactions,
      status,
      updatedAt: now,
    };
    this.updatePair.run(
      json(next),
      status,
      interactions,
      now,
      updated.personA,
      updated.personB,
    );
    updated.createdAt = rel.createdAt;
    return updated;
  }

  /** Apply validated relationship candidates from a scene (post-inertia),
   *  bounded by `cap` per dimension — a routine dialogue cannot jump a bond. */
  applyCandidates(
    candidates: Array<{ personA: string; personB: string; dimsDelta: Partial<Record<RelationshipDim, number>> }>,
    cap: number | null = null,
  ): Relationship[] {
    const results: Relationship[] = [];
    for (const c of candidates) {
      const delta = { ...c.dimsDelta };
      if (cap !== null) {
        for (const dim of Object.keys(delta) as RelationshipDim[]) {
          const value = delta[dim];
          if (typeof value === "number") delta[dim] = clamp(value) * cap;
        }
      }
      results.push(this.update(c.personA, c.personB, delta));
    }
    return results;
  }

  summarize(rel: Relationship | null, from: string): RelationshipSummary | null {
    if (!rel) return null;
    const other = rel.personA === from ? rel.personB : rel.personA;
    return {
      personId: other,
      dims: rel.dims,
      status: rel.status,
      interactions: rel.interactions,
    };
  }

  relationshipsFor(personId: string): Relationship[] {
    const rows = this.byPersonStmt.all(personId, personId) as unknown as RelationshipRow[];
    return rows.map(rowToRel);
  }

  count(): number {
    return (this.countStmt.get() as { n: number }).n;
  }
}