import type { GodKernel } from "../god/GodKernel.ts";
import {
  RELATIONSHIP_DIMENSIONS,
  type MemoryScope,
  type NewPersonInput,
  type RelationshipDim,
  type RoleCategory,
  type RoleDefinition,
  type SocialIntensity,
} from "../god/types.ts";

const SOCIAL_INTENSITIES = new Set<SocialIntensity>([
  "quiet",
  "low",
  "normal",
  "social",
  "very_social",
  "do_not_disturb",
]);

const ROLE_CATEGORIES = new Set<RoleCategory>([
  "relationship",
  "activity",
  "intellectual_social",
]);

const RELATIONSHIP_STATUSES = new Set([
  "stranger",
  "acquaintance",
  "friend",
  "close_friend",
  "best_friend",
  "romantic_interest",
  "partner",
  "spouse",
  "sibling",
  "parent_like",
  "cousin",
  "mentor",
]);

const FAMILY_STATUSES = new Set(["sibling", "parent_like", "cousin"]);

const DURABLE_MEMORY_KINDS = new Set([
  "fact",
  "preference",
  "landmark",
  "shared_history",
  "shared_trip",
  "important_conversation",
  "inside_joke",
  "conflict",
  "reconciliation",
  "tradition",
  "promise",
  "future_plan",
  "milestone",
  "relationship",
  "event",
  "note",
]);

const MEMORY_SCOPES = new Set<MemoryScope>([
  "private",
  "person_user_shared",
  "circle",
  "public",
]);

const TRANSIENT_KEYS = new Set([
  "prompt",
  "prompts",
  "systemprompt",
  "masterprompt",
  "instructions",
  "transcript",
  "transcripts",
  "conversation",
  "conversationhistory",
  "messages",
  "filler",
  "fillers",
  "log",
  "logs",
  "debug",
  "debugging",
  "reasoning",
  "developmenthistory",
  "incidentnotes",
]);

const TOP_LEVEL_FIELDS = new Set([
  "persons",
  "relationships",
  "circles",
  "memories",
  "preferences",
  "roles",
]);

const PERSON_FIELDS = new Set([
  "id",
  "personId",
  "name",
  "displayName",
  "biography",
  "bio",
  "identity",
  "personality",
  "traits",
  "stableTraits",
  "interests",
  "preferences",
  "goals",
  "opinions",
  "communicationStyle",
  "socialIntensity",
  "roles",
  "circles",
]);

const RELATIONSHIP_FIELDS = new Set([
  "a",
  "b",
  "personA",
  "personB",
  "dims",
  "dimensions",
  "interactions",
  "status",
  "roleHint",
]);

const CIRCLE_FIELDS = new Set(["id", "name", "kind", "members", "metadata"]);

const MEMORY_FIELDS = new Set([
  "a",
  "b",
  "personId",
  "personIds",
  "kind",
  "type",
  "content",
  "importance",
  "confidence",
  "relationshipRelevance",
  "emotionalSignificance",
  "scope",
  "scopeRef",
]);

const ROLE_FIELDS = new Set([
  "id",
  "name",
  "category",
  "tendencies",
  "capabilities",
  "relationshipExpectations",
  "contextRequirements",
  "constraints",
  "permissions",
]);

const PREFERENCE_FIELDS = new Set(["key", "value", "personId"]);

type JsonRecord = Record<string, unknown>;

export interface LegacyPerson {
  id?: string;
  personId?: string;
  name: string;
  displayName?: string;
  biography?: string;
  bio?: string;
  identity?: JsonRecord;
  personality?: JsonRecord;
  traits?: string[];
  stableTraits?: string[];
  interests?: string[];
  preferences?: JsonRecord;
  goals?: string[];
  opinions?: JsonRecord;
  communicationStyle?: JsonRecord;
  socialIntensity?: SocialIntensity;
  roles?: string[];
  circles?: string[];
  [key: string]: unknown;
}

export interface LegacyRelationship {
  a?: string;
  b?: string;
  personA?: string;
  personB?: string;
  dims?: JsonRecord;
  dimensions?: JsonRecord;
  interactions?: number;
  status?: string;
  roleHint?: string;
  [key: string]: unknown;
}

export interface LegacyCircle {
  id?: string;
  name: string;
  kind?: string;
  members?: unknown[];
  metadata?: JsonRecord;
  [key: string]: unknown;
}

export interface LegacyMemory {
  a?: string;
  b?: string;
  personId?: string;
  personIds?: unknown[];
  kind?: string;
  type?: string;
  content?: string;
  importance?: number;
  confidence?: number;
  relationshipRelevance?: number;
  emotionalSignificance?: number;
  scope?: MemoryScope;
  scopeRef?: string;
  [key: string]: unknown;
}

export interface LegacyPreference {
  key: string;
  value: unknown;
  personId?: string;
  [key: string]: unknown;
}

export interface LegacyRole {
  id?: string;
  name?: string;
  category?: RoleCategory;
  tendencies?: string[];
  capabilities?: string[];
  relationshipExpectations?: string[];
  contextRequirements?: string[];
  constraints?: string[];
  permissions?: string[];
  [key: string]: unknown;
}

export interface LegacyFacts {
  persons?: LegacyPerson[];
  relationships?: LegacyRelationship[];
  circles?: LegacyCircle[];
  memories?: LegacyMemory[];
  preferences?: LegacyPreference[] | JsonRecord;
  roles?: LegacyRole[];
  [key: string]: unknown;
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
  ignoredFields: string[];
  droppedRelationshipDimensions: string[];
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isTransientKey(key: string): boolean {
  return TRANSIENT_KEYS.has(normalizeKey(key));
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addIgnored(ignored: Set<string>, path: string): void {
  if (path) ignored.add(path);
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}

function referenceText(value: unknown): string | undefined {
  const text = textValue(value);
  if (text) return text;
  if (!isRecord(value)) return undefined;
  return textValue(value.id) ?? textValue(value.personId) ?? textValue(value.name);
}

function collection(value: unknown, path: string, ignored: Set<string>): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    addIgnored(ignored, path);
    return [];
  }
  return value;
}

function cleanValue(value: unknown, path: string, ignored: Set<string>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    addIgnored(ignored, path);
    return undefined;
  }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    value.forEach((entry, index) => {
      const cleaned = cleanValue(entry, `${path}[${index}]`, ignored);
      if (cleaned !== undefined) result.push(cleaned);
    });
    return result;
  }
  if (isRecord(value)) {
    const result: JsonRecord = {};
    for (const [key, entry] of Object.entries(value)) {
      const entryPath = path ? `${path}.${key}` : key;
      if (isTransientKey(key)) {
        addIgnored(ignored, entryPath);
        continue;
      }
      const cleaned = cleanValue(entry, entryPath, ignored);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result;
  }
  addIgnored(ignored, path);
  return undefined;
}

function cleanRecord(value: unknown, path: string, ignored: Set<string>): JsonRecord | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    addIgnored(ignored, path);
    return undefined;
  }
  const cleaned = cleanValue(value, path, ignored);
  return isRecord(cleaned) ? cleaned : undefined;
}

function cleanStringArray(value: unknown, path: string, ignored: Set<string>): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    addIgnored(ignored, path);
    return [];
  }
  const result: string[] = [];
  value.forEach((entry, index) => {
    const text = textValue(entry);
    if (text) result.push(text);
    else addIgnored(ignored, `${path}[${index}]`);
  });
  return result;
}

function reportUnknownFields(
  record: JsonRecord,
  allowed: Set<string>,
  path: string,
  ignored: Set<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) addIgnored(ignored, `${path}.${key}`);
  }
}

function finiteNumber(value: unknown, path: string, ignored: Set<string>, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    if (value !== undefined) addIgnored(ignored, path);
    return fallback;
  }
  return value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cleanDims(
  value: unknown,
  path: string,
  ignored: Set<string>,
  dropped: string[],
): Partial<Record<RelationshipDim, number>> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    addIgnored(ignored, path);
    return {};
  }
  const dims: Partial<Record<RelationshipDim, number>> = {};
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (!(RELATIONSHIP_DIMENSIONS as readonly string[]).includes(key)) {
      dropped.push(entryPath);
      addIgnored(ignored, entryPath);
      continue;
    }
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      addIgnored(ignored, entryPath);
      continue;
    }
    dims[key as RelationshipDim] = Math.max(-1, Math.min(1, entry));
  }
  return dims;
}

function roleSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || "legacy";
}

function personPatch(record: JsonRecord, path: string, ignored: Set<string>): Partial<NewPersonInput> {
  const patch: Partial<NewPersonInput> = {};
  const biography = typeof record.biography === "string" ? record.biography : record.bio;
  if (typeof biography === "string") patch.biography = biography;
  else if (biography !== undefined) addIgnored(ignored, `${path}.biography`);

  const identity = cleanRecord(record.identity, `${path}.identity`, ignored);
  if (identity !== undefined) patch.identity = identity;
  const personality = cleanRecord(record.personality, `${path}.personality`, ignored);
  if (personality !== undefined) patch.personality = personality;
  const opinions = cleanRecord(record.opinions, `${path}.opinions`, ignored);
  if (opinions !== undefined) patch.opinions = opinions;
  const communicationStyle = cleanRecord(
    record.communicationStyle,
    `${path}.communicationStyle`,
    ignored,
  );
  if (communicationStyle !== undefined) patch.communicationStyle = communicationStyle;
  const preferences = cleanRecord(record.preferences, `${path}.preferences`, ignored);
  if (preferences !== undefined) patch.preferences = preferences;

  if (record.interests !== undefined) patch.interests = cleanStringArray(record.interests, `${path}.interests`, ignored);
  if (record.goals !== undefined) patch.goals = cleanStringArray(record.goals, `${path}.goals`, ignored);

  const traits = [
    ...cleanStringArray(record.traits, `${path}.traits`, ignored),
    ...cleanStringArray(record.stableTraits, `${path}.stableTraits`, ignored),
  ];
  if (record.traits !== undefined || record.stableTraits !== undefined) {
    patch.personality = { ...(patch.personality ?? {}), traits };
  }

  if (record.socialIntensity !== undefined) {
    if (typeof record.socialIntensity === "string" && SOCIAL_INTENSITIES.has(record.socialIntensity as SocialIntensity)) {
      patch.socialIntensity = record.socialIntensity as SocialIntensity;
    } else {
      addIgnored(ignored, `${path}.socialIntensity`);
    }
  }
  return patch;
}

function makeRoleDefinition(
  id: string,
  name: string,
  category: RoleCategory,
  record: JsonRecord,
  path: string,
  ignored: Set<string>,
): RoleDefinition {
  return {
    id,
    name,
    category,
    tendencies: cleanStringArray(record.tendencies, `${path}.tendencies`, ignored),
    capabilities: cleanStringArray(record.capabilities, `${path}.capabilities`, ignored),
    relationshipExpectations: cleanStringArray(
      record.relationshipExpectations,
      `${path}.relationshipExpectations`,
      ignored,
    ),
    contextRequirements: cleanStringArray(
      record.contextRequirements,
      `${path}.contextRequirements`,
      ignored,
    ),
    constraints: cleanStringArray(record.constraints, `${path}.constraints`, ignored),
    permissions: cleanStringArray(record.permissions, `${path}.permissions`, ignored),
  };
}

function ensureRole(
  kernel: GodKernel,
  roleByRef: Map<string, string>,
  roleValue: unknown,
  path: string,
  ignored: Set<string>,
  counts: MigrationReport["counts"],
): string | undefined {
  const name = textValue(roleValue);
  if (!name) {
    if (roleValue !== undefined) addIgnored(ignored, path);
    return undefined;
  }
  const key = name.toLowerCase();
  const existing = roleByRef.get(key);
  if (existing) return existing;
  const id = `role_${roleSlug(name)}`;
  if (!kernel.roles.get(id)) {
    const record: JsonRecord = {};
    const definition = makeRoleDefinition(id, name, "activity", record, path, ignored);
    kernel.roles.register(definition);
    counts.roles += 1;
  }
  roleByRef.set(key, id);
  return id;
}

function resolvePerson(
  value: unknown,
  personByRef: Map<string, string>,
  kernel: GodKernel,
): string | undefined {
  const reference = referenceText(value);
  if (!reference) return undefined;
  const mapped = personByRef.get(reference.toLowerCase());
  if (mapped) return mapped;
  return kernel.persons.get(reference)?.id;
}

function addPersonReference(
  personByRef: Map<string, string>,
  personId: string,
  references: Array<unknown>,
): void {
  personByRef.set(personId.toLowerCase(), personId);
  for (const reference of references) {
    const text = referenceText(reference);
    if (text) personByRef.set(text.toLowerCase(), personId);
  }
}

function applyPreference(
  kernel: GodKernel,
  key: string,
  value: unknown,
  path: string,
  personRef: string | undefined,
  personByRef: Map<string, string>,
  globalPreferences: JsonRecord,
  ignored: Set<string>,
  counts: MigrationReport["counts"],
): void {
  if (!key || isTransientKey(key)) {
    addIgnored(ignored, path);
    return;
  }
  const cleaned = cleanValue(value, `${path}.value`, ignored);
  if (cleaned === undefined) return;
  if (personRef) {
    const personId = resolvePerson(personRef, personByRef, kernel);
    if (!personId) {
      addIgnored(ignored, `${path}.personId`);
      return;
    }
    const person = kernel.persons.get(personId);
    if (!person) return;
    kernel.persons.update(personId, {
      preferences: { ...(isRecord(person.preferences) ? person.preferences : {}), [key]: cleaned },
    });
  } else {
    globalPreferences[key] = cleaned;
  }
  counts.preferences += 1;
}

export function migrateLegacyFacts(kernel: GodKernel, input: LegacyFacts): MigrationReport {
  const source: JsonRecord = isRecord(input) ? input : {};
  const ignored = new Set<string>();
  const droppedRelationshipDimensions: string[] = [];
  const counts: MigrationReport["counts"] = {
    persons: 0,
    relationships: 0,
    circles: 0,
    memories: 0,
    preferences: 0,
    roles: 0,
  };

  for (const key of Object.keys(source)) {
    if (!TOP_LEVEL_FIELDS.has(key)) addIgnored(ignored, key);
  }

  const roleByRef = new Map<string, string>();
  for (const role of kernel.roles.list()) {
    roleByRef.set(role.id.toLowerCase(), role.id);
    roleByRef.set(role.name.toLowerCase(), role.id);
  }
  for (const [index, value] of collection(source.roles, "roles", ignored).entries()) {
    const path = `roles[${index}]`;
    if (!isRecord(value)) {
      addIgnored(ignored, path);
      continue;
    }
    reportUnknownFields(value, ROLE_FIELDS, path, ignored);
    const id = textValue(value.id);
    const name = textValue(value.name) ?? id;
    if (!name) {
      addIgnored(ignored, `${path}.name`);
      continue;
    }
    const roleId = id ?? `role_${roleSlug(name)}`;
    const rawCategory = value.category;
    const category = typeof rawCategory === "string" && ROLE_CATEGORIES.has(rawCategory as RoleCategory)
      ? rawCategory as RoleCategory
      : "activity";
    if (rawCategory !== undefined && category === "activity" && rawCategory !== "activity") {
      addIgnored(ignored, `${path}.category`);
    }
    if (!kernel.roles.get(roleId)) {
      kernel.roles.register(makeRoleDefinition(roleId, name, category, value, path, ignored));
      counts.roles += 1;
    }
    roleByRef.set(name.toLowerCase(), roleId);
    roleByRef.set(roleId.toLowerCase(), roleId);
  }

  const circleByRef = new Map<string, string>();
  const circleNames = new Map<string, string>();
  const existingCircles = kernel.circles.list();
  for (const circle of existingCircles) {
    circleByRef.set(circle.id.toLowerCase(), circle.id);
    circleByRef.set(circle.name.toLowerCase(), circle.id);
    circleNames.set(circle.id, circle.name);
  }
  const pendingMemberships: Array<{ circleRef: string; personRef: unknown; path: string }> = [];
  for (const [index, value] of collection(source.circles, "circles", ignored).entries()) {
    const path = `circles[${index}]`;
    if (!isRecord(value)) {
      addIgnored(ignored, path);
      continue;
    }
    reportUnknownFields(value, CIRCLE_FIELDS, path, ignored);
    const name = textValue(value.name);
    if (!name) {
      addIgnored(ignored, `${path}.name`);
      continue;
    }
    const legacyId = textValue(value.id);
    const existingId = legacyId ? circleByRef.get(legacyId.toLowerCase()) : undefined;
    const existing = kernel.circles.list().find((circle) => circle.id === existingId || circle.name === name);
    const kind = textValue(value.kind) ?? "circle";
    const metadata = cleanRecord(value.metadata, `${path}.metadata`, ignored) ?? {};
    const circle = existing ?? kernel.circles.create(name, kind, metadata);
    circleByRef.set(circle.id.toLowerCase(), circle.id);
    circleByRef.set(circle.name.toLowerCase(), circle.id);
    circleNames.set(circle.id, circle.name);
    if (legacyId) circleByRef.set(legacyId.toLowerCase(), circle.id);
    counts.circles += 1;
    if (value.members !== undefined) {
      if (!Array.isArray(value.members)) {
        addIgnored(ignored, `${path}.members`);
      } else {
        value.members.forEach((member, memberIndex) => {
          const reference = referenceText(member);
          if (reference) pendingMemberships.push({ circleRef: circle.id, personRef: reference, path: `${path}.members[${memberIndex}]` });
          else addIgnored(ignored, `${path}.members[${memberIndex}]`);
        });
      }
    }
  }

  const personByRef = new Map<string, string>();
  const existingPersons = kernel.persons.list(1_000_000);
  for (const person of existingPersons) addPersonReference(personByRef, person.id, [person.id, person.name]);
  const existingByName = new Map(existingPersons.map((person) => [person.name.toLowerCase(), person]));

  for (const [index, value] of collection(source.persons, "persons", ignored).entries()) {
    const path = `persons[${index}]`;
    if (!isRecord(value)) {
      addIgnored(ignored, path);
      continue;
    }
    reportUnknownFields(value, PERSON_FIELDS, path, ignored);
    const name = textValue(value.name) ?? textValue(value.displayName);
    if (!name) {
      addIgnored(ignored, `${path}.name`);
      continue;
    }
    const legacyRefs = [value.id, value.personId, name];
    const patch = personPatch(value, path, ignored);
    const existingId = resolvePerson(value.id ?? value.personId, personByRef, kernel);
    const existing = existingByName.get(name.toLowerCase()) ?? (existingId ? kernel.persons.get(existingId) ?? undefined : undefined);
    const person = existing ?? kernel.createPerson({ name, ...patch });
    if (existing) kernel.persons.update(existing.id, patch);
    addPersonReference(personByRef, person.id, legacyRefs);
    existingByName.set(name.toLowerCase(), person);
    counts.persons += 1;

    if (value.roles !== undefined) {
      if (!Array.isArray(value.roles)) addIgnored(ignored, `${path}.roles`);
      else {
        value.roles.forEach((roleValue, roleIndex) => {
          const roleId = ensureRole(kernel, roleByRef, roleValue, `${path}.roles[${roleIndex}]`, ignored, counts);
          if (roleId) {
            kernel.roles.assign(person.id, roleId);
            counts.roles += 1;
          }
        });
      }
    }
    if (value.circles !== undefined) {
      if (!Array.isArray(value.circles)) addIgnored(ignored, `${path}.circles`);
      else {
        value.circles.forEach((circleValue, circleIndex) => {
          const reference = referenceText(circleValue);
          if (!reference) {
            addIgnored(ignored, `${path}.circles[${circleIndex}]`);
            return;
          }
          let circleId = circleByRef.get(reference.toLowerCase());
          if (!circleId) {
            const created = kernel.circles.create(reference, "circle");
            circleId = created.id;
            circleByRef.set(reference.toLowerCase(), circleId);
            circleNames.set(circleId, reference);
            counts.circles += 1;
          }
          kernel.joinCircle(circleId, person.id);
        });
      }
    }
  }

  for (const membership of pendingMemberships) {
    const circleId = circleByRef.get(membership.circleRef.toLowerCase()) ?? membership.circleRef;
    const personId = resolvePerson(membership.personRef, personByRef, kernel);
    if (!personId) {
      addIgnored(ignored, membership.path);
      continue;
    }
    kernel.joinCircle(circleId, personId);
  }

  for (const [index, value] of collection(source.relationships, "relationships", ignored).entries()) {
    const path = `relationships[${index}]`;
    if (!isRecord(value)) {
      addIgnored(ignored, path);
      continue;
    }
    reportUnknownFields(value, RELATIONSHIP_FIELDS, path, ignored);
    const aRef = referenceText(value.a ?? value.personA);
    const bRef = referenceText(value.b ?? value.personB);
    if (!aRef || !bRef) {
      addIgnored(ignored, `${path}.${aRef ? "b" : "a"}`);
      continue;
    }
    const a = resolvePerson(aRef, personByRef, kernel);
    const b = resolvePerson(bRef, personByRef, kernel);
    if (!a || !b || a === b) {
      addIgnored(ignored, `${path}.${!a ? "a" : "b"}`);
      continue;
    }
    const dims = cleanDims(value.dims ?? value.dimensions, `${path}.dims`, ignored, droppedRelationshipDimensions);
    if (Object.keys(dims).length === 0) continue;
    const interactions = Math.max(0, Math.floor(finiteNumber(value.interactions, `${path}.interactions`, ignored, 0)));
    kernel.relationship.seed(a, b, dims, interactions);
    const status = textValue(value.status) ?? textValue(value.roleHint);
    if (status && FAMILY_STATUSES.has(status)) {
      kernel.relationship.update(a, b, {}, { interactions: 0, roleHint: status });
    } else if (status && !RELATIONSHIP_STATUSES.has(status)) {
      addIgnored(ignored, `${path}.status`);
    }
    counts.relationships += 1;
  }

  for (const [index, value] of collection(source.memories, "memories", ignored).entries()) {
    const path = `memories[${index}]`;
    if (!isRecord(value)) {
      addIgnored(ignored, path);
      continue;
    }
    reportUnknownFields(value, MEMORY_FIELDS, path, ignored);
    const content = textValue(value.content);
    if (!content) {
      addIgnored(ignored, `${path}.content`);
      continue;
    }
    const kind = textValue(value.kind) ?? textValue(value.type) ?? "fact";
    if (isTransientKey(kind) || !DURABLE_MEMORY_KINDS.has(kind)) {
      addIgnored(ignored, `${path}.kind`);
      continue;
    }
    const personRefs = Array.isArray(value.personIds)
      ? value.personIds
      : value.personId !== undefined
        ? [value.personId]
        : value.a !== undefined
          ? [value.a]
          : [];
    if (personRefs.length === 0) {
      addIgnored(ignored, `${path}.personId`);
      continue;
    }
    const a = resolvePerson(personRefs[0], personByRef, kernel);
    if (!a) {
      addIgnored(ignored, `${path}.personId`);
      continue;
    }
    const importance = clamp01(finiteNumber(value.importance, `${path}.importance`, ignored, 0.5));
    const confidence = clamp01(finiteNumber(value.confidence, `${path}.confidence`, ignored, 0.8));
    const relationshipRelevance = clamp01(
      finiteNumber(value.relationshipRelevance, `${path}.relationshipRelevance`, ignored, 0),
    );
    const emotionalSignificance = clamp01(
      finiteNumber(value.emotionalSignificance, `${path}.emotionalSignificance`, ignored, 0),
    );
    if (value.b !== undefined) {
      const b = resolvePerson(value.b, personByRef, kernel);
      if (!b || a === b) {
        addIgnored(ignored, `${path}.b`);
        continue;
      }
      kernel.memory.storeLandmark({ a, b, kind, content, importance });
    } else {
      let scope: MemoryScope = "private";
      if (value.scope !== undefined) {
        if (typeof value.scope === "string" && MEMORY_SCOPES.has(value.scope as MemoryScope)) {
          scope = value.scope as MemoryScope;
        } else {
          addIgnored(ignored, `${path}.scope`);
        }
      }
      let scopeRef = textValue(value.scopeRef) ?? null;
      if (scope === "circle" && scopeRef && !circleByRef.has(scopeRef.toLowerCase())) {
        addIgnored(ignored, `${path}.scopeRef`);
        scopeRef = null;
      }
      kernel.memory.store({
        personId: a,
        scope,
        scopeRef,
        type: kind,
        content,
        source: "legacy_migration",
        importance,
        confidence,
        relationshipRelevance,
        emotionalSignificance,
      });
    }
    counts.memories += 1;
  }

  const storedPreferences = kernel.db.meta.get("user.preferences");
  const globalPreferences: JsonRecord = isRecord(storedPreferences) ? { ...storedPreferences } : {};
  const preferences = source.preferences;
  if (Array.isArray(preferences)) {
    preferences.forEach((value, index) => {
      const path = `preferences[${index}]`;
      if (!isRecord(value)) {
        addIgnored(ignored, path);
        return;
      }
      reportUnknownFields(value, PREFERENCE_FIELDS, path, ignored);
      const key = textValue(value.key);
      if (!key) {
        addIgnored(ignored, `${path}.key`);
        return;
      }
      applyPreference(
        kernel,
        key,
        value.value,
        path,
        textValue(value.personId),
        personByRef,
        globalPreferences,
        ignored,
        counts,
      );
    });
  } else if (preferences !== undefined) {
    if (!isRecord(preferences)) addIgnored(ignored, "preferences");
    else {
      for (const [key, value] of Object.entries(preferences)) {
        applyPreference(kernel, key, value, `preferences.${key}`, undefined, personByRef, globalPreferences, ignored, counts);
      }
    }
  }
  if (counts.preferences > 0) kernel.db.meta.set("user.preferences", globalPreferences);

  return {
    counts,
    ignoredFields: [...ignored],
    droppedRelationshipDimensions,
  };
}
