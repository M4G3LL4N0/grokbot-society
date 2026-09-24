import type { Clock } from "../god/clock.ts";
import type { PersonService } from "../people";
import type { RelationshipService } from "../relationships";
import type { TimelineService } from "../events";
import type { CircleService } from "../circles";
import type { TelemetryService } from "../telemetry";
import type { BudgetGovernor } from "../budget/BudgetGovernor.ts";
import type { PacingFactors, ProactiveCandidate, SocialIntensity } from "../god/types.ts";

const INTENSITY_WEIGHT: Record<SocialIntensity, number> = {
  quiet: -3,
  low: -1,
  normal: 0,
  social: 1,
  very_social: 2,
  do_not_disturb: -10,
};

/**
 * ProactiveEngine — deterministic social pacing for candidate interactions.
 * Scoring dimensions: relevance, relationship strength, novelty, unfinished
 * context, timing, recent contact, user social intensity, intrusiveness.
 *
 * Conservative by default: feature disabled, minRelevance high, cooldown long,
 * budgetPerDay 0. NO persistent background model process — `proactiveTick`
 * is invoked explicitly and each REACH is one bounded event (≤ 1 call/event).
 */
export class ProactiveEngine {
  private readonly lastReach = new Map<string, number>();

  constructor(
    private readonly config: {
      enabled: boolean;
      minRelevance: number;
      cooldownMs: number;
      intrusivenessCap: number;
      maxReachesPerTick: number;
      budgetPerDay: number;
    },
    private readonly clock: Clock,
    private readonly meta: { get(key: string): unknown; set(key: string, value: unknown): void },
    private readonly persons: PersonService,
    private readonly relationships: RelationshipService,
    private readonly circles: CircleService,
    private readonly timeline: TimelineService,
    private readonly telemetry: TelemetryService,
    private readonly budget: BudgetGovernor,
    private readonly userSocialIntensity: string,
  ) {
    const persisted = meta.get("proactive.lastReach") as Record<string, number> | undefined;
    if (persisted) {
      for (const [k, v] of Object.entries(persisted)) this.lastReach.set(k, v);
    }
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  private persist(): void {
    this.meta.set("proactive.lastReach", Object.fromEntries(this.lastReach));
  }

  private budgetRemaining(): number {
    const spentToday = this.telemetry.costSince(86_400_000, this.clock.now());
    return Math.max(0, this.config.budgetPerDay - spentToday);
  }

  /** Deterministic rate of one candidate target. Never calls a model. */
  evaluate(personId: string, circleId: string | null = null): PacingFactors & { score: number } {
    const person = this.persons.get(personId);
    const rels = this.relationships.relationshipsFor(personId);
    const best = rels
      .map((r) => r.dims.familiarity * 0.5 + r.dims.affection * 0.3 + r.dims.trust * 0.2)
      .sort((a, b) => b - a)[0] ?? 0;

    const recentContact = this.timeline
      .forPerson(personId, 10)
      .filter((e) => e.createdAt >= this.clock.now() - 86_400_000).length;
    const unfinishedCount = this.timeline
      .forPerson(personId, 10)
      .filter((e) => e.createdAt >= this.clock.now() - 7 * 86_400_000)
      .filter((e) => e.kind === "followup" || e.kind === "promise").length;

    // informed novelty: fewer fresh interactions in the last 3 days → higher
    const novelty = Math.max(0, 1 - recentContact / 5);
    const timing = 1.0; // neutral multiplier; could fold in time-of-day later
    const intrusiveness = Math.min(this.config.intrusivenessCap, recentContact * 0.6);

    const base = {
      relevance: 1.0 + (person?.socialIntensity === "social" || person?.socialIntensity === "very_social" ? 1 : 0),
      relationshipStrength: best,
      novelty,
      unfinishedContext: Math.min(1, unfinishedCount * 0.5),
      timing,
      recentContact: Math.min(1, recentContact / 8),
      userSocialIntensity: INTENSITY_WEIGHT[this.userSocialIntensity as SocialIntensity] ?? 0,
      intrusiveness,
    };
    void circleId;
    const score = Math.max(
      0,
      base.relevance * 0.6 +
        base.relationshipStrength * 2.2 +
        base.novelty * 1.0 -
        (recentContact > 6 ? 3 : 0) -
        base.intrusiveness +
        (base.userSocialIntensity / 10),
    );
    return { ...base, score: Number(score.toFixed(2)) };
  }

  /**
   * Full gate for a single candidate: feature → cooldown → budget → relevance
   * → social intensity. Returns NO_ACTION unless everything clears. PURE —
   * recording a reach is sweep()'s job so one sweep never cooldown-blocks its
   * own later candidates on the identical timestamp.
   */
  consider(personId: string, circleId: string | null = null): ProactiveCandidate {
    const factors = this.evaluate(personId, circleId);
    const person = this.persons.get(personId);
    const reasons: string[] = [];

    if (!this.config.enabled) return { personId, score: factors.score, reasons: ["proactive disabled"], verdict: "NO_ACTION" };

    const last = this.lastReach.get(personId) ?? 0;
    if (this.clock.now() - last < this.config.cooldownMs) {
      return { personId, score: factors.score, reasons: ["cooldown"], verdict: "NO_ACTION" };
    }

    if (this.budgetRemaining() <= 0 && !this.budget.isZeroCost("social.mock")) {
      return { personId, score: factors.score, reasons: ["budget:0"], verdict: "NO_ACTION" };
    }

    if (person?.socialIntensity === "do_not_disturb" || person?.socialIntensity === "quiet") {
      return { personId, score: factors.score, reasons: ["intensity"], verdict: "NO_ACTION" };
    }

    if (factors.score < this.config.minRelevance) {
      return { personId, score: factors.score, reasons: [`below_min_relevance:${this.config.minRelevance}`], verdict: "NO_ACTION" };
    }

    return { personId, score: factors.score, reasons: ["pacing ok"], verdict: "REACH" };
  }

  /**
   * Explicit proactive pass (no background process). Emits 0..max REACH
   * verdicts for a circle's members and starts each reached person's cooldown
   * when the sweep completes. Caller materializes PROACTIVE_REACH events for
   * REACH verdicts.
   */
  sweep(circleId: string, limit?: number): ProactiveCandidate[] {
    const cap = limit ?? this.config.maxReachesPerTick;
    const members = this.circles.memberPersonIds(circleId).slice(0, 20);
    const out: ProactiveCandidate[] = [];
    let reaches = 0;
    for (const personId of members) {
      if (reaches >= cap) break;
      const c = this.consider(personId, circleId);
      if (c.verdict === "REACH") {
        reaches += 1;
        this.lastReach.set(personId, this.clock.now());
      }
      out.push(c);
    }
    if (reaches > 0) this.persist();
    return out;
  }
}