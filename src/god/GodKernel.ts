import { SocietyDB } from "./db.ts";
import { SystemClock, SimulatedClock, type Clock } from "./clock.ts";
import { buildKernelConfig, type IntelligenceConfigInput, type KernelConfig, type SocietyConfigInput } from "./config.ts";
import { PersonService } from "../people";
import { RoleService } from "../roles";
import { RelationshipService } from "../relationships";
import { CircleService } from "../circles";
import { SocialGraph } from "../circles/SocialGraph.ts";
import { TimelineService } from "../events";
import { MemoryService } from "../memory";
import { TelemetryService } from "../telemetry";
import { CacheService } from "../cache";
import { BudgetGovernor } from "../budget/BudgetGovernor.ts";
import { ModelRouter } from "../intelligence/ModelRouter.ts";
import { IntelligenceGateway } from "../intelligence/IntelligenceGateway.ts";
import { MockProvider } from "../providers/MockProvider.ts";
import { DeterministicProvider } from "../providers/DeterministicProvider.ts";
import { RemoteStubProvider } from "../providers/RemoteStubProvider.ts";
import { ParticipantSelector } from "../runtime/ParticipantSelector.ts";
import { ContextCompiler } from "../runtime/ContextCompiler.ts";
import { SyntheticActorRuntime } from "../runtime/SyntheticActorRuntime.ts";
import { SerendipityEngine } from "../runtime/SerendipityEngine.ts";
import { SocialDirector } from "../runtime/SocialDirector.ts";
import { EventEngine } from "../events/EventEngine.ts";
import { MockSceneRenderer } from "../runtime/SceneRenderer.ts";
import { ProactiveEngine } from "../runtime/ProactiveEngine.ts";
import { CircuitBreakers } from "../runtime/CircuitBreakers.ts";
import { SessionRuntime } from "../sessions/SessionRuntime.ts";
import { CostSimulator } from "../runtime/CostSimulator.ts";
import { IdentityCardCompiler } from "../runtime/IdentityCard.ts";
import { createBridges } from "../intelligence/bridges.ts";
import type {
  IdentityCard,
  ActorContext,
  ProactiveCandidate,
  SocietySession,
  SessionKind,
  SessionMessageRecord,
} from "./types.ts";
import type { PersonState, RoleDefinition, SceneOutput, SocietyEvent } from "./types.ts";
import { seedRoles, seedCircles } from "../seed/roles.ts";
import { seedSociety } from "../seed/society.ts";

export interface GodOverrides {
  clock?: Clock;
  db?: SocietyDB;
  rng?: () => number;
  user?: { userId?: string; name?: string; socialIntensity?: string };
  /** Set true to auto-seed the demo society during construction. */
  seedOnBoot?: boolean;
}

export interface KernelStats {
  modelCalls: number;
  backgroundCalls: number;
  totalCost: number;
  cache: { hits: number; misses: number; entries: number };
  persons: number;
  roles: number;
  circles: number;
  relationships: number;
  memories: number;
  events: number;
  timeline: number;
}

/**
 * GodKernel — the top-level society kernel. God is primarily application
 * software, NOT a permanently reasoning model. It creates and evolves
 * Persons, roles, role assignments, relationships, circles, communities,
 * introductions, events, traditions and timelines. God normally does NOT
 * create GrokBots.
 */
export class GodKernel {
  readonly config: KernelConfig;
  readonly clock: Clock;
  readonly db: SocietyDB;

  readonly persons: PersonService;
  readonly roles: RoleService;
  readonly relationship: RelationshipService;
  readonly relationshipService: RelationshipService;
  readonly circles: CircleService;
  readonly graph: SocialGraph;
  readonly timeline: TimelineService;
  readonly memory: MemoryService;
  readonly telemetry: TelemetryService;
  readonly cache: CacheService;
  readonly budget: BudgetGovernor;
  readonly router: ModelRouter;
  readonly gateway: IntelligenceGateway;
  readonly selector: ParticipantSelector;
  readonly compiler: ContextCompiler;
  readonly actors: SyntheticActorRuntime;
  readonly serendipity: SerendipityEngine;
  readonly director: SocialDirector;
  readonly events: EventEngine;

  readonly renderer: MockSceneRenderer;
  readonly proactive: ProactiveEngine;
  readonly breakers: CircuitBreakers;
  readonly sessions: SessionRuntime;
  readonly cost: CostSimulator;
  readonly identityCards: IdentityCardCompiler;
  readonly bridges: ReturnType<typeof createBridges>;

  private readonly userInfo: { userId: string; name: string; socialIntensity: string };
  private readonly rng: () => number;

  constructor(options: { config?: KernelConfig; overrides?: GodOverrides } = {}) {
    const overrides = options.overrides ?? {};
    this.config = options.config ?? buildKernelConfig();
    this.clock = overrides.clock ?? new SystemClock();
    this.db = overrides.db ?? new SocietyDB(this.config.society.dbPath);
    const storedKillSwitch = this.db.meta.get("society.killSwitch") as { enabled?: boolean } | undefined;
    if (typeof storedKillSwitch?.enabled === "boolean") {
      this.config.intelligence.killSwitch = storedKillSwitch.enabled;
    }
    const rng = overrides.rng ?? Math.random;
    this.rng = rng;

    const c = this.config;
    this.userInfo = {
      userId: overrides.user?.userId ?? c.society.user.userId,
      name: overrides.user?.name ?? "You",
      socialIntensity: overrides.user?.socialIntensity ?? c.society.user.socialIntensity,
    };

    // ── identity & social state services (zero-cost persistent state)
    this.persons = new PersonService(this.db, this.clock);
    this.roles = new RoleService(this.db, this.clock);
    this.relationship = new RelationshipService(
      this.db,
      this.clock,
      c.society.relationshipLearningRate,
    );
    this.relationshipService = this.relationship;
    this.circles = new CircleService(this.db, this.clock, c.society.maxCircles);
    this.graph = new SocialGraph(this.db, this.persons, this.roles, this.relationship, this.circles);
    this.timeline = new TimelineService(this.db, this.clock);
    this.memory = new MemoryService(
      this.db,
      this.clock,
      this.circles,
      c.society.memory.hotWindow,
      c.society.memory.warmRetrievalLimit,
      c.society.memory.coldRetrievalLimit,
    );
    this.telemetry = new TelemetryService(this.db, this.clock);
    this.cache = new CacheService(this.db, this.clock, c.intelligence.cache.enabled, c.intelligence.cache.maxEntries);
    this.budget = new BudgetGovernor(
      c.intelligence.budget,
      this.telemetry,
      this.clock,
      () => c.intelligence.killSwitch,
    );
    this.router = new ModelRouter(c.intelligence);
    this.gateway = new IntelligenceGateway({
      config: c.intelligence,
      clock: this.clock,
      cache: this.cache,
      telemetry: this.telemetry,
      budget: this.budget,
      router: this.router,
    });

    // ── runtime orchestration
    this.selector = new ParticipantSelector(
      this.persons,
      this.roles,
      this.relationship,
      this.circles,
      this.timeline,
      this.clock,
      c.society.maxSpeakers,
      c.society.hardMaxSpeakers,
    );
    this.compiler = new ContextCompiler(
      this.persons,
      this.roles,
      this.relationship,
      this.circles,
      this.timeline,
      this.memory,
    );
    this.actors = new SyntheticActorRuntime(
      this.db,
      this.clock,
      this.persons,
      this.roles,
      this.relationship,
      this.memory,
    );
    this.serendipity = new SerendipityEngine(
      c.society,
      this.clock,
      this.db.meta,
      this.persons,
      this.roles,
      this.circles,
      this.timeline,
      rng,
    );
    this.identityCards = new IdentityCardCompiler();
    this.renderer = new MockSceneRenderer({
      compiler: this.compiler,
      gateway: this.gateway,
      sceneModelClass: c.intelligence.sceneModelClass,
      userInfo: { userId: this.userInfo.userId, name: this.userInfo.name },
    });
    this.director = new SocialDirector({
      db: this.db,
      clock: this.clock,
      selector: this.selector,
      compiler: this.compiler,
      actors: this.actors,
      gateway: this.gateway,
      renderer: this.renderer,
      persons: this.persons,
      timeline: this.timeline,
      memory: this.memory,
      relationships: this.relationship,
      sceneModelClass: c.intelligence.sceneModelClass,
      userInfo: this.userInfo,
      hardMaxSpeakers: c.society.hardMaxSpeakers,
      minProactiveScore: c.society.proactive.minRelevance,
    });
    this.events = new EventEngine({
      db: this.db,
      clock: this.clock,
      director: this.director,
      serendipity: this.serendipity,
      persons: this.persons,
      circles: this.circles,
      timeline: this.timeline,
      relationships: this.relationship,
      userInfo: this.userInfo,
      maxSpeakers: c.society.maxSpeakers,
    });

    // ── provider registry: the ONLY place providers are wired.
    // GrokBots are interfaces, never canonical state owners.
    this.gateway.register(new MockProvider());
    this.gateway.register(new DeterministicProvider());
    this.gateway.register(new RemoteStubProvider("nano"));
    this.gateway.register(new RemoteStubProvider("standard"));
    this.gateway.register(new RemoteStubProvider("deep"));

    // ── MVP runtime: scene renderers, pacing, breakers, sessions, bridges
    this.cost = new CostSimulator({
      avgInputTokens: 3_500,
      avgOutputTokens: 500,
      costPer1kInput: 0.005,
      costPer1kOutput: 0.02,
      cacheHitRatio: 0.2,
      proactiveCandidates: 10,
      proactiveReachRate: 0,
    });
    this.breakers = new CircuitBreakers(this.clock);
    this.proactive = new ProactiveEngine(
      {
        enabled: c.society.proactive.enabled,
        minRelevance: c.society.proactive.minRelevance,
        cooldownMs: c.society.proactive.cooldownMs,
        intrusivenessCap: c.society.proactive.intrusivenessCap,
        maxReachesPerTick: c.society.proactive.maxReachesPerTick,
        budgetPerDay: c.society.proactive.budgetPerDay,
      },
      this.clock,
      this.db.meta,
      this.persons,
      this.relationship,
      this.circles,
      this.timeline,
      this.telemetry,
      this.budget,
      this.userInfo.socialIntensity,
    );
    this.sessions = new SessionRuntime({
      db: this.db,
      clock: this.clock,
      events: this.events,
      timeline: this.timeline,
      describePerson: (personId) => {
        const person = this.persons.get(personId);
        if (!person) return { id: personId, name: personId, roleIds: [] };
        const roleDefs = this.roles.assignments(personId);
        const card = this.identityCards.compile(person, roleDefs);
        return { id: personId, name: card.name, roleIds: roleDefs.map((r) => r.id) };
      },
      config: {
        rollingMessageWindow: c.society.sessions.rollingMessageWindow,
        maxParticipantCards: c.society.sessions.maxParticipantCards,
      },
    });
    this.bridges = createBridges(this.router.entityCreate("god"));

    // roles are always seeded (pure definitions, zero inference)
    if (this.roles.count() === 0) seedRoles(this.roles);
    if (overrides.seedOnBoot) this.ensureSeeded();
  }

  // ────────────────────────────────────────────────────────────── God API

  /** Teach the society a canonical role definition (zero inference). */
  registerRole(def: RoleDefinition): RoleDefinition {
    return this.roles.register(def);
  }

  /** Assign a role to a person (zero inference). */
  assignRole(personId: string, roleId: string): void {
    this.roles.assign(personId, roleId);
  }

  /** Create a persistent Person (zero inference). */
  createPerson(input: Parameters<PersonService["create"]>[0]): PersonState {
    return this.persons.create(input);
  }

  getPerson(personId: string): PersonState | null {
    return this.persons.get(personId);
  }

  createCircle(name: string, kind = "circle"): { id: string; name: string } {
    return this.circles.create(name, kind);
  }

  joinCircle(circleId: string, personId: string): void {
    this.circles.addMember(circleId, personId, "person");
  }

  /** Create/seed a relationship with an initial delta (zero inference). */
  relate(personA: string, personB: string, delta: Partial<Record<string, number>>): void {
    this.relationship.update(personA, personB, delta as never);
  }

  setSocialIntensity(personId: string, intensity: PersonState["socialIntensity"]): void {
    this.persons.update(personId, { socialIntensity: intensity });
  }

  /** Human says something. Resolves into a scene (single inference max). */
  async tell(message: string, opts?: { circleId?: string | null; personIds?: string[] }): Promise<SocietyEvent> {
    if (this.isPaused()) throw new Error("society is paused — resume() before chatting");
    return this.events.processUserMessage(message, opts);
  }

  tick(now?: number): Promise<number> {
    return this.events.tick(now);
  }

  /**
   * LAZY WORLD SIMULATION: a dormant person coming back into relevance has
   * only the minimum missing state resolved — no per-day events, zero
   * inference. Known commitments are handled through the scheduler, not by
   * backfilling the past.
   */
  wakeLazy(personId: string, now?: number): PersonState | null {
    const person = this.persons.get(personId);
    if (!person) return null;
    const at = now ?? this.clock.now();
    const lastStateAt = person.lastStateAt ?? person.createdAt;
    const elapsedMs = Math.max(0, at - lastStateAt);
    const days = elapsedMs / 86_400_000;

    // deterministic drift of the single available signal: mood
    const priorMood = typeof person.currentState?.mood === "number" ? person.currentState.mood : 0;
    const drift = Math.tanh(days / 30) * 0.4;
    const mood = Math.max(-1, Math.min(1, priorMood + drift));

    const updated = this.persons.update(personId, {
      currentState: {
        ...person.currentState,
        mood: Number(mood.toFixed(3)),
        dormantDays: Number(days.toFixed(1)),
        resolvedAt: at,
      },
    });
    if (!updated) return null;
    this.timeline.append({
      personId,
      kind: "wake",
      content: `came back into focus after ${Math.round(days)}d dormant.`,
      at,
    });
    return updated;
  }

  // ────────────────────────────────────────────── MVP social runtime API

  /**
   * Seed an initial relationship between two persons with canonical dimension
   * values, bypassing inertia. Idempotent (leaves existing rows untouched).
   */
  seedBond(
    personA: string,
    personB: string,
    dims: Partial<Record<string, number>>,
    interactions = 0,
  ): void {
    this.relationship.seed(personA, personB, dims, interactions);
  }

  /** Idempotent full society bootstrap (roles → circles → 5-person society). */
  ensureSeeded(): { roles: number; circles: number; persons: number } {
    if (this.roles.count() === 0) seedRoles(this.roles);
    seedCircles(this.circles);
    if (!this.db.meta.get("seeded.society")) {
      seedSociety(this);
      this.db.meta.set("seeded.society", { at: this.clock.now() });
    }
    return {
      roles: this.roles.count(),
      circles: this.circles.count(),
      persons: this.persons.count(),
    };
  }

  /** Deterministic compact runtime identity card (zero inference). */
  identityCard(personId: string): IdentityCard | null {
    const person = this.persons.get(personId);
    if (!person) return null;
    return this.identityCards.compile(person, this.roles.assignments(personId));
  }

  /** Bounded actor context for one scene participant (never full history). */
  composeActorContext(
    personId: string,
    sceneRef: string,
    participantIds: string[],
    circleId: string | null = null,
  ): ActorContext {
    return this.actors.composeActorContext(personId, sceneRef, participantIds, circleId);
  }

  /** Store a shared-history landmark between two persons (zero inference). */
  landmark(
    a: string,
    b: string,
    kind: string,
    content: string,
    importance = 0.8,
  ): void {
    this.memory.storeLandmark({ a, b, kind, content, importance });
    void this.events.receive({
      eventType: "LANDMARK_EVENT",
      actorId: a,
      personIds: [a, b],
      payload: { a, b, kind, content, importance },
      source: "system",
    });
  }

  /**
   * Explicit proactive pass — NOT a background model process. Evaluates each
   * candidate deterministically (NO_ACTION audit log); only REACH verdicts
   * materialize as one bounded scene each. Default config → 0 calls.
   */
  async proactiveTick(circleId?: string): Promise<{ candidates: number; reaches: number }> {
    if (this.isPaused()) throw new Error("society is paused");
    const circles = circleId ? [circleId] : this.circles.list().map((c) => c.id);
    let candidates = 0;
    let reaches = 0;
    for (const cid of circles) {
      const verdicts = this.proactive.sweep(cid);
      for (const v of verdicts) {
        candidates += 1;
        if (v.verdict === "NO_ACTION") {
          void this.events.receive({
            eventType: "PROACTIVE_CANDIDATE",
            actorId: this.userInfo.userId,
            personIds: [v.personId],
            circleId: cid,
            payload: { personId: v.personId, verdict: v.verdict, score: v.score, reasons: v.reasons },
            source: "proactive",
          });
          continue;
        }
        reaches += 1;
        const ev = await this.events.receive({
          eventType: "PROACTIVE_REACH",
          actorId: this.userInfo.userId,
          personIds: [v.personId],
          circleId: cid,
          payload: { pacingScore: v.score, proactive: true, reasons: v.reasons },
          source: "proactive",
        });
        this.breakers.observeEvent();
        if (ev.status === "persisted" || ev.status === "deterministic_fallback") {
          this.timeline.append({
            personId: v.personId,
            circleId: cid,
            eventId: ev.id,
            kind: "proactive",
            content: `happened to reach out (score ${v.score.toFixed(2)})`,
          });
        }
      }
    }
    return { candidates, reaches };
  }

  /** Long-session abstraction (road trip / walk / evening / group / ambient). */
  sessionStart(opts: { kind: SessionKind; circleId?: string | null; participantIds: string[] }): SocietySession {
    return this.sessions.start(opts);
  }

  sessionMessages(sessionId: string): SessionMessageRecord[] {
    return this.sessions.messages(sessionId);
  }

  sessionAppend(
    sessionId: string,
    input: { personId?: string | null; role: "user" | "person"; text: string },
  ): SessionMessageRecord {
    return this.sessions.append(sessionId, input);
  }

  sessionContext(sessionId: string): ReturnType<SessionRuntime["compileContext"]> {
    return this.sessions.compileContext(sessionId);
  }

  sessionEnd(sessionId: string): SocietySession | null {
    const ended = this.sessions.end(sessionId);
    if (ended) {
      void this.events.receive({
        eventType: "SESSION_END",
        actorId: this.userInfo.userId,
        circleId: ended.circleId,
        personIds: ended.participantIds,
        payload: { sessionId },
        source: "session",
      });
    }
    return ended;
  }

  /** Pause/resume the society without losing canonical state. */
  pause(): { paused: boolean; at: number } {
    const at = this.clock.now();
    this.db.meta.set("society.paused", { paused: true, at });
    return { paused: true, at };
  }

  resume(): { paused: boolean } {
    this.db.meta.set("society.paused", { paused: false, at: this.clock.now() });
    return { paused: false };
  }

  isPaused(): boolean {
    const v = this.db.meta.get("society.paused") as { paused: boolean } | undefined;
    return Boolean(v?.paused);
  }

  /** Kill switch: when ON, every provider/model call fails closed (no inference). */
  setKillSwitch(on: boolean): { killSwitch: boolean } {
    this.config.intelligence.killSwitch = on;
    this.db.meta.set("society.killSwitch", { enabled: on, at: this.clock.now() });
    return { killSwitch: this.config.intelligence.killSwitch };
  }

  get killSwitch(): boolean {
    return this.config.intelligence.killSwitch;
  }

  /** Candidate renderers: ONE persistent God renders many persons. */
  capableRenderers(): Array<{ name: string; enabled: boolean }> {
    return [
      { name: this.renderer.name, enabled: this.renderer.enabled },
      { name: this.bridges.socialcore.name, enabled: this.bridges.socialcore.enabled },
      { name: this.bridges.chatgpt.name, enabled: this.bridges.chatgpt.enabled },
    ];
  }

  /**
   * Route to a persistent-entity capability (God / Person / Bridge). Entities
   * are NEVER created implicitly — roles and circles never spawn agents.
   */
  entityCreate(kind: "god" | "person" | "bridge"): { kind: "god" | "person" | "bridge"; modelClass: string } {
    const r = this.router.entityCreate(kind);
    return { kind, modelClass: r.modelClass };
  }

  /** Operator telemetry: every model call explainable, spend per dimension. */
  usage(): {
    callsToday: number;
    callsPerEvent: number;
    tokens: { input: number; output: number };
    estimatedSpend: number;
    spendPerPerson: Record<string, number>;
    spendPerCircle: Record<string, number>;
    spendPerProvider: Record<string, number>;
    cache: { hits: number; misses: number; entries: number };
    blockedCalls: number;
    providerEscalations: number;
    activePersons: number;
    dormantPersons: number;
    proactive: { enabled: boolean; reaches: number; noActions: number };
    trips: ReturnType<CircuitBreakers["recentTrips"]>;
  } {
    const now = this.clock.now();
    const since = () => this.telemetry.recent(100_000).filter((t) => t.createdAt >= now - 86_400_000);
    const today = since();
    const callsToday = today.length;
    const tokens = today.reduce(
      (acc, t) => ({ input: acc.input + t.inputSize, output: acc.output + t.outputSize }),
      { input: 0, output: 0 },
    );
    const estimatedSpend = today.reduce((acc, t) => acc + t.estimatedCost, 0);

    const spendPerPerson: Record<string, number> = {};
    const spendPerCircle: Record<string, number> = {};
    const spendPerProvider: Record<string, number> = {};
    for (const t of today) {
      spendPerProvider[t.provider] = (spendPerProvider[t.provider] ?? 0) + t.estimatedCost;
      if (t.eventId) {
        const ev = this.db.prepare("SELECT person_ids_json, circle_id FROM events WHERE id = ?").get(t.eventId) as
          | { person_ids_json: string; circle_id: string | null }
          | undefined;
        if (ev) {
          for (const pid of JSON.parse(ev.person_ids_json) as string[]) {
            spendPerPerson[pid] = (spendPerPerson[pid] ?? 0) + t.estimatedCost;
          }
          const cid = ev.circle_id;
          if (cid) spendPerCircle[cid] = (spendPerCircle[cid] ?? 0) + t.estimatedCost;
        }
      }
    }

    const allPersons = this.persons.list(1_000_000);
    const activePersons = allPersons.filter(
      (p) => (p.lastActiveAt ?? p.createdAt) >= now - 7 * 86_400_000,
    ).length;
    const noActions = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM events WHERE event_type = 'PROACTIVE_CANDIDATE' AND payload_json LIKE '%"verdict":"NO_ACTION"%'`,
        )
        .get() as { n: number }
    ).n;
    const reaches = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type = 'PROACTIVE_REACH'`).get() as { n: number }
    ).n;

    const uniqueEvents = new Set(today.map((t) => t.eventId).filter(Boolean)).size;
    return {
      callsToday,
      callsPerEvent: uniqueEvents > 0 ? Number((callsToday / uniqueEvents).toFixed(2)) : 0,
      tokens,
      estimatedSpend: Number(estimatedSpend.toFixed(6)),
      spendPerPerson,
      spendPerCircle,
      spendPerProvider,
      cache: this.cache.stats(),
      blockedCalls: this.budget.blockedCallCount(),
      providerEscalations: this.router.escalationCount(),
      activePersons,
      dormantPersons: allPersons.length - activePersons,
      proactive: { enabled: this.proactive.enabled, reaches, noActions },
      trips: this.breakers.recentTrips(),
    };
  }

  stats(): KernelStats {
    return {
      modelCalls: this.telemetry.totalCalls(),
      backgroundCalls: this.telemetry.backgroundCalls(),
      totalCost: this.telemetry.totalCost(),
      cache: this.cache.stats(),
      persons: this.persons.count(),
      roles: this.roles.count(),
      circles: this.circles.count(),
      relationships: this.relationship.count(),
      memories: this.memory.count(),
      events: (this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n,
      timeline: (this.db.prepare("SELECT COUNT(*) AS n FROM timeline").get() as { n: number }).n,
    };
  }

  getUserInfo(): { userId: string; name: string; socialIntensity: string } {
    return { ...this.userInfo };
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Convenience factory: fresh in-memory kernel with a simulated clock (used by
 * tests and the demo entrypoint).
 */
export function createKernel(
  society: SocietyConfigInput = {},
  overrides: GodOverrides = {},
  extraConfig?: IntelligenceConfigInput,
): GodKernel {
  const clock = overrides.clock ?? new SimulatedClock();
  const config = buildKernelConfig(society, extraConfig);
  const kernel = new GodKernel({
    config,
    overrides: { ...overrides, clock },
  });
  seedCircles(kernel.circles);
  return kernel;
}