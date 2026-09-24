import type { SocietyDB } from "../god/db.ts";
import { json, parseJson } from "../god/db.ts";
import { id } from "../god/id.ts";
import type { Clock } from "../god/clock.ts";
import type { NewPersonInput, PersonState, SocialIntensity } from "../god/types.ts";

const EMPTY_DIMS = (): Record<string, never> => ({});

interface PersonRow {
  id: string;
  name: string;
  biography: string;
  identity_json: string;
  personality_json: string;
  interests_json: string;
  preferences_json: string;
  goals_json: string;
  opinions_json: string;
  communication_style_json: string;
  current_state_json: string;
  social_intensity: SocialIntensity;
  created_at: number;
  updated_at: number;
  last_active_at: number | null;
  last_state_at: number | null;
}

function rowToState(row: PersonRow): PersonState {
  return {
    id: row.id,
    name: row.name,
    biography: row.biography,
    identity: parseJson(row.identity_json, EMPTY_DIMS()),
    personality: parseJson(row.personality_json, EMPTY_DIMS()),
    interests: parseJson(row.interests_json, [] as string[]),
    preferences: parseJson(row.preferences_json, EMPTY_DIMS()),
    goals: parseJson(row.goals_json, [] as string[]),
    opinions: parseJson(row.opinions_json, EMPTY_DIMS()),
    communicationStyle: parseJson(row.communication_style_json, EMPTY_DIMS()),
    currentState: parseJson(row.current_state_json, EMPTY_DIMS()),
    socialIntensity: row.social_intensity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at,
    lastStateAt: row.last_state_at,
  };
}

/**
 * PersonService owns canonical, persistent identity.
 * A Person is pure structured state: zero agents, zero models, zero inference.
 * Dormant Persons cost effectively nothing.
 */
export class PersonService {
  private insert: ReturnType<SocietyDB["prepare"]>;
  private selectById: ReturnType<SocietyDB["prepare"]>;
  private selectMany: ReturnType<SocietyDB["prepare"]>;
  private updateAll: ReturnType<SocietyDB["prepare"]>;
  private touchStmt: ReturnType<SocietyDB["prepare"]>;
  private countStmt: ReturnType<SocietyDB["prepare"]>;
  private listStmt: ReturnType<SocietyDB["prepare"]>;

  constructor(
    private readonly db: SocietyDB,
    private readonly clock: Clock,
  ) {
    this.insert = db.prepare(
      `INSERT INTO persons (
        id, name, biography, identity_json, personality_json, interests_json,
        preferences_json, goals_json, opinions_json, communication_style_json,
        current_state_json, social_intensity, created_at, updated_at,
        last_active_at, last_state_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    this.selectById = db.prepare("SELECT * FROM persons WHERE id = ?");
    this.selectMany = db.prepare("SELECT * FROM persons WHERE id IN (?)");
    this.updateAll = db.prepare(
      `UPDATE persons SET
        name = ?, biography = ?, identity_json = ?, personality_json = ?,
        interests_json = ?, preferences_json = ?, goals_json = ?, opinions_json = ?,
        communication_style_json = ?, current_state_json = ?, social_intensity = ?,
        updated_at = ?
       WHERE id = ?`,
    );
    this.touchStmt = db.prepare(
      "UPDATE persons SET updated_at = ?, last_active_at = ?, last_state_at = ? WHERE id = ?",
    );
    this.countStmt = db.prepare("SELECT COUNT(*) AS n FROM persons");
    this.listStmt = db.prepare(
      "SELECT * FROM persons ORDER BY created_at ASC LIMIT ? OFFSET ?",
    );
  }

  create(input: NewPersonInput): PersonState {
    const now = this.clock.now();
    const personId = id("p");
    const state: PersonState = {
      id: personId,
      name: input.name.trim(),
      identity: input.identity ?? {},
      personality: input.personality ?? {},
      biography: input.biography ?? "",
      interests: input.interests ?? [],
      preferences: input.preferences ?? {},
      goals: input.goals ?? [],
      opinions: input.opinions ?? {},
      communicationStyle: input.communicationStyle ?? {},
      currentState: input.currentState ?? {},
      socialIntensity: input.socialIntensity ?? "normal",
      createdAt: now,
      updatedAt: now,
      lastActiveAt: null,
      lastStateAt: null,
    };
    this.insert.run(
      state.id,
      state.name,
      state.biography,
      json(state.identity),
      json(state.personality),
      json(state.interests),
      json(state.preferences),
      json(state.goals),
      json(state.opinions),
      json(state.communicationStyle),
      json(state.currentState),
      state.socialIntensity,
      state.createdAt,
      state.updatedAt,
      state.lastActiveAt,
      state.lastStateAt,
    );
    return state;
  }

  get(personId: string): PersonState | null {
    const row = this.selectById.get(personId) as PersonRow | undefined;
    return row ? rowToState(row) : null;
  }

  getMany(personIds: string[]): PersonState[] {
    if (personIds.length === 0) return [];
    const placeholders = personIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM persons WHERE id IN (${placeholders})`)
      .all(...personIds) as unknown as PersonRow[];
    const byId = new Map(rows.map((r) => [r.id, rowToState(r)]));
    return personIds
      .map((personId) => byId.get(personId))
      .filter((p): p is PersonState => Boolean(p));
  }

  update(personId: string, patch: Partial<NewPersonInput>): PersonState | null {
    const existing = this.get(personId);
    if (!existing) return null;
    const merged: PersonState = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.biography !== undefined ? { biography: patch.biography } : {}),
      ...(patch.identity !== undefined ? { identity: patch.identity } : {}),
      ...(patch.personality !== undefined ? { personality: patch.personality } : {}),
      ...(patch.interests !== undefined ? { interests: patch.interests } : {}),
      ...(patch.preferences !== undefined ? { preferences: patch.preferences } : {}),
      ...(patch.goals !== undefined ? { goals: patch.goals } : {}),
      ...(patch.opinions !== undefined ? { opinions: patch.opinions } : {}),
      ...(patch.communicationStyle !== undefined
        ? { communicationStyle: patch.communicationStyle }
        : {}),
      ...(patch.currentState !== undefined ? { currentState: patch.currentState } : {}),
      ...(patch.socialIntensity !== undefined
        ? { socialIntensity: patch.socialIntensity }
        : {}),
      updatedAt: this.clock.now(),
    };
    this.updateAll.run(
      merged.name,
      merged.biography,
      json(merged.identity),
      json(merged.personality),
      json(merged.interests),
      json(merged.preferences),
      json(merged.goals),
      json(merged.opinions),
      json(merged.communicationStyle),
      json(merged.currentState),
      merged.socialIntensity,
      merged.updatedAt,
      merged.id,
    );
    return merged;
  }

  /** Marks a person active (timer-touch). No inference. */
  touch(personId: string): PersonState | null {
    const existing = this.get(personId);
    if (!existing) return null;
    const now = this.clock.now();
    this.touchStmt.run(now, now, now, personId);
    return { ...existing, updatedAt: now, lastActiveAt: now, lastStateAt: now };
  }

  count(): number {
    return (this.countStmt.get() as { n: number }).n;
  }

  list(limit = 100, offset = 0): PersonState[] {
    const rows = this.listStmt.all(limit, offset) as unknown as PersonRow[];
    return rows.map(rowToState);
  }
}