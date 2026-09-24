import type { SocietyDB } from "../god/db.ts";
import { json } from "../god/db.ts";
import { id } from "../god/id.ts";
import type { Clock } from "../god/clock.ts";
import type { PersonService } from "../people";
import type { RoleService } from "../roles";
import type { RelationshipService } from "../relationships";
import type { MemoryService } from "../memory";
import type { ActorContext, SyntheticActor } from "../god/types.ts";
import { IdentityCardCompiler } from "./IdentityCard.ts";

export interface MaterializeInput {
  personId: string;
  eventId: string;
  participantIds: string[];
  circleId: string | null;
}

const MAX_COMPOSED_MEMORIES = 5;

/**
 * SyntheticActorRuntime materializes an ephemeral ACTOR:
 *
 *   Person + active Roles + relationship context + small memory set + scene
 *
 * and composes the Actor Context deterministically (PERSON STATE + ROLES +
 * RELATIONSHIP + RELEVANT MEMORY + SCENE → Actor Context). The Actor exists
 * only for one event/session. Lightweight state, never a permanently running
 * agent; materialization and composition cost zero inference.
 */
export class SyntheticActorRuntime {
  private insertSession: ReturnType<SocietyDB["prepare"]>;
  private readonly cards: IdentityCardCompiler;

  constructor(
    private readonly db: SocietyDB,
    private readonly clock: Clock,
    private readonly persons: PersonService,
    private readonly roles: RoleService,
    private readonly relationships: RelationshipService,
    private readonly memory: MemoryService,
  ) {
    this.insertSession = db.prepare(
      "INSERT INTO actor_sessions (id, person_id, event_id, context_json, materialized_at, ended_at) VALUES (?,?,?,?,?,?)",
    );
    this.cards = new IdentityCardCompiler();
  }

  /** Deterministic compile: identity card + active roles + relationships + memory. */
  composeActorContext(
    personId: string,
    sceneRef: string,
    participantIds: string[],
    circleId: string | null,
  ): ActorContext {
    const person = this.persons.get(personId);
    if (!person) throw new Error(`Unknown person ${personId}`);

    const roleDefs = this.roles.assignments(personId);
    const relationships = participantIds
      .map((otherId) => {
        if (otherId === personId) return null;
        const rel = this.relationships.get(personId, otherId);
        return rel ? this.relationships.summarize(rel, personId) : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const mem = this.memory.retrieveForScene(personId, {
      participantIds: participantIds.filter((p) => p !== personId),
      circleId,
    });
    const memories = [...mem.hot, ...mem.warm, ...mem.cold].slice(0, MAX_COMPOSED_MEMORIES);

    return {
      personId,
      card: this.cards.compile(person, roleDefs),
      roles: roleDefs,
      relationships,
      memories,
      sceneRef,
    };
  }

  materialize(input: MaterializeInput): SyntheticActor {
    const person = this.persons.get(input.personId);
    if (!person) throw new Error(`Unknown person ${input.personId}`);

    const actor: SyntheticActor = {
      ...this.composeActorContext(input.personId, input.eventId, input.participantIds, input.circleId),
      sessionId: id("as"),
      eventId: input.eventId,
      person,
      materializedAt: this.clock.now(),
    };

    const at = this.clock.now();
    this.insertSession.run(
      actor.sessionId,
      input.personId,
      input.eventId,
      json({
        partnerIds: input.participantIds,
        circleId: input.circleId,
        sessionId: actor.sessionId,
      }),
      at,
      at,
    );
    return actor;
  }
}