export interface CostSimOptions {
  avgInputTokens: number;
  avgOutputTokens: number;
  costPer1kInput: number; // $ per 1k tokens
  costPer1kOutput: number; // $ per 1k tokens
  cacheHitRatio: number; // 0..1 share of identical-context scenes served from cache
  proactiveCandidates: number;
  proactiveReachRate: number; // 0..1 share of proactive candidates that clear NO_ACTION
}

export interface SimulatedScenario {
  name: string;
  population: number;
  active: number;
  dormant: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedSpend: number;
  note: string;
}

/**
 * CostSimulator — deterministic arithmetic estimation (NOT a model). Proves the
 * scaling thesis: dormant population contributes ~zero model cost because
 * nothing runs for a person who never surfaces. Scenarios:
 *  1) 1:1 conversation   2) 3-person group   3) 30-message evening
 *  4) road-trip session  5) 10 proactive candidates
 */
export class CostSimulator {
  constructor(private readonly opts: CostSimOptions) {}

  private calls(events: number): number {
    const hits = Math.round(events * this.opts.cacheHitRatio);
    return Math.max(0, events - hits); // cache preceded inference
  }

  private tokens(calls: number): { input: number; output: number } {
    return {
      input: calls * this.opts.avgInputTokens,
      output: calls * this.opts.avgOutputTokens,
    };
  }

  private spend(tokens: { input: number; output: number }): number {
    return (
      (tokens.input / 1000) * this.opts.costPer1kInput +
      (tokens.output / 1000) * this.opts.costPer1kOutput
    );
  }

  private scenariosFor(population: number): Omit<SimulatedScenario, "modelCalls" | "inputTokens" | "outputTokens" | "estimatedSpend" | "note">[] {
    const active = Math.min(population, 15); // only people who ever surface in user scenes
    const dormant = population - active;
    const proactiveActive = Math.max(0, Math.round(this.opts.proactiveCandidates * this.opts.proactiveReachRate));
    return [
      {
        name: "1:1 conversation (20 messages)",
        population,
        active,
        dormant,
      },
      {
        name: "3-person group scene (15 messages)",
        population,
        active,
        dormant,
      },
      {
        name: "30-message evening",
        population,
        active,
        dormant,
      },
      {
        name: "road-trip session (24h, 40 messages, rolling context)",
        population,
        active,
        dormant,
      },
      {
        name: `10 proactive candidates (${proactiveActive} reach)`,
        population,
        active,
        dormant,
      },
    ];
  }

  simulate(population: number): SimulatedScenario[] {
    const events = {
      "1:1 conversation (20 messages)": 20,
      "3-person group scene (15 messages)": 15,
      "30-message evening": 30,
      "road-trip session (24h, 40 messages, rolling context)": 40,
      [`10 proactive candidates (${Math.max(0, Math.round(this.opts.proactiveCandidates * this.opts.proactiveReachRate))} reach)`]: Math.max(0, Math.round(this.opts.proactiveCandidates * this.opts.proactiveReachRate)),
    };
    return this.scenariosFor(population).map((base) => {
      const eventsCount = events[base.name] ?? 0;
      const calls = this.calls(eventsCount);
      const t = this.tokens(calls);
      const spend = this.spend(t);
      const note =
        base.dormant > 0
          ? `${base.dormant} dormant persons → $0 associated cost (lazy world sim, zero inference for the dormant)`
          : "no dormant population";
      return { ...base, modelCalls: calls, inputTokens: t.input, outputTokens: t.output, estimatedSpend: Number(spend.toFixed(6)), note };
    });
  }

  report(populations: number[] = [5, 50, 500, 5000]): SimulatedScenario[][] {
    return populations.map((p) => this.simulate(p));
  }
}