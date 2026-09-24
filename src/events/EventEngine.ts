import type { SocietyDB } from "../god/db.ts";
import { json } from "../god/db.ts";
import { id } from "../god/id.ts";
import type { Clock } from "../god/clock.ts";
import type { EventType, SocietyEvent } from "../god/types.ts";
import { ValidationError } from "../god/errors.ts";
import type { PersonService } from "../people";
import type { CircleService } from "../circles";
import type { TimelineService } from "../events";
import type { RelationshipService } from "../relationships";
import type { SocialDirector } from "../runtime/SocialDirector.ts";
import type { SerendipityEngine } from "../runtime/SerendipityEngine.ts";

const INTERACTION_TYPES: EventType[] = [
  "USER_MESSAGE",
  "DIRECT_INTERACTION",
  "GROUP_INTERACTION",
  "SCHEDULED_FOLLOWUP",
  "CIRCLE_EVENT",
  "PROACTIVE_REACH",
  "SESSION_MESSAGE",
];

const BOOKKEEPING_TYPES: EventType[] = [
  "RELATIONSHIP_EVENT",
  "TIMELINE_EVENT",
  "CONTEXT_CHANGE",
  "INTRODUCTION_CANDIDATE",
  "SESSION_START",
  "SESSION_END",
  "PROACTIVE_CANDIDATE",
  "LANDMARK_EVENT",
];

const ALL_TYPES = new Set<EventType>([...INTERACTION_TYPES, ...BOOKKEEPING_TYPES]);

export interface EventInput {
  eventType: EventType;
  actorId?: string | null;
  personIds?: string[];
  circleId?: string | null;
  payload?: Record<string, unknown>;
  source?: string;
}

/**
 * EventEngine: the event-driven pipeline. Most events stop BEFORE inference:
 *
 *   EVENT → deterministic validation → cache/state lookup → relevance scoring
 *   → participant selection → context compilation → budget decision →
 *   optional inference → validation → persistence
 *
 * Interaction events go to the SocialDirector (single inference max).
 * Bookkeeping events are applied deterministically with zero inference.
 */
export class EventEngine {
  constructor(
    private readonly deps: {
      db: SocietyDB;
      clock: Clock;
      director: SocialDirector;
      serendipity: SerendipityEngine;
      persons: PersonService;
      circles: CircleService;
      timeline: TimelineService;
      relationships: RelationshipService;
      userInfo: { userId: string; socialIntensity: string; name: string };
      maxSpeakers: number;
    },
  ) {}

  async receive(input: EventInput): Promise<SocietyEvent> {
    if (!ALL_TYPES.has(input.eventType)) {
      throw new ValidationError(`Unknown event type: ${input.eventType}`);
    }
    const now = this.deps.clock.now();
    const eventId = id("ev");
    const event: SocietyEvent = {
      id: eventId,
      eventType: input.eventType,
      actorId: input.actorId ?? null,
      personIds: input.personIds ?? [],
      circleId: input.circleId ?? null,
      payload: input.payload ?? {},
      status: "created",
      source: input.source ?? "system",
      stages: ["created"],
      createdAt: now,
      processedAt: null,
    };
    this.insertEvent(event);

    this.bumpStage(event, "validated");

    let candidatePersonIds = event.personIds;
    if (event.circleId && candidatePersonIds.length === 0) {
      candidatePersonIds = this.deps.circles.memberPersonIds(event.circleId);
    }

    if (INTERACTION_TYPES.includes(event.eventType)) {
      const result = await this.deps.director.directScene(event, candidatePersonIds);
      event.payload = {
        ...event.payload,
        sceneResult: {
          output: result.output,
          selected: result.selected.map((s) => s.personId),
          fallbackUsed: result.fallbackUsed,
          blockedReason: result.blockedReason,
          skipped: result.skipped ?? false,
        },
      };
      if (result.skipped) {
        event.status = "no_action";
        this.bumpStage(event, "skipped");
      } else if (result.selected.length === 0) {
        event.status = "silent";
      } else if (result.fallbackUsed) {
        event.status = "deterministic_fallback";
      } else {
        event.status = "persisted";
      }
      this.bumpStage(event, "scored");
      this.bumpStage(event, "selected");
      this.bumpStage(event, "context_compiled");
      this.bumpStage(event, "inference_attempted");
      this.bumpStage(event, "output_validated");
      this.bumpStage(event, "persisted");

      // Serendipity may introduce a new face only after a real scene.
      if (!result.fallbackUsed && !result.skipped && result.selected.length > 0) {
        const outcome = this.deps.serendipity.consider({
          matchingCircleId: event.circleId,
          userSocialIntensity: this.deps.userInfo.socialIntensity,
        });
        if (outcome.fired && outcome.person) {
          this.deps.timeline.append({
            personId: outcome.person.id,
            circleId: event.circleId,
            eventId: event.id,
            kind: "introduction",
            content: `${outcome.person.name} drifted into view.`,
          });
          await this.receive({
            eventType: "INTRODUCTION_CANDIDATE",
            actorId: event.actorId,
            personIds: [outcome.person.id],
            circleId: event.circleId,
            payload: { introducedBy: "serendipity", personId: outcome.person.id },
            source: "serendipity",
          });
        }
      }
    } else {
      this.applyBookkeeping(event);
      this.bumpStage(event, "persisted");
      event.status = "persisted";
    }

    event.processedAt = this.deps.clock.now();
    event.status = event.status ?? "processed";
    this.updateEvent(event);
    return event;
  }

  /** Human message entry point. Chooses direct vs group deterministically. */
  async processUserMessage(
    message: string,
    opts: { circleId?: string | null; personIds?: string[] } = {},
  ): Promise<SocietyEvent> {
    const { circleId, personIds } = opts;
    if (circleId) {
      return this.receive({
        eventType: "GROUP_INTERACTION",
        actorId: this.deps.userInfo.userId,
        circleId,
        personIds: [],
        payload: { message },
        source: "user",
      });
    }
    if (personIds && personIds.length > 0) {
      return this.receive({
        eventType: "DIRECT_INTERACTION",
        actorId: this.deps.userInfo.userId,
        personIds,
        payload: { message },
        source: "user",
      });
    }
    // deterministic fallback: talk to the most-active known person
    const all = this.deps.persons.list(1000, 0);
    const sorted = all
      .map((p) => ({ p, last: p.lastActiveAt ?? 0 }))
      .sort((a, b) => b.last - a.last);
    const mostRecent = sorted[0];
    if (!mostRecent) {
      return this.receive({
        eventType: "USER_MESSAGE",
        actorId: this.deps.userInfo.userId,
        personIds: [],
        payload: { message },
        source: "user",
      });
    }
    return this.receive({
      eventType: "DIRECT_INTERACTION",
      actorId: this.deps.userInfo.userId,
      personIds: [mostRecent.p.id],
      payload: { message },
      source: "user",
    });
  }

  /** Process due scheduled followups. Each is one event; default zero inference. */
  async tick(now?: number): Promise<number> {
    const at = now ?? this.deps.clock.now();
    const due = this.dueFollowups(at);
    let processed = 0;
    for (const row of due) {
      this.deps.db
        .prepare("UPDATE followups SET status = 'processed' WHERE id = ?")
        .run(row.id);
      const circleId =
        this.deps.circles.circlesFor(row.person_id)[0]?.id ?? null;
      await this.receive({
        eventType: "SCHEDULED_FOLLOWUP",
        actorId: null,
        personIds: [row.person_id],
        circleId,
        payload: { reason: row.reason },
        source: "scheduler",
      });
      processed += 1;
    }
    return processed;
  }

  dueFollowups(now: number): Array<{ id: string; person_id: string; reason: string }> {
    const rows = this.deps.db
      .prepare("SELECT id, person_id, reason FROM followups WHERE status = 'pending' AND fire_at <= ?")
      .all(now) as Array<{ id: string; person_id: string; reason: string }>;
    return rows;
  }

  private applyBookkeeping(event: SocietyEvent): void {
    switch (event.eventType) {
      case "RELATIONSHIP_EVENT": {
        const { personA, personB, dimsDelta } = event.payload as {
          personA?: string;
          personB?: string;
          dimsDelta?: Record<string, number>;
        };
        if (personA && personB && dimsDelta) {
          this.deps.relationships.update(personA, personB, dimsDelta);
        }
        break;
      }
      case "TIMELINE_EVENT": {
        const { personId, circleId, kind, content } = event.payload as {
          personId?: string;
          circleId?: string;
          kind?: string;
          content?: string;
        };
        this.deps.timeline.append({
          personId: personId ?? null,
          circleId: (circleId as string | null) ?? event.circleId,
          eventId: event.id,
          kind: kind ?? "note",
          content: content ?? "",
        });
        break;
      }
      case "CONTEXT_CHANGE": {
        const { personId } = event.payload as { personId?: string };
        if (personId) this.deps.persons.touch(personId);
        break;
      }
      case "INTRODUCTION_CANDIDATE": {
        const { personId, content } = event.payload as { personId?: string; content?: string };
        if (personId) {
          this.deps.timeline.append({
            personId,
            circleId: event.circleId,
            eventId: event.id,
            kind: "introduction",
            content: content ?? "appeared in the circle.",
          });
        }
        break;
      }
      case "SESSION_START":
      case "SESSION_END": {
        this.deps.timeline.append({
          personId: event.actorId,
          circleId: event.circleId,
          eventId: event.id,
          kind: "session",
          content: `${event.eventType === "SESSION_START" ? "session started" : "session ended"}`,
        });
        break;
      }
      case "PROACTIVE_CANDIDATE": {
        // Auditable NO_ACTION ledger: verdicts are deterministic and cost $0.
        const { personId, verdict, score } = event.payload as {
          personId?: string;
          verdict?: string;
          score?: number;
        };
        if (personId && verdict) {
          this.deps.timeline.append({
            personId,
            circleId: event.circleId,
            eventId: event.id,
            kind: "proactive",
            content: `candidate ${verdict} (score ${score?.toFixed(1) ?? "?"})`,
          });
        }
        break;
      }
      case "LANDMARK_EVENT": {
        // Landmark storage happens through MemoryService at the call site
        // (needs person A + person B scopes). This event is a durable audit
        // trail only.
        break;
      }
      default:
        break;
    }
  }

  private bumpStage(event: SocietyEvent, stage: SocietyEvent["stages"][number]): void {
    if (!event.stages.includes(stage)) event.stages.push(stage);
  }

  private insertEvent(event: SocietyEvent): void {
    this.deps.db
      .prepare(
        `INSERT INTO events (id, event_type, actor_id, person_ids_json, circle_id, payload_json, status, source, stages_json, created_at, processed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        event.id,
        event.eventType,
        event.actorId,
        json(event.personIds),
        event.circleId,
        json(event.payload),
        event.status,
        event.source,
        json(event.stages),
        event.createdAt,
        event.processedAt,
      );
  }

  private updateEvent(event: SocietyEvent): void {
    this.deps.db
      .prepare(
        "UPDATE events SET status = ?, payload_json = ?, stages_json = ?, processed_at = ? WHERE id = ?",
      )
      .run(
        event.status,
        json(event.payload),
        json(event.stages),
        event.processedAt,
        event.id,
      );
  }
}