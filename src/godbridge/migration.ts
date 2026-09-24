/**
 * LEGACY GOD MIGRATION
 *
 * The experimental God is an archived prototype. Its conversation is NOT
 * migrated. Only durable social state that Society can store as first-class
 * rows may be imported:
 *
 *   person facts · relationship facts · circle definitions · meaningful memories
 *   explicit user preferences · roles
 *
 * Everything transient is refused by construction. The report names the fields
 * that were ignored, never their contents, so a migration log can never leak a
 * transcript back into the repository.
 */

import type { GodKernel } from "../god/GodKernel.ts";
import { RELATIONSHIP_DIMENSIONS, type RelationshipDim } from "../god/types.ts";

/** Fields that must never be imported, at any level. */
const TRANSIENT_TOP_LEVEL = ["prompts", "transcripts", "filler", "logs", "developmentHistory"] as const;
const TRANSIENT_PER_PERSON = ["prompt", "transcripts", "filler", "logs", "developmentHistory"] as const;
const TRANSIENT_PER_RELATIONSHIP = ["transcript", "transcripts", "filler", "logs"] as const;
const TRANSIENT_PER_CIRCLE = ["logs", "transcript", "filler", "developmentHistory"] as const;
const TRANSIENT_PER_MEMORY = ["filler", "transcript", "logs"] as const;

export interface LegacyPerson {
  name: string;
  biography?: string;
  identity?: Record<string, unknown>;
  personality?: Record<string, unknown>;
  interests?: string[];
  preferences?: Record<string, unknown>;
  goals?: string[];
  opinions?: Record<string, unknown>;
  communicationStyle?: Record<string, unknown>;
  socialIntensity?: string;
  roles?: string[];
  circles?: string[];
  [key: string]: unknown;
}

export interface LegacyRelationship {
  a: string;
  b: string;
  dims?: Record<string, unknown>;
  interactions?: number;
  [key: string]: unknown;
}

export interface LegacyCircle {
  name: string;
  kind?: string;
  members?: string[];
  [key: string]: unknown;
}

export interface LegacyMemory {
  a?: string;
  b?: string;
  personId?: string;
  kind?: string;
  content: string;
  importance?: number;
  [key: string]: unknown;
}

export interface LegacyFacts {
  persons?: LegacyPerson[];
  relationships?: LegacyRelationship[];
  circles?: LegacyCircle[];
  memories?: LegacyMemory[];
  preferences?: Array<{ key: string; value: unknown }> | Record<string, unknown>;
  roles?: Array<{ id: string; name?: string; category?: string; description?: string }>;
  [key: string]: unknown;
}

interface LegacyPreference {
  key: string;
  value: unknown;
}

export interface MigrationReport {
  counts: {
    persons: number;
    relationships: number;
    circles: number;
    memories: number;
    preferences: number;
    roles: number;
  };
  /** names only — never values, so no transcript can leak into a log */
  ignoredFields: string[];
  /** dimension keys that were dropped because they do not exist in the schema */
  droppedRelationshipDimensions: string[];
}

const SOCIAL_INTENSITIES = new Set(["quiet", "low", "normal", "social", "very_social", "do_not_disturb"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** Person/relationship/memory fields that are durable. Everything else is refused. */
const DURABLE_PERSON_FIELDS = new Set([
  "id", "name", "biography", "identity", "personality", "interests", "preferences",
  "goals", "opinions", "communicationStyle", "socialIntensity", "roles", "circles",
]);
const DURABLE_IDENTITY_FIELDS = new Set(["core", "age", "location", "pronouns", "background", "values"]);

/**
 * Copy only allow-listed keys. Transient or unknown data is reported BY NAME so
 * a migration log can never leak its contents.
 */
function pickDurable(
  source: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  ignored: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (allowed.has(k)) {
      out[k] = v;
    } else {
      ignored.push(`${path}.${k}`);
    }
  }
  return out;
}

function cleanDims(raw: Record<string, unknown> | undefined): { dims: Partial<Record<RelationshipDim, number>>; dropped: string[] } {
  const dims: Partial<Record<RelationshipDim, number>> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!(RELATIONSHIP_DIMENSIONS as readonly string[]).includes(k)) {
      dropped.push(k);
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) dims[k as RelationshipDim] = v;
  }
  return { dims, dropped };
}

/**
 * Import durable social state. Idempotent by name: re-running does not create
 * duplicate persons, circles or preferences.
 */
export function migrateLegacyFacts(kernel: GodKernel, input: LegacyFacts): MigrationReport {
  const ignored: string[] = [];
  const droppedDims: string[] = [];
  const counts = { persons: 0, relationships: 0, circles: 0, memories: 0, preferences: 0, roles: 0 };

  const KNOWN_TOP_LEVEL = new Set([
    "persons", "relationships", "circles", "memories", "preferences", "roles",
    ...TRANSIENT_TOP_LEVEL,
  ]);
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (KNOWN_TOP_LEVEL.has(key)) continue;
    ignored.push(key);
  }
  for (const key of TRANSIENT_TOP_LEVEL) {
    const v = (input as Record<string, unknown>)[key];
    if (Array.isArray(v) ? v.length > 0 : v !== undefined) ignored.push(key);
  }

  // ── roles ───────────────────────────────────────────────────────────────
  const roleIdByName = new Map<string, string>();
  for (const role of kernel.roles.list()) {
    roleIdByName.set(role.id.toLowerCase(), role.id);
    roleIdByName.set(role.name.toLowerCase(), role.id);
  }
  for (const role of input.roles ?? []) {
    if (!role || typeof role.id !== "string") continue;
    const name = role.name ?? role.id;
    if (!kernel.roles.get(role.id)) {
      kernel.roles.register({
        id: role.id,
        name,
        category: (role.category as never) ?? "companion",
        description: role.description ?? "migrated role",
        tags: [],
        createdAt: kernel.clock.now(),
      } as never);
    }
    roleIdByName.set(name.toLowerCase(), role.id);
    counts.roles += 1;
  }

  // ── circles (before members so membership can resolve) ───────────────────
  const circleIdByName = new Map<string, string>();
  for (const [index, circle] of (input.circles ?? []).entries()) {
    if (!circle || typeof circle.name !== "string") continue;
    for (const key of TRANSIENT_PER_CIRCLE) {
      if (circle[key] !== undefined) ignored.push(`circles[${index}].${key}`);
    }
    const existing = kernel.circles.list().find((c) => c.name === circle.name);
    const created = existing ?? kernel.circles.create(circle.name, circle.kind ?? "circle");
    circleIdByName.set(circle.name.toLowerCase(), created.id);
    counts.circles += existing ? 0 : 1;
  }

  // ── persons ─────────────────────────────────────────────────────────────
  const personIdByName = new Map<string, string>();
  const legacyIdToPersonId = new Map<string, string>();
  for (const [index, p] of (input.persons ?? []).entries()) {
    if (!p || typeof p.name !== "string") continue;
    for (const key of Object.keys(p)) {
      if (!DURABLE_PERSON_FIELDS.has(key)) ignored.push(`persons[${index}].${key}`);
    }
    const existing = kernel.persons.list(1_000_000).find((c) => c.name === p.name);
    if (existing) {
      personIdByName.set(p.name.toLowerCase(), existing.id);
      continue;
    }
    const intensity = p.socialIntensity && SOCIAL_INTENSITIES.has(p.socialIntensity) ? (p.socialIntensity as never) : "normal";
    const created = kernel.persons.create({
      name: p.name,
      biography: typeof p.biography === "string" ? p.biography : "",
      identity: isRecord(p.identity) ? pickDurable(p.identity, DURABLE_IDENTITY_FIELDS, `persons[${index}].identity`, ignored) : {},
      personality: isRecord(p.personality) ? p.personality : {},
      interests: Array.isArray(p.interests) ? p.interests.filter((i): i is string => typeof i === "string") : [],
      preferences: isRecord(p.preferences) ? p.preferences : {},
      goals: Array.isArray(p.goals) ? p.goals.filter((g): g is string => typeof g === "string") : [],
      opinions: isRecord(p.opinions) ? p.opinions : {},
      communicationStyle: isRecord(p.communicationStyle) ? p.communicationStyle : {},
      socialIntensity: intensity,
    } as never);
    personIdByName.set(p.name.toLowerCase(), created.id);
    if (typeof p.id === "string") legacyIdToPersonId.set(p.id, created.id);
    counts.persons += 1;

    for (const roleName of p.roles ?? []) {
      const key = String(roleName).toLowerCase();
      // reuse an existing registry entry with the same name; roles are a registry,
      // not per-person objects, and assigning one never creates an agent
      let roleId = roleIdByName.get(key) ?? kernel.roles.list().find((r) => r.name.toLowerCase() === key)?.id;
      if (!roleId) {
        roleId = `role_${key.replace(/[^a-z0-9]+/g, "_")}`;
        kernel.roles.register({
          id: roleId,
          name: String(roleName),
          category: "companion",
          description: "migrated role",
          tags: [],
          createdAt: kernel.clock.now(),
        } as never);
        counts.roles += 1;
      }
      roleIdByName.set(key, roleId);
      kernel.roles.assign(created.id, roleId);
      counts.roles += 1;
    }
    for (const circleName of p.circles ?? []) {
      const circleId = circleIdByName.get(String(circleName).toLowerCase());
      if (circleId) kernel.joinCircle(circleId, created.id);
    }
  }

  // ── circle membership declared on the circle itself ──────────────────────
  for (const circle of input.circles ?? []) {
    const circleId = circleIdByName.get(circle.name.toLowerCase());
    if (!circleId) continue;
    for (const member of circle.members ?? []) {
      const personId = personIdByName.get(String(member).toLowerCase());
      if (personId) kernel.joinCircle(circleId, personId);
    }
  }

  // ── relationships ───────────────────────────────────────────────────────
  for (const [index, r] of (input.relationships ?? []).entries()) {
    if (!r) continue;
    for (const key of Object.keys(r)) {
      if (!["a", "b", "personA", "personB", "dims", "dimensions", "interactions"].includes(key)) {
        ignored.push(`relationships[${index}].${key}`);
      }
    }
    const aName = (r.a ?? (r as Record<string, unknown>).personA) as string | undefined;
    const bName = (r.b ?? (r as Record<string, unknown>).personB) as string | undefined;
    // legacy rows may be addressed by legacy id as well as by name
    const byId = (v: string | undefined): string | undefined =>
      v === undefined ? undefined : personIdByName.get(v.toLowerCase()) ?? legacyIdToPersonId.get(v);
    const a = byId(aName);
    const b = byId(bName);
    if (!a || !b || a === b) continue;
    const { dims, dropped } = cleanDims((r.dims ?? (r as Record<string, unknown>).dimensions) as Record<string, unknown> | undefined);
    droppedDims.push(...dropped.map((d) => `relationships[${index}].dims.${d}`));
    if (Object.keys(dims).length === 0) continue;
    kernel.relationship.seed(a, b, dims, typeof r.interactions === "number" ? r.interactions : 0);
    counts.relationships += 1;
  }

  // ── memories ────────────────────────────────────────────────────────────
  for (const [index, m] of (input.memories ?? []).entries()) {
    if (!m || typeof m.content !== "string") continue;
    for (const key of Object.keys(m)) {
      if (!["a", "b", "personId", "kind", "content", "importance"].includes(key)) {
        ignored.push(`memories[${index}].${key}`);
      }
    }
    // a memory typed as filler is small talk, not shared history
    if (m.kind === "filler") {
      ignored.push(`memories[${index}].kind`);
      continue;
    }
    const a = m.personId
      ? personIdByName.get(String(m.personId).toLowerCase())
      : m.a
        ? personIdByName.get(String(m.a).toLowerCase())
        : undefined;
    if (!a) continue;
    const b = m.b ? personIdByName.get(String(m.b).toLowerCase()) : undefined;
    if (b) {
      kernel.memory.storeLandmark({
        a,
        b,
        kind: m.kind ?? "shared_history",
        content: m.content,
        importance: typeof m.importance === "number" ? m.importance : 0.6,
      });
    } else {
      kernel.memory.store({
        personId: a,
        scope: "private",
        type: m.kind ?? "note",
        content: m.content,
        importance: typeof m.importance === "number" ? m.importance : 0.5,
      } as never);
    }
    counts.memories += 1;
  }

  // ── explicit user preferences ───────────────────────────────────────────
  const existingPrefs = (kernel.db.meta.get("user.preferences") as Record<string, unknown> | null) ?? {};
  const rawPrefs = (input as Record<string, unknown>).preferences;
  if (Array.isArray(rawPrefs)) {
    for (const pref of rawPrefs as LegacyPreference[]) {
      if (!pref || typeof pref.key !== "string" || pref.value === undefined) continue;
      existingPrefs[pref.key] = pref.value;
      counts.preferences += 1;
    }
  } else if (isRecord(rawPrefs)) {
    for (const [key, value] of Object.entries(rawPrefs)) {
      existingPrefs[key] = value;
      counts.preferences += 1;
    }
  }
  if (counts.preferences > 0) kernel.db.meta.set("user.preferences", existingPrefs);

  return { counts, ignoredFields: ignored, droppedRelationshipDimensions: droppedDims };
}
