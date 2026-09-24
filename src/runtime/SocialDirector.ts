import type { Clock } from "../god/clock.ts";
import type { SocietyDB } from "../god/db.ts";
import { id } from "../god/id.ts";
import type { PersonService } from "../people";
import type { TimelineService } from "../events";
import type { MemoryService } from "../memory";
import type { RelationshipService } from "../relationships";
import type { IntelligenceGateway } from "../intelligence/IntelligenceGateway.ts";
import type { ParticipantSelector, SelectedParticipant } from "./ParticipantSelector.ts";
import type { ContextCompiler } from "./ContextCompiler.ts";
import type { SyntheticActorRuntime } from "./SyntheticActorRuntime.ts";
import type { SceneRenderer, ModelClass, SceneOutput, SocietyEvent } from "../god/types.ts";
import { parseSceneOutput } from "./SceneRenderer.ts";

export interface SceneResult {
  output: SceneOutput;
  selected: SelectedParticipant[];
  fallbackUsed: boolean;
  blockedReason: string | null;
  estimatedTokens: number;
  /** Present when a candidate event was deliberately skipped by social pacing. */
  skipped?: boolean;
}

const MAX_MESSAGE_LENGTH = 300;

/**
 * SocialDirector composes a scene: deterministic participant selection →
 * context compilation → at most ONE generation request → deterministic
 * validation → persistence of memory/relationship/timeline/followup
 * candidates. A group chat is a single inference, not one call per character.
 */
export class SocialDirector {
  constructor(
    private readonly deps: {
      db: SocietyDB;
      clock: Clock;
      selector: ParticipantSelector;
      compiler: ContextCompiler;
      actors: SyntheticActorRuntime;
      gateway: IntelligenceGateway;
      renderer: SceneRenderer;
      persons: PersonService;
      timeline: TimelineService;
      memory: MemoryService;
      relationships: RelationshipService;
      sceneModelClass: ModelClass;
      userInfo: { userId: string; name: string };
      hardMaxSpeakers: number;
      /** Social pacing: candidate events below this proactive score become NO_ACTION. */
      minProactiveScore: number;
    },
  ) {}

  async directScene(
    event: SocietyEvent,
    candidatePersonIds: string[],
  ): Promise<SceneResult> {
    const circleId = event.circleId;
    const actorMessage: string =
      typeof event.payload?.message === "string" ? event.payload.message : "";
    const actorPersonId = event.actorId;

    const circleMemberIds = circleId
      ? this.deps.db
          .prepare("SELECT member_id FROM circle_members WHERE circle_id = ?")
          .all(circleId)
          .map((r) => (r as { member_id: string }).member_id)
      : [];

    // silence is valid: no eligible participants -> no scene, no inference
    const selected = this.deps.selector.select({
      eventId: event.id,
      candidatePersonIds,
      circleId,
      actorMessage,
      circleMemberIds,
    });
    const empty: SceneOutput = {
      messages: [],
      memoryCandidates: [],
      relationshipCandidates: [],
      timelineCandidates: [],
      followups: [],
    };

    // SOCIAL PACING: candidate/reach events (never user-initiated scenes) must
    // clear the relevance gate or they terminate with NO_ACTION, deterministically.
    const candidateEvent = event.eventType === "PROACTIVE_REACH" || event.eventType === "CIRCLE_EVENT";
    const pacingScore =
      typeof event.payload?.pacingScore === "number" ? (event.payload.pacingScore as number) : null;
    if (candidateEvent && (pacingScore === null || pacingScore < this.deps.minProactiveScore)) {
      return {
        output: empty,
        selected,
        fallbackUsed: false,
        blockedReason: "NO_ACTION:pacing",
        estimatedTokens: 0,
        skipped: true,
      };
    }

    if (selected.length === 0) {
      return {
        output: empty,
        selected,
        fallbackUsed: false,
        blockedReason: null,
        estimatedTokens: 0,
      };
    }

    const sceneCtx = this.deps.compiler.buildScene({
      eventId: event.id,
      eventType: event.eventType,
      participants: selected,
      circleId,
      actorMessage,
      actorId: actorPersonId,
      actorUserId: this.deps.userInfo.userId,
      actorName: this.deps.userInfo.name,
    });

    // Scheduled/background events default to ZERO inference. Preflight the
    // budget; if disallowed, the scene resolves to silence (deterministic).
    if (event.eventType === "SCHEDULED_FOLLOWUP") {
      const canInfer = this.deps.gateway.getBudget().canReserve({
        eventId: event.id,
        reason: "scene",
        reasonKind: "background",
        modelClass: this.deps.sceneModelClass,
        estimatedInputTokens: sceneCtx.estimatedTokens,
        estimatedOutputTokens: 800,
      });
      if (!canInfer) {
        return {
          output: empty,
          selected,
          fallbackUsed: true,
          blockedReason: "background inference disabled",
          estimatedTokens: sceneCtx.estimatedTokens,
        };
      }
    }

    // materialize ephemeral actors for the selected speakers only
    for (const p of selected) {
      this.deps.actors.materialize({
        personId: p.personId,
        eventId: event.id,
        participantIds: selected.map((s) => s.personId),
        circleId,
      });
    }

    let output: SceneOutput;
    let fallbackUsed = false;
    let blockedReason: string | null = null;

    try {
      const composed = new Map<string, ReturnType<typeof this.deps.actors.composeActorContext>>();
      for (const s of selected) {
        composed.set(
          s.personId,
          this.deps.actors.composeActorContext(
            s.personId,
            event.id,
            selected.map((x) => x.personId),
            circleId,
          ),
        );
      }
      const rendered = await this.deps.renderer.renderScene({
        event,
        selectedPeople: selected.map((s) => ({
          personId: s.personId,
          score: s.score,
          reasons: s.reasons,
        })),
        activeRoles: Object.fromEntries(
          selected.map((s) => [s.personId, composed.get(s.personId)!.roles]),
        ),
        relationshipContext: Object.fromEntries(
          selected.map((s) => [s.personId, composed.get(s.personId)!.relationships]),
        ),
        relevantMemories: Object.fromEntries(
          selected.map((s) => [s.personId, composed.get(s.personId)!.memories]),
        ),
        outputBudget: {
          maxMessages: this.deps.hardMaxSpeakers,
          maxTokens: 2_000,
        },
        circle: circleId ? { id: circleId, name: null } : null,
      });
      output = rendered.output;
    } catch (err) {
      // FAIL CLOSED: continue deterministic operation, block inference.
      fallbackUsed = true;
      blockedReason =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      output = this.fallbackCompose(selected);
    }

    const validated = this.validateSceneOutput(output, selected);
    this.persistCandidates(event, validated);

    return {
      output: validated,
      selected,
      fallbackUsed,
      blockedReason,
      estimatedTokens: sceneCtx.estimatedTokens,
    };
  }

  /**
   * Pure-code fallback used when inference is blocked (kill switch, budget,
   * unavailable model, recursion). Zero provider calls — deterministic only.
   */
  private fallbackCompose(selected: SelectedParticipant[]): SceneOutput {
    const acknowledgments = [
      (name: string) => `${name}: "Noted — I'm here."`,
      (name: string) => `${name}: "I'll pick this up next time."`,
      (name: string) => `${name}: "On it."`,
    ];
    return {
      messages: selected.slice(0, this.deps.hardMaxSpeakers).map((s, i) => {
        const person = this.deps.persons.get(s.personId);
        const name = person?.name ?? s.personId;
        const line = acknowledgments[i % acknowledgments.length] ?? acknowledgments[0]!;
        return { personId: s.personId, text: line(name) };
      }),
      memoryCandidates: [],
      relationshipCandidates: [],
      timelineCandidates: [],
      followups: [],
    };
  }

  /**
   * Deterministic validation of model output. Never invoke another LLM to
   * evaluate the first LLM — plain code checks are used instead.
   */
  validateSceneOutput(
    output: SceneOutput,
    selected: SelectedParticipant[],
  ): SceneOutput {
    const allowed = new Set(selected.map((s) => s.personId));
    const validated: SceneOutput = {
      messages: [],
      memoryCandidates: [],
      relationshipCandidates: [],
      timelineCandidates: [],
      followups: [],
    };

    for (const m of output.messages) {
      if (!allowed.has(m.personId)) continue;
      const text = String(m.text ?? "").trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!text) continue;
      validated.messages.push({ personId: m.personId, text });
      if (validated.messages.length >= this.deps.hardMaxSpeakers) break;
    }

    for (const mc of output.memoryCandidates) {
      if (!allowed.has(mc.personId)) continue;
      if (!["private", "person_user_shared", "circle", "public"].includes(mc.scope))
        continue;
      if (!String(mc.content ?? "").trim()) continue;
      validated.memoryCandidates.push(mc);
    }

    for (const rc of output.relationshipCandidates) {
      if (!allowed.has(rc.personA)) continue;
      if (!allowed.has(rc.personB)) continue;
      if (rc.personA === rc.personB) continue;
      validated.relationshipCandidates.push(rc);
    }

    for (const tc of output.timelineCandidates) {
      if (!allowed.has(tc.personId)) continue;
      if (!String(tc.content ?? "").trim()) continue;
      validated.timelineCandidates.push(tc);
    }

    for (const fc of output.followups) {
      if (!allowed.has(fc.personId)) continue;
      const delay = Number(fc.delayMs);
      if (!Number.isFinite(delay) || delay < 60_000 || delay > 90 * 86_400_000)
        continue;
      if (!String(fc.reason ?? "").trim()) continue;
      validated.followups.push({ personId: fc.personId, delayMs: delay, reason: fc.reason });
    }

    return validated;
  }

  private persistCandidates(event: SocietyEvent, output: SceneOutput): void {
    for (const m of output.messages) {
      const speaker = this.deps.persons.get(m.personId);
      const name = speaker?.name ?? m.personId;
      this.deps.timeline.append({
        personId: m.personId,
        circleId: event.circleId,
        eventId: event.id,
        kind: "message",
        content: `${name}: ${m.text}`,
      });
      this.deps.persons.touch(m.personId);
    }
    this.deps.memory.applyCandidates(
      output.memoryCandidates.map((mc) => ({ ...mc, source: `event:${event.id}` })),
    );
    this.deps.relationships.applyCandidates(output.relationshipCandidates);
    this.deps.timeline.appendMany(
      output.timelineCandidates.map((tc) => ({
        personId: tc.personId,
        circleId: event.circleId,
        eventId: event.id,
        kind: tc.kind,
        content: tc.content,
      })),
    );
    this.scheduleFollowups(event, output.followups);
  }

  private scheduleFollowups(
    event: SocietyEvent,
    followups: SceneOutput["followups"],
  ): void {
    for (const f of followups) {
      this.deps.db
        .prepare(
          "INSERT INTO followups (id, person_id, event_id, reason, fire_at, status, created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          id("fu"),
          f.personId,
          event.id,
          f.reason,
          this.deps.clock.now() + f.delayMs,
          "pending",
          this.deps.clock.now(),
        );
    }
  }
}