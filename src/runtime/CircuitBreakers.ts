import type { ModelClass } from "../god/types.ts";

export type BreakerName =
  | "duplicate_inference"
  | "same_event_recursion"
  | "rapid_event_explosion"
  | "excessive_retries"
  | "repeated_provider_failure"
  | "participant_fan_out"
  | "context_explosion"
  | "premium_model_escalation"
  | "repeated_cache_thrash";

export interface BreakerTrip {
  breaker: BreakerName;
  reason: string;
  at: number;
}

export interface CircuitBreaker {
  name: BreakerName;
  limit: number;
  windowMs: number;
  tripped: boolean;
  attempts: number;
}

/**
 * CircuitBreakers — detects & stops runaway patterns BEFORE they cost money:
 * duplicate inference, same-event recursion, rapid event explosion, excessive
 * retries, repeated provider failure, unexpected participant fan-out, context
 * explosion, premium escalation and cache thrashing. Trips are advisory + audit
 * (SocialOS already fails closed via budget); breakers surface health and let
 * ops choose to halt proactive/scheduled work while tripped.
 */
export class CircuitBreakers {
  private trips: BreakerTrip[] = [];
  private readonly state: Map<BreakerName, CircuitBreaker> = new Map();
  private readonly eventTimes: number[] = [];
  private readonly contextHashes = new Map<string, number>();
  private readonly failures: number[] = [];
  private escalationCount = 0;
  private cacheThrashCount = 0;

  constructor(
    private readonly clock: { now(): number },
    limits?: Partial<Record<BreakerName, { limit: number; windowMs: number }>>,
  ) {
    const defaults: Record<BreakerName, { limit: number; windowMs: number }> = {
      duplicate_inference: { limit: 2, windowMs: 60_000 },
      same_event_recursion: { limit: 1, windowMs: 60_000 },
      rapid_event_explosion: { limit: 20, windowMs: 60_000 },
      excessive_retries: { limit: 3, windowMs: 60_000 },
      repeated_provider_failure: { limit: 3, windowMs: 60_000 },
      participant_fan_out: { limit: 4, windowMs: 60_000 },
      context_explosion: { limit: 1, windowMs: 0 }, // hard trip, no window
      premium_model_escalation: { limit: 1, windowMs: 0 },
      repeated_cache_thrash: { limit: 8, windowMs: 60_000 },
    };
    for (const [name, d] of Object.entries(defaults) as Array<[BreakerName, { limit: number; windowMs: number }]>) {
      const over = limits?.[name];
      this.state.set(name, {
        name,
        limit: over?.limit ?? d.limit,
        windowMs: over?.windowMs ?? d.windowMs,
        tripped: false,
        attempts: 0,
      });
    }
  }

  /** Record a scene/event occurrence (paced event-rate). */
  observeEvent(): void {
    const now = this.clock.now();
    this.eventTimes.push(now);
    this.eventTimes.splice(0, this.eventTimes.length - 200);
    this.track("rapid_event_explosion", this.eventTimes.filter((t) => t >= now - 60_000).length, `events in 60s`);
  }

  /** Record the exact bounded context sent for one scene (hash → dedupe). */
  observeContext(hash: string): void {
    const now = this.clock.now();
    const prev = this.contextHashes.get(hash) ?? 0;
    this.contextHashes.set(hash, prev + 1);
    this.track("duplicate_inference", prev + 1, `identical scene context`);
    void now;
  }

  /** Record a context that exceeded the bounded-context budget. */
  observeContextOverflow(reason: string): void {
    this.trip("context_explosion", reason);
  }

  /** Record a provider failure (retry/failure detection). */
  observeFailure(): void {
    const now = this.clock.now();
    this.failures.push(now);
    this.failures.splice(0, this.failures.length - 200);
    const recent = this.failures.filter((t) => t >= now - 60_000).length;
    this.track("repeated_provider_failure", recent, "provider failures in 60s");
    this.track("excessive_retries", recent, "retries in 60s");
  }

  /** Record unexpected participant fan-out beyond the hard speaker cap. */
  observeFanout(count: number): void {
    this.track("participant_fan_out", count, `participants=${count}`);
  }

  /** Record a premium route escalation (cheap → deep). */
  observeEscalation(modelClass: ModelClass): void {
    this.escalationCount += 1;
    this.track("premium_model_escalation", this.escalationCount, `escalation to ${modelClass}`);
  }

  observeCacheThrash(): void {
    this.cacheThrashCount += 1;
    this.track("repeated_cache_thrash", this.cacheThrashCount, "cache miss avalanche");
  }

  isTripped(name?: BreakerName): boolean {
    if (!name) return [...this.state.values()].some((b) => b.tripped);
    const b = this.state.get(name);
    if (!b) return false;
    // window-based trips auto-heal after the window elapses (context/premium are permanent).
    if (b.windowMs === 0) return b.tripped;
    if (b.tripped) {
      const trip = [...this.trips].reverse().find((t) => t.breaker === name);
      if (trip && this.clock.now() - trip.at > b.windowMs) {
        b.tripped = false;
        b.attempts = 0;
      }
    }
    return b.tripped;
  }

  stateAll(): { name: BreakerName; tripped: boolean; attempts: number; limit: number }[] {
    return [...this.state.values()].map((b) => ({
      name: b.name,
      tripped: b.tripped,
      attempts: b.attempts,
      limit: b.limit,
    }));
  }

  recentTrips(): BreakerTrip[] {
    return [...this.trips].reverse().slice(0, 20);
  }

  reset(): void {
    for (const b of this.state.values()) {
      b.tripped = false;
      b.attempts = 0;
    }
    this.trips = [];
    this.eventTimes.length = 0;
    this.contextHashes.clear();
    this.failures.length = 0;
  }

  private track(name: BreakerName, count: number, why: string): void {
    const b = this.state.get(name);
    if (!b) return;
    b.attempts = count;
    if (count <= b.limit) return;
    if (!b.tripped) this.trips.push({ breaker: name, reason: why, at: this.clock.now() });
    b.tripped = true;
  }

  private trip(name: BreakerName, reason: string): void {
    const b = this.state.get(name);
    if (!b) return;
    if (!b.tripped) this.trips.push({ breaker: name, reason, at: this.clock.now() });
    b.tripped = true;
    b.attempts += 1;
  }
}