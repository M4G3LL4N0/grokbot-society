import type { SocietyDB } from "../god/db.ts";
import type { Circle, PersonState, Relationship, RelationshipSummary } from "../god/types.ts";
import type { PersonService } from "../people";
import type { RoleService } from "../roles";
import type { RelationshipService } from "../relationships";
import type { CircleService } from "./CircleService.ts";

export interface PeerEdge {
  personId: string;
  relationship: RelationshipSummary;
}

/**
 * SocialGraph provides unified reads across Person ↔ Person, Person ↔ User,
 * Person ↔ Role, Person ↔ Circle, Person ↔ Event, and Circle ↔ Event edges.
 * Read-only; never infers.
 */
export class SocialGraph {
  constructor(
    private readonly db: SocietyDB,
    private readonly persons: PersonService,
    private readonly roles: RoleService,
    private readonly relationships: RelationshipService,
    private readonly circles: CircleService,
  ) {}

  peersOf(personId: string, otherIds?: string[]): PeerEdge[] {
    const rels = this.relationships.relationshipsFor(personId);
    const edges: PeerEdge[] = [];
    for (const rel of rels) {
      const other = rel.personA === personId ? rel.personB : rel.personA;
      if (otherIds && !otherIds.includes(other)) continue;
      const summary = this.relationships.summarize(rel, personId);
      if (summary) edges.push({ personId: other, relationship: summary });
    }
    return edges;
  }

  roleLabelsFor(personId: string): string[] {
    return this.roles.assignments(personId).map((r) => r.name);
  }

  circlesOf(personId: string): Circle[] {
    return this.circles.circlesFor(personId);
  }

  /** Person + their roles + their circles (a compact identity snapshot). */
  snapshot(personId: string): { person: PersonState; roles: string[]; circles: Circle[] } | null {
    const person = this.persons.get(personId);
    if (!person) return null;
    return {
      person,
      roles: this.roleLabelsFor(personId),
      circles: this.circlesOf(personId),
    };
  }

  sharedCircles(a: string, b: string): Circle[] {
    const aCircles = new Set(this.circlesOf(a).map((c) => c.id));
    return this.circlesOf(b).filter((c) => aCircles.has(c.id));
  }

  eventsOf(personId: string, limit = 20): Array<{ id: string; type: string; created: number }> {
    const stmt = this.db.prepare(
      "SELECT id, event_type, created_at FROM events WHERE person_ids_json LIKE ? ORDER BY created_at DESC LIMIT ?",
    );
    return (stmt.all(`%${personId}%`, limit) as Array<{
      id: string;
      event_type: string;
      created_at: number;
    }>).map((r) => ({ id: r.id, type: r.event_type, created: r.created_at }));
  }

  allRelationships(): Relationship[] {
    const rows = this.db.prepare("SELECT * FROM relationships").all() as Array<{
      person_a: string;
      person_b: string;
      dims_json: string;
      status: string;
      interactions: number;
      created_at: number;
      updated_at: number;
    }>;
    return rows.map((r) => ({
      personA: r.person_a,
      personB: r.person_b,
      dims: JSON.parse(r.dims_json) as Relationship["dims"],
      status: r.status as Relationship["status"],
      interactions: r.interactions,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }
}