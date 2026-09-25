/**
 * GOD v2 BRIDGE
 *
 * The stable interface between ONE external God GrokBot and the Society runtime.
 *
 * Non-negotiable properties, enforced here and proven by tests:
 *  - God sends a TINY event. Society decides event id, circle, participants,
 *    roles, memories, relationships, participant count and context slice.
 *  - At most ONE God inference per event. A second submit for the same event is
 *    refused structurally, not by policy.
 *  - Recursion is impossible: applying a result NEVER creates another job.
 *  - Every external inference is budgeted and recorded through the existing
 *    BudgetGovernor + TelemetryService, i.e. the IntelligenceGateway ledger.
 *    The bridge does not bypass it.
 *  - God receives ONLY the current relevant scene: bounded participants,
 *    bounded relationships, bounded memories — never the database.
 *  - One God invocation may render SEVERAL persons. Several speakers is never
 *    several calls.
 *  - God failure degrades to the deterministic fallback; the society keeps working.
 */

import type { GodKernel } from "../god/GodKernel.ts";
import type { Clock } from "../god/clock.ts";
import { id } from "../god/id.ts";
import { RELATIONSHIP_DIMENSIONS, type ModelClass, type SceneOutput, type SocietyEvent } from "../god/types.ts";
import { estimateCost, estimateTokens } from "../telemetry/TelemetryService.ts";
import {
  GodBridgeError,
  type CostClass,
  type GodCallUsage,
  type GodEventInput,
  type GodInput,
  type GodInputAccounting,
  type GodJob,
  type GodMemory,
  type GodParticipant,
  type GodRelationship,
  type GodResult,
  type SocialCostMetrics,
} from "./types.ts";

/** Smallest useful scene. Conservative by design. */
export const GOD_LIMITS = {
  maxCallsPerEvent: 1,
  recursionDepth: 0,
  backgroundCalls: 0,
  maxRetries: 0,
  maxSpeakers: 3,
  maxOutputTokens: 400,
  maxRelationshipsPerPerson: 4,
  maxMemoriesPerPerson: 5,
} as const;

export const GOD_OUTPUT_SCHEMA =
  '{"messages":[{"personId":"<one of selected>","text":"<=200 chars"}],' +
  '"memoryCandidates":[],"relationshipCandidates":[],"timelineCandidates":[],"followups":[],' +
  '"usage":{"inputTokens":0,"outputTokens":0}}';

const MAX_MESSAGE_LENGTH = 200;
const MAX_RESULT_ENTRIES = 32;

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0;
}

function validUsageNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function validCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface GodSubmitOutcome {
  status: "needs_god" | "no_inference";
  job?: GodJob;
  event?: SocietyEvent;
  /** when no inference is warranted, this is the deterministic answer */
  deterministic?: SceneOutput;
  costClass: CostClass;
  reason: string;
}

/** Deterministic job identity: recoverable from the persisted event alone. */
export function godJobId(eventId: string): string {
  return `godjob_${eventId}`;
}

function stripJobPrefix(id: string): string {
  return id.startsWith("godjob_") ? id.slice("godjob_".length) : id;
}

function cloneJob(job: GodJob): GodJob {
  return structuredClone(job);
}

export class GodBridge {
  private readonly jobs = new Map<string, GodJob>();
  private readonly jobsByEvent = new Map<string, string>();

  constructor(
    private readonly kernel: GodKernel,
    private readonly clock: Clock,
    private readonly modelClass: "grok" | "chatgpt" = "grok",
    /**
     * The bridge is OFF by default. Zero-Grok operation is the invariant: a
     * society with no God attached must stay fully functional. It is enabled
     * explicitly by the operator, never automatically.
     */
    private readonly enabled = false,
    /**
     * "dry" = no external provider is ever contacted; the bridge validates and
     * persists a locally-produced result and records $0. "live" = an external
     * Grok process performed the inference and real token accounting applies.
     */
    private readonly mode: "dry" | "live" = "dry",
  ) {}

  // ── phase 1: God hands over a tiny event ──────────────────────────────

  /**
   * Accept a tiny event from God. Society decides everything else. If an
   * inference is warranted, a job is created holding the bounded GodInput and
   * the caller must hand that input to the God process.
   */
  async submit(input: GodEventInput): Promise<GodSubmitOutcome> {
    const event = this.parseEvent(input);
    if (this.kernel.isPaused()) {
      throw new GodBridgeError("PAUSED", "society is paused — resume before submitting");
    }

    // kill switch fails closed exactly like every other inference path
    if (this.kernel.config.intelligence.killSwitch) {
      this.kernel.budget.countBlocked("GodBridge:killSwitch");
      return {
        status: "no_inference",
        event,
        costClass: "NO_INFERENCE",
        reason: "KillSwitch: inference blocked; deterministic fallback only",
        deterministic: this.fallbackFor([]),
      };
    }

    // The bridge is opt-in. With it off, the ordinary deterministic scene runs
    // and the society is fully functional without any God attached.
    if (!this.enabled || this.isZeroCostRoute()) {
      const scene = await this.kernel.events.processUserMessage(String(event.payload.message ?? ""), {
        circleId: event.circleId,
        personIds: event.personIds ?? undefined,
      });
      const output = this.sceneOutputOf(scene);
      return {
        status: "no_inference",
        event: scene,
        costClass: output ? "DETERMINISTIC" : "NO_INFERENCE",
        reason: this.enabled ? "zero-cost route; deterministic path only" : "god bridge disabled; deterministic path only",
        ...(output ? { deterministic: output } : {}),
      };
    }

    // Persist the event WITHOUT rendering it. The external God inference IS the
    // render for this event, so the deterministic renderer must not run first.
    const created = this.insertPendingEvent(event);
    event.id = created.id;

    // ONE job per event — structural, not advisory
    const existing = this.jobsByEvent.get(created.id);
    if (existing) {
      throw new GodBridgeError(
        "DUPLICATE_CALL",
        `event ${created.id} already has a God job (${existing}); one inference per event`,
      );
    }

    const godInput = this.buildInput(event);
    if (godInput.participants.length === 0) {
      this.finalizeEvent(created.id, "silent", undefined);
      return {
        status: "no_inference",
        event: created,
        costClass: "NO_INFERENCE",
        reason: "no eligible participants; silence is a valid answer",
        deterministic: this.fallbackFor([]),
      };
    }

    // Budget preflight happens before God is allowed to think.
    const estimatedCost = this.mode === "live"
      ? this.estimatedCost(godInput.accounting.estimatedTokens, GOD_LIMITS.maxOutputTokens)
      : 0;
    const reserve = this.mode === "live"
      ? this.kernel.gateway.getBudget().canReserve({
        eventId: created.id,
        reason: `god bridge: ${godInput.scene}`,
        reasonKind: "foreground",
        modelClass: this.bridgeModelClass(),
        estimatedInputTokens: godInput.accounting.estimatedTokens,
        estimatedOutputTokens: GOD_LIMITS.maxOutputTokens,
        estimatedCost,
      })
      : true;
    if (!reserve) {
      this.finalizeEvent(created.id, "deterministic_fallback", undefined);
      return {
        status: "no_inference",
        event: created,
        costClass: "NO_INFERENCE",
        reason: "budget refused the external inference; deterministic fallback only",
        deterministic: this.fallbackFor(godInput.participants.map((p) => p.personId)),
      };
    }

    const job: GodJob = {
      // deterministic: the CLI runs each phase in a fresh process, so the job
      // identity must be derivable from the persisted event alone.
      id: godJobId(created.id),
      eventId: created.id,
      status: "AWAITING_GOD",
      createdAt: this.clock.now(),
      mode: this.mode,
      modelClass: this.modelClass,
      selectedPersonIds: godInput.participants.map((p) => p.personId),
      input: godInput,
    };
    this.jobs.set(job.id, job);
    this.jobsByEvent.set(created.id, job.id);
    this.persistJobSnapshot(job);
    return {
      status: "needs_god",
      job: cloneJob(job),
      event: created,
      costClass: this.mode === "dry" ? "DETERMINISTIC" : this.modelClass === "grok" ? "GROK" : "CHATGPT",
      reason: godInput.scene,
    };
  }

  // ── phase 2: God returns structured deltas ───────────────────────────

  /**
   * Apply a God result. Validates against the job's selected participants,
   * records full cost accounting, and persists the deltas into Society state.
   * Never creates another job — recursion is structurally impossible.
   */
  apply(result: GodResult): {
    job: GodJob;
    event: SocietyEvent | null;
    costClass: CostClass;
    usage: GodCallUsage;
    applied: boolean;
    reason: string;
  } {
    if (!result || typeof result !== "object" || typeof result.jobId !== "string" || typeof result.eventId !== "string") {
      throw new GodBridgeError("BAD_RESULT", "jobId and eventId are required");
    }
    const job = this.jobs.get(result.jobId) ?? this.rehydrate(result.eventId ?? stripJobPrefix(result.jobId));
    if (!job) {
      throw new GodBridgeError("UNKNOWN_JOB", `unknown God job ${result.jobId}`);
    }
    if (job.id !== result.jobId) {
      throw new GodBridgeError("JOB_MISMATCH", `result jobId ${result.jobId} != ${job.id}`);
    }
    if (job.status !== "AWAITING_GOD") {
      throw new GodBridgeError("JOB_CLOSED", `job ${job.id} is already ${job.status}`);
    }
    if (this.kernel.isPaused()) {
      throw new GodBridgeError("PAUSED", "society is paused — resume before applying a result");
    }
    if (this.kernel.config.intelligence.killSwitch) {
      throw new GodBridgeError("KILL_SWITCH", "KillSwitch: inference blocked; result was not applied");
    }
    if (result.eventId !== job.eventId) {
      throw new GodBridgeError("EVENT_MISMATCH", `result eventId ${result.eventId} != job eventId ${job.eventId}`);
    }
    if (result.confidence !== undefined && (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1)) {
      throw new GodBridgeError("BAD_RESULT", "confidence must be between 0 and 1");
    }

    const { output, dropped } = this.validateResult(job.selectedPersonIds, result);
    const usage = this.kernel.db.transaction(() => {
      this.persistCandidates(job.eventId, output);
      const recorded = this.recordUsage(job, result, output, dropped);
      this.finalizeEvent(job.eventId, "persisted", {
        output,
        selected: job.selectedPersonIds,
        fallbackUsed: false,
        blockedReason: null,
        skipped: false,
        viaGodBridge: true,
      });
      this.attachUsage(job.eventId, recorded);
      job.status = "COMPLETED";
      job.result = result;
      job.usage = recorded;
      this.persistJobSnapshot(job);
      return recorded;
    });

    const event = this.eventOf(job.eventId);
    return {
      job: cloneJob(job),
      event,
      costClass: job.mode === "dry" ? "DETERMINISTIC" : job.modelClass === "grok" ? "GROK" : "CHATGPT",
      usage,
      applied: true,
      reason: dropped > 0
        ? `${output.messages.length} messages applied, ${dropped} invalid or unselected entries dropped`
        : `${output.messages.length} messages applied`,
    };
  }

  /**
   * Rebuild a job from persisted state. The CLI runs each phase in a new
   * process, so a job is reconstructible from its event alone — no extra table,
   * no hidden runtime state.
   */
  rehydrate(eventId: string): GodJob | undefined {
    const cached = this.jobs.get(godJobId(eventId)) ?? [...this.jobs.values()].find((j) => j.eventId === eventId);
    if (cached) return cached;
    const event = this.eventOf(eventId);
    if (!event) return undefined;
    const snapshot = (event.payload?.godJob ?? undefined) as Partial<GodJob> | undefined;
    if (snapshot?.input && snapshot.id && snapshot.eventId) {
      const normalized: GodJob = {
        ...snapshot,
        id: snapshot.id,
        eventId: snapshot.eventId,
        status: event.status === "persisted" || event.status === "deterministic_fallback"
          ? "COMPLETED"
          : snapshot.status ?? "AWAITING_GOD",
        createdAt: snapshot.createdAt ?? event.createdAt,
        mode: snapshot.mode ?? this.mode,
        modelClass: snapshot.modelClass ?? this.modelClass,
        selectedPersonIds: snapshot.selectedPersonIds ?? [],
      } as GodJob;
      this.jobs.set(normalized.id, normalized);
      this.jobsByEvent.set(eventId, normalized.id);
      return normalized;
    }
    return undefined;
  }

  /** Inspect what Society decided for an event — the audit view for God. */
  context(jobIdOrEventId: string): GodInput {
    const job =
      this.jobs.get(jobIdOrEventId) ??
      [...this.jobs.values()].find((j) => j.eventId === jobIdOrEventId) ??
      this.rehydrate(jobIdOrEventId) ??
      this.rehydrate(stripJobPrefix(jobIdOrEventId));
    if (!job) {
      throw new GodBridgeError("UNKNOWN_JOB", `no God job for ${jobIdOrEventId}`);
    }
    return structuredClone(job.input);
  }

  job(id: string): GodJob | undefined {
    const cached = this.jobs.get(id);
    if (cached) return cloneJob(cached);
    const rehydrated = this.rehydrate(stripJobPrefix(id));
    return rehydrated ? cloneJob(rehydrated) : undefined;
  }

  jobsList(): GodJob[] {
    const rows = this.kernel.db.prepare("SELECT id, payload_json FROM events WHERE payload_json LIKE '%\"godJob\"%'").all() as Array<{ id: string; payload_json: string }>;
    for (const row of rows) this.rehydrate(row.id);
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(cloneJob);
  }

  health(): Record<string, unknown> {
    const k = this.kernel;
    return {
      ok: true,
      bridge: "god-v2",
      enabled: this.enabled,
      mode: this.mode,
      modelClass: this.modelClass,
      limits: GOD_LIMITS,
      safety: {
        maxCallsPerEvent: GOD_LIMITS.maxCallsPerEvent,
        recursionDepth: GOD_LIMITS.recursionDepth,
        backgroundCalls: GOD_LIMITS.backgroundCalls,
        maxRetries: GOD_LIMITS.maxRetries,
        proactivePaidInference: k.config.society.proactive.enabled && k.config.society.proactive.budgetPerDay > 0,
        backgroundLifeSimulation: k.config.intelligence.budget.backgroundModelCalls > 0,
      },
      runtime: {
        paused: k.isPaused(),
        killSwitch: k.config.intelligence.killSwitch,
        zeroCostRoute: this.isZeroCostRoute(),
        sceneModelClass: k.config.intelligence.sceneModelClass,
      },
      pendingJobs: this.jobsList().filter((j) => j.status === "AWAITING_GOD").length,
      state: k.stats(),
    };
  }

  /** Cost-per-social-value metrics across every layer. */
  usage(): SocialCostMetrics {
    return collectSocialCostMetrics(this.kernel, this.jobsList(), this.clock.now());
  }

  // ── internals ────────────────────────────────────────────────────────

  /**
   * Insert the event in `created` state without rendering it. The external
   * process is the renderer, so the ordinary director must not run first — but
   * the row, the schema and the audit trail are exactly the same.
   */
  private insertPendingEvent(event: SocietyEvent): SocietyEvent {
    const eventId = id("ev_god");
    const row: SocietyEvent = {
      ...event,
      id: eventId,
      status: "created",
      source: "god-bridge",
      stages: ["created"],
      createdAt: this.clock.now(),
      processedAt: null,
    };
    this.kernel.db
      .prepare(
        `INSERT INTO events (id, event_type, actor_id, person_ids_json, circle_id, payload_json, status, source, stages_json, created_at, processed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.eventType,
        row.actorId,
        JSON.stringify(row.personIds),
        row.circleId,
        JSON.stringify({ ...row.payload, awaitingGod: true }),
        row.status,
        row.source,
        JSON.stringify(row.stages),
        row.createdAt,
        null,
      );
    return row;
  }

  /**
   * Persist the exact GodJob on the event so the package is reproducible and
   * auditable across processes. The operator can always see precisely what God
   * was given, even if Society state changes afterwards.
   */
  private persistJobSnapshot(job: GodJob): void {
    const row = this.kernel.db.prepare("SELECT payload_json, stages_json FROM events WHERE id = ?").get(job.eventId) as
      | { payload_json: string; stages_json: string }
      | undefined;
    if (!row) return;
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    payload.godJob = { ...job };
    const stages = job.status === "COMPLETED"
      ? ["created", "validated", "selected", "context_compiled", "inference_attempted", "output_validated", "persisted"]
      : JSON.parse(row.stages_json ?? "[]") as string[];
    this.kernel.db
      .prepare("UPDATE events SET person_ids_json = ?, payload_json = ?, stages_json = ? WHERE id = ?")
      .run(
        JSON.stringify(job.selectedPersonIds),
        JSON.stringify(payload),
        JSON.stringify(stages),
        job.eventId,
      );
  }

  /**
   * Persist the full call accounting on the event. This is what makes offline
   * miss analysis possible later WITHOUT spending another Grok call.
   */
  private attachUsage(eventId: string, usage: GodCallUsage): void {
    const row = this.kernel.db.prepare("SELECT payload_json FROM events WHERE id = ?").get(eventId) as
      | { payload_json: string }
      | undefined;
    if (!row) return;
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    payload.godCall = usage;
    this.kernel.db.prepare("UPDATE events SET payload_json = ? WHERE id = ?").run(JSON.stringify(payload), eventId);
  }

  /** Close the event with a terminal status, exactly like the director does. */
  private finalizeEvent(id: string, status: string, sceneResult?: unknown): void {
    const row = this.kernel.db.prepare("SELECT payload_json FROM events WHERE id = ?").get(id) as
      | { payload_json: string }
      | undefined;
    const payload = row ? (JSON.parse(row.payload_json) as Record<string, unknown>) : {};
    if (sceneResult) payload.sceneResult = sceneResult;
    delete payload.awaitingGod;
    this.kernel.db
      .prepare("UPDATE events SET status = ?, payload_json = ?, stages_json = ?, processed_at = ? WHERE id = ?")
      .run(
        status,
        JSON.stringify(payload),
        JSON.stringify(["created", "validated", "selected", "context_compiled", "inference_attempted", "output_validated", status]),
        this.clock.now(),
        id,
      );
  }

  private parseEvent(input: GodEventInput): SocietyEvent {
    if (!input || typeof input !== "object") throw new GodBridgeError("BAD_EVENT", "event must be an object");
    if (input.type !== "USER_MESSAGE" && input.type !== "DIRECT_INTERACTION" && input.type !== "GROUP_INTERACTION") {
      throw new GodBridgeError("BAD_EVENT", `unsupported event type ${String(input.type)}`);
    }
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) throw new GodBridgeError("BAD_EVENT", "text is required");
    if (text.length > 2_000) throw new GodBridgeError("BAD_EVENT", "text exceeds 2000 characters");
    if (input.circleId !== undefined && (typeof input.circleId !== "string" || input.circleId.length > 256)) {
      throw new GodBridgeError("BAD_EVENT", "circleId must be a bounded string");
    }
    if (input.personIds !== undefined && (!Array.isArray(input.personIds) || input.personIds.length > 1_000)) {
      throw new GodBridgeError("BAD_EVENT", "personIds must be a bounded array");
    }
    const personIds = Array.isArray(input.personIds)
      ? [...new Set(input.personIds.filter((personId): personId is string => typeof personId === "string" && personId.length <= 128))]
      : [];
    return {
      id: "",
      eventType: input.type,
      actorId: this.kernel.getUserInfo().userId,
      personIds,
      circleId: input.circleId ?? null,
      payload: { message: text, via: "god-bridge" },
      status: "created",
      source: "god",
      stages: [],
      createdAt: this.clock.now(),
    } as unknown as SocietyEvent;
  }

  private bridgeModelClass(modelClass: "grok" | "chatgpt" = this.modelClass): ModelClass {
    return modelClass === "grok" ? "social.deep" : "social.standard";
  }

  private estimatedCost(
    inputTokens: number,
    outputTokens: number,
    modelClass: "grok" | "chatgpt" = this.modelClass,
  ): number {
    return estimateCost(
      this.bridgeModelClass(modelClass),
      inputTokens,
      outputTokens,
      this.kernel.config.intelligence.costPer1kOutputTokens,
    );
  }

  private isZeroCostRoute(): boolean {
    const cls = this.kernel.config.intelligence.sceneModelClass;
    return cls === "social.mock" || cls === "social.deterministic";
  }

  /**
   * Build the bounded GodInput. Society — not God — decides participants,
   * context slice, and the reason for every inclusion/exclusion.
   */
  private buildInput(event: SocietyEvent): GodInput {
    const k = this.kernel;
    const selected = this.selectedFor(event);
    const participants: GodParticipant[] = [];
    const relationships: GodRelationship[] = [];
    const memories: GodMemory[] = [];

    for (const sel of selected.slice(0, GOD_LIMITS.maxSpeakers)) {
      const person = k.persons.get(sel.personId);
      if (!person) continue;
      const roles = k.roles.assignments(sel.personId);
      const why = sel.reasons?.length ? sel.reasons.join("; ") : "selected by deterministic participant selector";
      participants.push({
        personId: sel.personId,
        name: person.name.slice(0, 80),
        roles: roles.slice(0, 8).map((r) => r.name.slice(0, 80)),
        why: why.slice(0, 240),
        identity: {
          socialIntensity: person.socialIntensity,
          traits: Object.keys(person.personality ?? {}).slice(0, 12).map((trait) => trait.slice(0, 80)),
          interests: person.interests.slice(0, 12).map((interest) => interest.slice(0, 80)),
        },
      });

      const ctx = k.composeActorContext(sel.personId, event.id, selected.map((s) => s.personId), event.circleId);
      for (const rel of ctx.relationships.slice(0, GOD_LIMITS.maxRelationshipsPerPerson)) {
        relationships.push({
          a: sel.personId,
          b: rel.personId,
          dimensions: { ...rel.dims } as unknown as Record<string, number>,
          why: `bounded relationship row for ${sel.personId} (limit ${GOD_LIMITS.maxRelationshipsPerPerson})`,
        });
      }
      for (const mem of ctx.memories.slice(0, GOD_LIMITS.maxMemoriesPerPerson)) {
        memories.push({
          personId: sel.personId,
          content: mem.content.slice(0, 500),
          kind: mem.type.slice(0, 40),
          importance: clamp(mem.importance, 0, 1),
          why: `retrieved memory for ${sel.personId} (limit ${GOD_LIMITS.maxMemoriesPerPerson})`.slice(0, 240),
        });
      }
    }

    const selectedIds = new Set(participants.map((p) => p.personId));
    const populationSize = k.persons.count();

    const scene = `${event.eventType} in ${event.circleId ?? "no circle"} · ${participants.length} speaker(s)`.slice(0, 240);
    const constraints: GodInput["constraints"] = {
      maxSpeakers: GOD_LIMITS.maxSpeakers,
      maxOutputTokens: GOD_LIMITS.maxOutputTokens,
      recursion: 0,
      maxCallsThisEvent: 1,
    };
    const draft: Omit<GodInput, "accounting"> = {
      eventId: event.id,
      scene,
      userMessage: String(event.payload?.message ?? ""),
      participants,
      relationships,
      memories,
      constraints,
      outputSchema: GOD_OUTPUT_SCHEMA,
    };
    const characters = JSON.stringify(draft).length;
    const accounting: GodInputAccounting = {
      characters,
      estimatedTokens: estimateTokens(JSON.stringify(draft)),
      participantCount: participants.length,
      memoryCount: memories.length,
      relationshipCount: relationships.length,
      populationSize,
      excludedCount: Math.max(0, populationSize - selectedIds.size),
      exclusionCriterion: "not selected for this scene; context is per-event, never per-population",
      memoriesIncluded: memories.map((m) => `${m.personId}:${m.content.slice(0, 40)}`),
      participantsIncluded: participants.map((p) => p.personId),
      truncation: [
        `participants capped at ${GOD_LIMITS.maxSpeakers}`,
        `relationships capped at ${GOD_LIMITS.maxRelationshipsPerPerson}/person`,
        `memories capped at ${GOD_LIMITS.maxMemoriesPerPerson}/person`,
        `excluded persons reported as a count only — no roster of the population`,
      ],
    };
    return { ...draft, accounting };
  }

  /**
   * Selection always goes through the canonical ParticipantSelector, so the
   * bridge inherits every existing rule: do-not-disturb, busy, relevance
   * scoring and speaker caps. The bridge never invents its own selection.
   */
  private mostRecentPersonId(): string[] {
    const person = this.kernel.persons
      .list(1_000)
      .sort((a, b) => (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt))[0];
    return person ? [person.id] : [];
  }

  private selectedFor(event: SocietyEvent): { personId: string; reasons?: string[] }[] {
    const persisted = this.persistedSelection(event.id);
    if (persisted.length > 0) return persisted;
    const circleId = event.circleId;
    const candidatePersonIds =
      event.personIds.length > 0
        ? event.personIds
        : circleId
          ? this.kernel.circles.memberPersonIds(circleId)
          : this.mostRecentPersonId();
    if (candidatePersonIds.length === 0) return [];
    return this.kernel.selector.select({
      eventId: event.id,
      candidatePersonIds,
      circleId,
      actorMessage: String(event.payload?.message ?? ""),
      circleMemberIds: circleId ? this.kernel.circles.memberPersonIds(circleId) : [],
    });
  }

  /** Selection already recorded for this event, if any. */
  private persistedSelection(eventId: string): { personId: string; reasons?: string[] }[] {
    const event = this.eventOf(eventId);
    const result = event ? this.sceneResultOf(event) : undefined;
    if (!result || !Array.isArray(result.selected) || result.selected.length === 0) return [];
    // the director stores objects; the bridge's own finalize stores plain ids
    return (result.selected as ({ personId: string; reasons?: string[] } | string)[]).map((s) =>
      typeof s === "string" ? { personId: s, reasons: ["selected for this scene"] } : { personId: s.personId, reasons: s.reasons },
    );
  }

  private validateResult(selectedIds: string[], result: GodResult): { output: SceneOutput; dropped: number } {
    const allowed = new Set(selectedIds);
    const messages: SceneOutput["messages"] = [];
    const memoryCandidates: SceneOutput["memoryCandidates"] = [];
    const relationshipCandidates: SceneOutput["relationshipCandidates"] = [];
    const timelineCandidates: SceneOutput["timelineCandidates"] = [];
    const followups: SceneOutput["followups"] = [];
    const rawMessages = Array.isArray(result.messages) ? result.messages : [];
    const rawMemories = Array.isArray(result.memoryCandidates) ? result.memoryCandidates : [];
    const rawRelationships = Array.isArray(result.relationshipCandidates) ? result.relationshipCandidates : [];
    const rawTimeline = Array.isArray(result.timelineCandidates) ? result.timelineCandidates : [];
    const rawFollowups = Array.isArray(result.followups) ? result.followups : [];
    let dropped = Math.max(0, rawMessages.length - MAX_RESULT_ENTRIES)
      + Math.max(0, rawMemories.length - MAX_RESULT_ENTRIES)
      + Math.max(0, rawRelationships.length - MAX_RESULT_ENTRIES)
      + Math.max(0, rawTimeline.length - MAX_RESULT_ENTRIES)
      + Math.max(0, rawFollowups.length - MAX_RESULT_ENTRIES);
    const seenSpeakers = new Set<string>();
    const memoryCounts = new Map<string, number>();

    for (const message of rawMessages.slice(0, MAX_RESULT_ENTRIES)) {
      if (
        !message ||
        typeof message.personId !== "string" ||
        !allowed.has(message.personId) ||
        seenSpeakers.has(message.personId) ||
        typeof message.text !== "string"
      ) {
        dropped += 1;
        continue;
      }
      const text = message.text.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!text || estimateTokens(JSON.stringify([...messages, { personId: message.personId, text }])) > GOD_LIMITS.maxOutputTokens) {
        dropped += 1;
        continue;
      }
      seenSpeakers.add(message.personId);
      messages.push({ personId: message.personId, text });
      if (messages.length >= GOD_LIMITS.maxSpeakers) break;
    }

    for (const candidate of rawMemories.slice(0, MAX_RESULT_ENTRIES)) {
      if (!candidate) {
        dropped += 1;
        continue;
      }
      const count = memoryCounts.get(candidate.personId) ?? 0;
      if (
        !allowed.has(candidate.personId) ||
        typeof candidate.content !== "string" ||
        !candidate.content.trim() ||
        count >= GOD_LIMITS.maxMemoriesPerPerson
      ) {
        dropped += 1;
        continue;
      }
      memoryCounts.set(candidate.personId, count + 1);
      memoryCandidates.push({
        personId: candidate.personId,
        scope: "private",
        type: String(candidate.kind ?? "shared_history").slice(0, 40),
        content: candidate.content.trim().slice(0, 500),
      });
    }

    for (const candidate of rawRelationships.slice(0, MAX_RESULT_ENTRIES)) {
      if (
        !candidate ||
        !allowed.has(candidate.personId) ||
        !allowed.has(candidate.targetId) ||
        candidate.personId === candidate.targetId ||
        !(RELATIONSHIP_DIMENSIONS as readonly string[]).includes(candidate.dim) ||
        !Number.isFinite(candidate.delta)
      ) {
        dropped += 1;
        continue;
      }
      relationshipCandidates.push({
        personA: candidate.personId,
        personB: candidate.targetId,
        dimsDelta: { [candidate.dim]: clamp(candidate.delta, -0.1, 0.1) } as never,
      });
      if (relationshipCandidates.length >= this.kernel.config.society.relationship.maxInteractionsPerScene) break;
    }

    for (const candidate of rawTimeline.slice(0, MAX_RESULT_ENTRIES)) {
      if (
        !candidate ||
        !allowed.has(candidate.personId) ||
        typeof candidate.kind !== "string" ||
        typeof candidate.content !== "string" ||
        !candidate.content.trim()
      ) {
        dropped += 1;
        continue;
      }
      timelineCandidates.push({
        personId: candidate.personId,
        kind: candidate.kind.slice(0, 40),
        content: candidate.content.trim().slice(0, 300),
      });
      if (timelineCandidates.length >= GOD_LIMITS.maxSpeakers * 2) break;
    }

    for (const followup of rawFollowups.slice(0, MAX_RESULT_ENTRIES)) {
      if (
        !followup ||
        !allowed.has(followup.personId) ||
        !Number.isFinite(followup.delayMs) ||
        followup.delayMs < 60_000 ||
        followup.delayMs > 90 * 86_400_000 ||
        typeof followup.reason !== "string" ||
        !followup.reason.trim()
      ) {
        dropped += 1;
        continue;
      }
      followups.push({
        personId: followup.personId,
        delayMs: followup.delayMs,
        reason: followup.reason.trim().slice(0, 200),
      });
      if (followups.length >= GOD_LIMITS.maxSpeakers) break;
    }

    const output: SceneOutput = {
      messages,
      memoryCandidates,
      relationshipCandidates,
      timelineCandidates,
      followups,
    };
    const auxiliary = [memoryCandidates, relationshipCandidates, timelineCandidates, followups];
    while (estimateTokens(JSON.stringify(output)) > GOD_LIMITS.maxOutputTokens) {
      const array = [...auxiliary].reverse().find((items) => items.length > 0);
      if (!array) break;
      array.pop();
      dropped += 1;
    }
    return { output, dropped };
  }

  private persistCandidates(eventId: string, output: SceneOutput): void {
    const k = this.kernel;
    const event = this.eventOf(eventId);
    if (output.memoryCandidates.length > 0) {
      k.memory.applyCandidates(
        output.memoryCandidates.map((candidate) => ({ ...candidate, source: `event:${eventId}` })),
      );
    }
    if (output.relationshipCandidates.length > 0) {
      k.relationship.applyCandidates(
        output.relationshipCandidates,
        k.config.society.relationship.maxDeltaPerScene,
      );
    }
    for (const timeline of output.timelineCandidates) {
      k.timeline.append({
        personId: timeline.personId,
        circleId: event?.circleId ?? null,
        eventId,
        kind: timeline.kind,
        content: timeline.content,
        at: this.clock.now(),
      });
    }
    for (const followup of output.followups) {
      k.db
        .prepare(
          `INSERT INTO followups (id, person_id, event_id, reason, fire_at, status, created_at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          id("fu"),
          followup.personId,
          eventId,
          followup.reason,
          this.clock.now() + followup.delayMs,
          "pending",
          this.clock.now(),
        );
    }
    for (const message of output.messages) {
      k.timeline.append({
        personId: message.personId,
        circleId: event?.circleId ?? null,
        eventId,
        kind: "message",
        content: message.text,
        at: this.clock.now(),
      });
      k.persons.touch(message.personId);
    }
  }

  private recordUsage(
    job: GodJob,
    result: GodResult,
    output: SceneOutput,
    _dropped: number,
  ): GodCallUsage {
    const k = this.kernel;
    const participants = job.selectedPersonIds;
    const roles = participants.flatMap((pid) => k.roles.assignments(pid).map((r) => r.name));
    const inputCharacters = job.input.accounting.characters;
    const serializedOutput = JSON.stringify(output);
    const outputCharacters = serializedOutput.length;
    const reported = result.usage;
    const inputTokens = validUsageNumber(reported?.inputTokens, job.input.accounting.estimatedTokens);
    const outputTokens = validUsageNumber(reported?.outputTokens, estimateTokens(serializedOutput));
    const cachedTokens = validUsageNumber(reported?.cachedTokens, 0);
    const reportedCost = validCost(reported?.reportedCost);
    const modeledCost = this.estimatedCost(inputTokens, outputTokens, job.modelClass);
    const estimatedCost = job.mode === "dry"
      ? 0
      : Math.max(modeledCost, reportedCost ?? 0);
    const latencyMs = validUsageNumber(reported?.latencyMs, Math.max(0, this.clock.now() - job.createdAt));
    const model = job.modelClass === "grok" ? "grok-external" : "chatgpt-external";
    const providerCallRecorded = job.mode === "live";
    k.gateway.acceptExternalResult({
      eventId: job.eventId,
      reason: `god bridge external inference (${job.modelClass})`,
      caller: "GodBridge",
      provider: job.modelClass,
      model,
      modelClass: this.bridgeModelClass(job.modelClass),
      inputTokens,
      outputTokens,
      estimatedCost,
      durationMs: latencyMs,
      providerCallRecorded,
    });

    const speakerCount = output.messages.length;
    return {
      eventId: job.eventId,
      jobId: job.id,
      timestamp: this.clock.now(),
      mode: job.mode,
      reasonGrokRequired: job.input.scene,
      participants,
      participantNames: participants.map((pid) => k.persons.get(pid)?.name ?? pid),
      roles: [...new Set(roles)],
      circleId: this.eventOf(job.eventId)?.circleId ?? null,
      inputTokens,
      outputTokens,
      cachedTokens,
      inputCharacters,
      outputCharacters,
      model,
      provider: job.modelClass,
      modelClass: this.bridgeModelClass(job.modelClass),
      estimatedCost: Number(estimatedCost.toFixed(8)),
      reportedCost,
      latencyMs,
      cacheStatus: "miss",
      resultStatus: "persisted",
      providerCallRecorded,
      stateChanges: {
        messagesApplied: output.messages.length,
        memoryCandidates: output.memoryCandidates.length,
        relationshipCandidates: output.relationshipCandidates.length,
        timelineCandidates: output.timelineCandidates.length,
        followups: output.followups.length,
        relationshipsUpdated: output.relationshipCandidates.map(
          (candidate) => `${candidate.personA}->${candidate.personB}:${Object.keys(candidate.dimsDelta).join(",")}`,
        ),
      },
      missAnalysis: {
        looksDeterministic: speakerCount === 0 || (speakerCount === 1 && output.messages[0]!.text.length < 40),
        nearCacheable: false,
        speakerCount,
        usedRelationshipContext: output.relationshipCandidates.length > 0,
        usedMemoryContext: output.memoryCandidates.length > 0,
        digest: output.messages.map((message) => `${message.personId}: ${message.text.slice(0, 60)}`).join(" | ").slice(0, 300),
      },
    };
  }

  private fallbackFor(personIds: string[]): SceneOutput {
    return {
      messages: personIds.slice(0, GOD_LIMITS.maxSpeakers).map((pid, i) => {
        const name = this.kernel.persons.get(pid)?.name ?? pid;
        const line = ["I'm here — let's catch up soon.", "Noted. I'll think about it.", "On it."][i % 3]!;
        return { personId: pid, text: `${name}: ${line}` };
      }),
      memoryCandidates: [],
      relationshipCandidates: [],
      timelineCandidates: [],
      followups: [],
    };
  }

  private eventOf(id: string): SocietyEvent | null {
    const row = this.kernel.db.prepare("SELECT * FROM events WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      eventType: row.event_type as never,
      actorId: row.actor_id as string,
      personIds: JSON.parse(row.person_ids_json as string) as string[],
      circleId: (row.circle_id as string | null) ?? null,
      payload: JSON.parse(row.payload_json as string) as Record<string, unknown>,
      status: row.status as never,
      source: row.source as string,
      stages: JSON.parse((row.stages_json as string) ?? "[]") as never,
      createdAt: Number(row.created_at),
      processedAt: (row.processed_at as number | null) ?? null,
    } as unknown as SocietyEvent;
  }

  private sceneResultOf(event: SocietyEvent): Record<string, unknown> | undefined {
    const r = event.payload?.sceneResult as Record<string, unknown> | undefined;
    return r;
  }

  private selectedIdsOf(result: Record<string, unknown> | undefined): string[] {
    const sel = result?.selected;
    if (!Array.isArray(sel)) return [];
    return sel.map((s) => (s as { personId: string }).personId);
  }

  private sceneOutputOf(event: SocietyEvent): SceneOutput | undefined {
    const r = this.sceneResultOf(event) as { output?: SceneOutput } | undefined;
    return r?.output;
  }
}

/** Aggregate cost-per-social-value metrics from events + God jobs. */
export function collectSocialCostMetrics(
  kernel: GodKernel,
  _jobs: GodJob[],
  _now: number,
): SocialCostMetrics {
  const rows = kernel.db
    .prepare("SELECT id, event_type, status, source, payload_json, created_at FROM events")
    .all() as Record<string, unknown>[];
  const byClass: Record<CostClass, number> = {
    NO_INFERENCE: 0,
    CACHE: 0,
    DETERMINISTIC: 0,
    CHEAP: 0,
    CHATGPT: 0,
    GROK: 0,
  };
  let zeroInference = 0;
  const godCalls = rows
    .map((row) => {
      const payload = JSON.parse((row.payload_json as string) ?? "{}") as Record<string, unknown>;
      return payload.godCall as GodCallUsage | undefined;
    })
    .filter((call): call is GodCallUsage => Boolean(call));
  const liveCalls = godCalls.filter((call) => call.providerCallRecorded);
  const dryRuns = godCalls.length - liveCalls.length;

  for (const row of rows) {
    const payload = JSON.parse((row.payload_json as string) ?? "{}") as Record<string, unknown>;
    const call = payload.godCall as GodCallUsage | undefined;
    const result = payload.sceneResult as { blockedReason?: string | null } | undefined;
    let cls: CostClass;
    if (call?.cacheStatus === "hit") {
      cls = "CACHE";
    } else if (call?.providerCallRecorded && call.provider === "chatgpt") {
      cls = "CHATGPT";
    } else if (call?.providerCallRecorded && call.modelClass === "social.deep") {
      cls = "GROK";
    } else if (call?.providerCallRecorded) {
      cls = "CHEAP";
    } else if (result?.blockedReason === "NO_ACTION:pacing" || row.status === "silent" || row.status === "no_action") {
      cls = "NO_INFERENCE";
    } else {
      cls = "DETERMINISTIC";
    }
    byClass[cls] += 1;
    if (cls === "NO_INFERENCE" || cls === "DETERMINISTIC" || cls === "CACHE") zeroInference += 1;
  }

  const grokCalls = liveCalls.filter((call) => call.modelClass === "social.deep").length;
  const avgIn = grokCalls
    ? Math.round(liveCalls.filter((call) => call.modelClass === "social.deep").reduce((n, call) => n + call.inputTokens, 0) / grokCalls)
    : 0;
  const avgOut = grokCalls
    ? Math.round(liveCalls.filter((call) => call.modelClass === "social.deep").reduce((n, call) => n + call.outputTokens, 0) / grokCalls)
    : 0;
  const totalCost = liveCalls.reduce((n, call) => n + call.estimatedCost, 0);
  const sessions = (kernel.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n;

  return {
    events_total: rows.length,
    events_zero_inference: zeroInference,
    cache_resolved: byClass.CACHE,
    deterministic_resolved: byClass.DETERMINISTIC,
    cheap_model_calls: byClass.CHEAP,
    chatgpt_calls: byClass.CHATGPT,
    grok_calls: grokCalls,
    god_jobs_completed: godCalls.length,
    dry_runs: dryRuns,
    grok_escalation_rate: rows.length ? Number((grokCalls / rows.length).toFixed(4)) : 0,
    avg_grok_input_tokens: avgIn,
    avg_grok_output_tokens: avgOut,
    cost_per_grok_event: grokCalls ? Number((totalCost / grokCalls).toFixed(8)) : 0,
    cost_per_social_session: sessions ? Number((totalCost / sessions).toFixed(8)) : 0,
    byClass,
  };
}
