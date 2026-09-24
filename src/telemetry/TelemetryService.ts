import type { SocietyDB } from "../god/db.ts";
import type { Clock } from "../god/clock.ts";
import type { TelemetryEntry, ModelClass } from "../god/types.ts";

export interface TelemetryInput {
  eventId: string | null;
  reason: string | null;
  caller: string | null;
  provider: string;
  model: string;
  modelClass: ModelClass;
  inputSize: number;
  outputSize: number;
  estimatedCost: number;
  durationMs: number;
  cacheStatus: "hit" | "miss";
}

/**
 * TelemetryService records every IntelligenceGateway call and provides the
 * counters the BudgetGovernor enforces against. Also the source of truth for
 * "zero model calls" proofs.
 */
export class TelemetryService {
  private insert: ReturnType<SocietyDB["prepare"]>;
  private byEventStmt: ReturnType<SocietyDB["prepare"]>;
  private recentStmt: ReturnType<SocietyDB["prepare"]>;
  private recentEventStmt: ReturnType<SocietyDB["prepare"]>;

  /** In-memory call ledger for rapid budget checks (ms-resolution). */
  private ledger: Array<{
    at: number;
    cost: number;
    eventId: string | null;
    reasonKind: "foreground" | "background" | null;
  }> = [];

  constructor(
    private readonly db: SocietyDB,
    private readonly clock: Clock,
  ) {
    this.insert = db.prepare(
      `INSERT INTO telemetry (event_id, reason, caller, provider, model, model_class,
        input_size, output_size, estimated_cost, duration_ms, cache_status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    this.byEventStmt = db.prepare("SELECT * FROM telemetry WHERE event_id = ?");
    this.recentStmt = db.prepare("SELECT * FROM telemetry ORDER BY id DESC LIMIT ?");
    this.recentEventStmt = db.prepare(
      "SELECT COUNT(*) AS n FROM telemetry WHERE event_id = ?",
    );
  }

  record(input: TelemetryInput, reasonKind: "foreground" | "background" | null = "foreground"): number {
    this.insert.run(
      input.eventId ?? null,
      input.reason ?? null,
      input.caller ?? null,
      input.provider,
      input.model,
      input.modelClass,
      input.inputSize,
      input.outputSize,
      input.estimatedCost,
      input.durationMs,
      input.cacheStatus,
      this.clock.now(),
    );
    this.ledger.push({
      at: this.clock.now(),
      cost: input.estimatedCost,
      eventId: input.eventId ?? null,
      reasonKind,
    });
    return this.ledger.length;
  }

  countForEvent(eventId: string): number {
    return (this.recentEventStmt.get(eventId) as { n: number }).n;
  }

  /** Number of ACTUAL provider executions (cache misses) for an event. */
  providerCallsForEvent(eventId: string): number {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) AS n FROM telemetry WHERE event_id = ? AND cache_status = 'miss'",
    );
    return (stmt.get(eventId) as { n: number }).n;
  }

  totalCalls(): number {
    return this.ledger.length;
  }

  totalCost(): number {
    return this.ledger.reduce((sum, l) => sum + l.cost, 0);
  }

  /** Calls within the last `windowMs` milliseconds. */
  callsSince(windowMs: number, now?: number): number {
    const at = now ?? this.clock.now();
    return this.ledger.filter((l) => l.at >= at - windowMs).length;
  }

  costSince(windowMs: number, now?: number): number {
    const at = now ?? this.clock.now();
    return this.ledger
      .filter((l) => l.at >= at - windowMs)
      .reduce((sum, l) => sum + l.cost, 0);
  }

  backgroundCalls(): number {
    return this.ledger.filter((l) => l.reasonKind === "background").length;
  }

  recent(limit = 20): TelemetryEntry[] {
    const rows = this.recentStmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      eventId: (r.event_id as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      caller: (r.caller as string | null) ?? null,
      provider: r.provider as string,
      model: r.model as string,
      modelClass: r.model_class as ModelClass,
      inputSize: Number(r.input_size),
      outputSize: Number(r.output_size),
      estimatedCost: Number(r.estimated_cost),
      durationMs: Number(r.duration_ms),
      cacheStatus: r.cache_status as "hit" | "miss",
      createdAt: Number(r.created_at),
    }));
  }
}

/** Deterministic size/cost estimates for gatekeeping before a call happens. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateCost(
  modelClass: ModelClass,
  inputTokens: number,
  outputTokens: number,
  costPer1kOutput: Record<ModelClass, number>,
): number {
  const outRate = costPer1kOutput[modelClass] ?? 0;
  const inRate = outRate * 0.25;
  return (inputTokens / 1000) * inRate + (outputTokens / 1000) * outRate;
}