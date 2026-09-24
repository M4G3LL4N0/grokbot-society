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
import { RELATIONSHIP_DIMENSIONS, type ModelClass, type SceneOutput, type SocietyEvent } from "../god/types.ts";
import { estimateTokens } from "../telemetry/TelemetryService.ts";
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
  '"memoryCandidates":[],"relationshipCandidates":[],"timelineCandidates":[],"followups":[]}';

const MAX_MESSAGE_LENGTH = 200;

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0;
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
    if (!this.enabled) {
      const scene = await this.kernel.events.processUserMessage(String(event.payload.message ?? ""), {
        circleId: event.circleId,
        personIds: event.personIds ?? undefined,
      });
      const output = this.sceneOutputOf(scene);
      return {
        status: "no_inference",
        event: scene,
        costClass: output ? "DETERMINISTIC" : "NO_INFERENCE",
        reason: "god bridge disabled; deterministic path only",
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

    // Budget reservation happens BEFORE God is allowed to think.
    const reserve = this.kernel.gateway.getBudget().canReserve({
      eventId: created.id,
      reason: `god bridge: ${godInput.scene}`,
      reasonKind: "foreground",
      modelClass: this.bridgeModelClass(),
      estimatedInputTokens: godInput.accounting.estimatedTokens,
      estimatedOutputTokens: GOD_LIMITS.maxOutputTokens,
    });
    if (!reserve) {
      this.kernel.budget.countBlocked("GodBridge:budget");
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
      selectedPersonIds: godInput.participants.map((p) => p.personId),
      input: godInput,
    };
    this.jobs.set(job.id, job);
    this.jobsByEvent.set(created.id, job.id);
    this.persistJobSnapshot(job);
    return {
      status: "needs_god",
      job,
      event: created,
      costClass: this.modelClass === "grok" ? "GROK" : "CHATGPT",
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
    const job = this.jobs.get(result.jobId) ?? this.rehydrate(result.eventId ?? stripJobPrefix(result.jobId));
    if (!job) {
      throw new GodBridgeError("UNKNOWN_JOB", `unknown God job ${result.jobId}`);
    }
    if (job.status !== "AWAITING_GOD") {
      throw new GodBridgeError("JOB_CLOSED", `job ${job.id} is already ${job.status}`);
    }
    if (result.eventId && result.eventId !== job.eventId) {
      throw new GodBridgeError("EVENT_MISMATCH", `result eventId ${result.eventId} != job eventId ${job.eventId}`);
    }

    const allowed = new Set(job.selectedPersonIds);
    const messages = (result.messages ?? []).filter((m) => allowed.has(m.personId));
    const dropped = (result.messages ?? []).length - messages.length;

    const output: SceneOutput = {
      messages: messages.map((m) => ({ personId: m.personId, text: String(m.text).slice(0, MAX_MESSAGE_LENGTH) })),
      memoryCandidates: (result.memoryCandidates ?? [])
        .filter((m) => allowed.has(m.personId))
        .map((m) => ({
          personId: m.personId,
          scope: "private" as const,
          type: m.kind ?? "shared_history",
          content: m.content,
        })),
      relationshipCandidates: (result.relationshipCandidates ?? [])
        // an invented dimension is dropped, not invented into the graph
        .filter((r) => allowed.has(r.personId) && allowed.has(r.targetId) && r.personId !== r.targetId)
        .filter((r) => (RELATIONSHIP_DIMENSIONS as readonly string[]).includes(r.dim))
        .map((r) => ({
          personA: r.personId,
          personB: r.targetId,
          dimsDelta: { [r.dim]: clamp(r.delta, -0.1, 0.1) } as never,
        })),
      timelineCandidates: (result.timelineCandidates ?? [])
        .filter((t) => allowed.has(t.personId))
        .map((t) => ({ personId: t.personId, kind: t.kind as never, content: t.content })),
      followups: (result.followups ?? []).filter((f) => allowed.has(f.personId)),
    };

    // persist through the same candidate path the director uses — no bypass
    this.persistCandidates(job.eventId, output);
    const usage = this.recordUsage(job, result, output, dropped);
    this.finalizeEvent(job.eventId, "persisted", {
      output,
      selected: job.selectedPersonIds,
      fallbackUsed: false,
      blockedReason: null,
      skipped: false,
      viaGodBridge: true,
    });
    this.attachUsage(job.eventId, usage);

    job.status = "COMPLETED";
    job.result = result;
    job.usage = usage;

    const event = this.eventOf(job.eventId);
    return {
      job,
      event,
      costClass: this.modelClass === "grok" ? "GROK" : "CHATGPT",
      usage,
      applied: true,
      reason: dropped > 0 ? `${messages.length} messages applied, ${dropped} dropped (person not selected)` : `${messages.length} messages applied`,
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
    const snapshot = (event.payload?.godJob ?? undefined) as GodJob | undefined;
    if (snapshot && snapshot.input) {
      // the exact package God was shown, not a recomputation
      this.jobs.set(snapshot.id, snapshot);
      this.jobsByEvent.set(eventId, snapshot.id);
      return snapshot;
    }
    const closed = event.status === "persisted" || event.status === "deterministic_fallback";
    const selected = this.selectedFor(event);
    if (selected.length === 0 && !closed) return undefined;
    const job: GodJob = {
      id: godJobId(eventId),
      eventId,
      status: closed ? "COMPLETED" : "AWAITING_GOD",
      createdAt: event.createdAt,
      selectedPersonIds: selected.slice(0, GOD_LIMITS.maxSpeakers).map((s) => s.personId).filter(Boolean),
      input: this.buildInput(event),
    };
    this.jobs.set(job.id, job);
    this.jobsByEvent.set(eventId, job.id);
    return job;
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
    return job.input;
  }

  job(id: string): GodJob | undefined {
    return this.jobs.get(id);
  }

  jobsList(): GodJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
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
      pendingJobs: [...this.jobs.values()].filter((j) => j.status === "AWAITING_GOD").length,
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
    const id = `ev_god_${this.clock.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const row: SocietyEvent = {
      ...event,
      id,
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
    const row = this.kernel.db.prepare("SELECT payload_json FROM events WHERE id = ?").get(job.eventId) as
      | { payload_json: string }
      | undefined;
    if (!row) return;
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    payload.godJob = { ...job, status: "AWAITING_GOD" };
    this.kernel.db.prepare("UPDATE events SET payload_json = ? WHERE id = ?").run(JSON.stringify(payload), job.eventId);
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
      .prepare("UPDATE events SET status = ?, payload_json = ?, processed_at = ? WHERE id = ?")
      .run(status, JSON.stringify(payload), this.clock.now(), id);
  }

  private parseEvent(input: GodEventInput): SocietyEvent {
    if (!input || typeof input !== "object") throw new GodBridgeError("BAD_EVENT", "event must be an object");
    if (input.type !== "USER_MESSAGE" && input.type !== "DIRECT_INTERACTION" && input.type !== "GROUP_INTERACTION") {
      throw new GodBridgeError("BAD_EVENT", `unsupported event type ${String(input.type)}`);
    }
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) throw new GodBridgeError("BAD_EVENT", "text is required");
    if (text.length > 2_000) throw new GodBridgeError("BAD_EVENT", "text exceeds 2000 characters");
    return {
      id: "",
      eventType: input.type,
      actorId: this.kernel.getUserInfo().userId,
      personIds: input.personIds ?? [],
      circleId: input.circleId ?? null,
      payload: { message: text, via: "god-bridge" },
      status: "created",
      source: "god",
      stages: [],
      createdAt: this.clock.now(),
    } as unknown as SocietyEvent;
  }

  private bridgeModelClass(): ModelClass {
    return this.modelClass === "grok" ? "social.deep" : "social.standard";
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
        name: person.name,
        roles: roles.map((r) => r.name),
        why,
        identity: {
          socialIntensity: person.socialIntensity,
          traits: Object.keys(person.personality ?? {}),
          interests: [...person.interests],
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
          content: mem.content,
          kind: mem.type,
          importance: mem.importance,
          why: `retrieved memory for ${sel.personId} (limit ${GOD_LIMITS.maxMemoriesPerPerson})`,
        });
      }
    }

    const selectedIds = new Set(participants.map((p) => p.personId));
    const populationSize = k.persons.count();

    const scene = `${event.eventType} in ${event.circleId ?? "no circle"} · ${participants.length} speaker(s)`;
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
  private selectedFor(event: SocietyEvent): { personId: string; reasons?: string[] }[] {
    const persisted = this.persistedSelection(event.id);
    if (persisted.length > 0) return persisted;
    const circleId = event.circleId;
    const candidatePersonIds =
      event.personIds.length > 0
        ? event.personIds
        : circleId
          ? this.kernel.circles.memberPersonIds(circleId)
          : [];
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

  private persistCandidates(eventId: string, output: SceneOutput): void {
    const k = this.kernel;
    if (output.memoryCandidates.length > 0) {
      k.memory.applyCandidates(output.memoryCandidates);
    }
    if (output.relationshipCandidates.length > 0) {
      k.relationship.applyCandidates(output.relationshipCandidates);
    }
    for (const t of output.timelineCandidates) {
      k.timeline.append({ personId: t.personId, kind: t.kind, content: t.content, at: this.clock.now() });
    }
    // A followup is SCHEDULED, never fired now: it must not become an event in
    // this scene, and it must not cost anything until it is actually due.
    for (const f of output.followups) {
      const fireAt = this.clock.now() + Math.max(0, f.delayMs);
      k.db
        .prepare(
          `INSERT INTO followups (id, person_id, reason, fire_at, status, created_at)
           VALUES (?,?,?,?,?,?)`,
        )
        .run(`fu_${this.clock.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, f.personId, f.reason, fireAt, "pending", this.clock.now());
    }
    for (const m of output.messages) {
      k.timeline.append({
        personId: m.personId,
        eventId,
        kind: "message",
        content: m.text,
        at: this.clock.now(),
      });
    }
    void eventId;
  }

  private recordUsage(
    job: GodJob,
    result: GodResult,
    output: SceneOutput,
    dropped: number,
  ): GodCallUsage {
    const k = this.kernel;
    const participants = job.selectedPersonIds;
    const roles = participants.flatMap((pid) => k.roles.assignments(pid).map((r) => r.name));
    const inputChars = job.input.accounting.characters;
    const outputChars = output.messages.reduce((n, m) => n + m.text.length, 0);
    const inputTokens = job.input.accounting.estimatedTokens;
    const outputTokens = estimateTokens(outputChars ? JSON.stringify(output.messages) : "[]");
    const priceIn = 0.000_005 * inputTokens;
    const priceOut = 0.000_02 * outputTokens;
    const rawCost = Number((priceIn + priceOut).toFixed(8));
    // dry mode proves the pipeline without spending anything
    const estimatedCost = this.mode === "dry" ? 0 : rawCost;

    // ONE accounting boundary, owned by the gateway. A dry run proves the
    // pipeline without inventing a provider call that never happened.
    k.gateway.acceptExternalResult({
      eventId: job.eventId,
      reason: `god bridge external inference (${this.modelClass})`,
      caller: "GodBridge",
      provider: this.modelClass,
      model: this.modelClass === "grok" ? "grok-external" : "chatgpt-external",
      modelClass: this.bridgeModelClass(),
      inputTokens,
      outputTokens,
      estimatedCost,
      providerCallRecorded: this.mode === "live",
    });

    const speakerCount = output.messages.length;
    const usage: GodCallUsage = {
      eventId: job.eventId,
      jobId: job.id,
      timestamp: this.clock.now(),
      reasonGrokRequired: job.input.scene,
      participants,
      participantNames: participants.map((pid) => k.persons.get(pid)?.name ?? pid),
      roles: [...new Set(roles)],
      circleId: this.eventOf(job.eventId)?.circleId ?? null,
      inputTokens,
      outputTokens,
      cachedTokens: 0,
      model: this.modelClass === "grok" ? "grok-external" : "chatgpt-external",
      provider: this.modelClass,
      modelClass: this.bridgeModelClass(),
      estimatedCost,
      reportedCost: null,
      latencyMs: this.clock.now() - job.createdAt,
      resultStatus: "persisted",
      providerCallRecorded: this.mode === "live",
      stateChanges: {
        messagesApplied: output.messages.length,
        memoryCandidates: output.memoryCandidates.length,
        relationshipCandidates: output.relationshipCandidates.length,
        timelineCandidates: output.timelineCandidates.length,
        followups: output.followups.length,
        relationshipsUpdated: output.relationshipCandidates.map((r) => `${r.personA}->${r.personB}:${Object.keys(r.dimsDelta).join(",")}`),
      },
      missAnalysis: {
        looksDeterministic: speakerCount === 0 || (speakerCount === 1 && output.messages[0]!.text.length < 40),
        nearCacheable: false,
        speakerCount,
        usedRelationshipContext: output.relationshipCandidates.length > 0,
        usedMemoryContext: output.memoryCandidates.length > 0,
        digest: output.messages.map((m) => `${m.personId}: ${m.text.slice(0, 60)}`).join(" | ").slice(0, 300),
      },
    };
    void result;
    void dropped;
    void inputChars;
    void outputChars;
    return usage;
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
  jobs: GodJob[],
  _now: number,
): SocialCostMetrics {
  const rows = kernel.db
    .prepare("SELECT id, event_type, status, circle_id, payload_json, created_at FROM events")
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
  // call accounting is read from PERSISTED events so metrics survive restarts
  const godCalls = (kernel.db
    .prepare("SELECT payload_json FROM events WHERE payload_json LIKE '%\"godCall\"%'")
    .all() as { payload_json: string }[])
    .map((r) => (JSON.parse(r.payload_json) as { godCall: GodCallUsage }).godCall)
    .filter(Boolean);

  for (const row of rows) {
    const payload = JSON.parse((row.payload_json as string) ?? "{}") as Record<string, unknown>;
    const result = payload.sceneResult as { blockedReason?: string | null; fallbackUsed?: boolean } | undefined;
    let cls: CostClass;
    if (payload.godCall) cls = "GROK";
    else if (result?.blockedReason === "NO_ACTION:pacing") cls = "NO_INFERENCE";
    else cls = "DETERMINISTIC";
    byClass[cls] += 1;
    if (cls === "NO_INFERENCE" || cls === "DETERMINISTIC") zeroInference += 1;
  }

  // a dry run is a completed job but NOT a provider call
  const realCalls = godCalls.filter((c) => c.providerCallRecorded);
  const grokCalls = realCalls.length;
  const measured = godCalls.length > 0 ? godCalls : realCalls;
  const avgIn = measured.length ? Math.round(measured.reduce((n, j) => n + j.inputTokens, 0) / measured.length) : 0;
  const avgOut = measured.length ? Math.round(measured.reduce((n, j) => n + j.outputTokens, 0) / measured.length) : 0;
  const totalCost = godCalls.reduce((n, j) => n + j.estimatedCost, 0);
  void jobs;
  const sessions = (
    kernel.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }
  ).n;

  return {
    events_total: rows.length,
    events_zero_inference: zeroInference,
    cache_resolved: byClass.CACHE,
    deterministic_resolved: byClass.DETERMINISTIC,
    cheap_model_calls: byClass.CHEAP,
    chatgpt_calls: byClass.CHATGPT,
    grok_calls: grokCalls,
    god_jobs_completed: godCalls.length,
    grok_escalation_rate: rows.length ? Number((grokCalls / rows.length).toFixed(4)) : 0,
    avg_grok_input_tokens: avgIn,
    avg_grok_output_tokens: avgOut,
    cost_per_grok_event: grokCalls ? Number((totalCost / grokCalls).toFixed(8)) : 0,
    cost_per_social_session: sessions ? Number((totalCost / sessions).toFixed(8)) : 0,
    byClass,
  };
}
