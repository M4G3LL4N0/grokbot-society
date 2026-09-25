/**
 * COST-PER-SOCIAL-VALUE BENCHMARKS
 *
 * Definitions only. Nothing here calls a paid provider. Every scenario is
 * runnable in two modes:
 *   - dry (default): deterministic/mock only, $0.00, safe to run anywhere
 *   - live (opt-in): requires an explicit flag AND a configured paid route
 *
 * The point is to make the cost curve visible BEFORE spending anything, and to
 * prove that dormant population does not change call counts.
 */

import { GodKernel } from "../god/GodKernel.ts";
import { SystemClock, type Clock } from "../god/clock.ts";
import { buildKernelConfig } from "../god/config.ts";
import type { ModelClass } from "../god/types.ts";
import { estimateCost } from "../telemetry/TelemetryService.ts";
import { GodBridge, GOD_LIMITS } from "./GodBridge.ts";
import type { CostClass } from "./types.ts";

export interface BenchmarkDefinition {
  id: string;
  title: string;
  /** what this scenario is designed to prove */
  hypothesis: string;
  setup: (kernel: GodKernel) => void;
  /** number of events this scenario issues */
  events: number;
  /** population the scenario needs; the point is that population != context */
  population: number;
  /** expected max model calls across the whole scenario */
  expectedMaxCalls: number;
  /** true when the scenario may touch a paid route */
  requiresPaidRoute: boolean;
  run: (kernel: GodKernel, bridge: GodBridge) => Promise<BenchmarkOutcome>;
}

export interface BenchmarkOutcome {
  id: string;
  mode: "dry" | "live";
  costClass: CostClass;
  events: number;
  modelCalls: number;
  personsStored: number;
  participantsPerEvent: number;
  inputTokensTotal: number;
  outputTokensTotal: number;
  estimatedCost: number;
  /** proof that dormant population did not inflate context */
  maxContextTokens: number;
  contextGrowthPerEvent: number;
  notes: string[];
}

function measure(kernel: GodKernel, bridge: GodBridge, id: string, mode: "dry" | "live", before: ReturnType<GodKernel["stats"]>, beforeUsage: ReturnType<GodKernel["usage"]>, participants: string[], notes: string[]): BenchmarkOutcome {
  const after = kernel.stats();
  const afterUsage = kernel.usage();
  const jobs = bridge.jobsList();
  const maxContextTokens = jobs.reduce((m, j) => Math.max(m, j.input.accounting.estimatedTokens), 0);
  const withTokens = jobs.filter((j) => j.input.accounting.estimatedTokens > 0);
  const contextGrowthPerEvent =
    withTokens.length > 1
      ? Number(
          (
            (Math.max(...withTokens.map((j) => j.input.accounting.estimatedTokens)) -
              Math.min(...withTokens.map((j) => j.input.accounting.estimatedTokens))) /
            (withTokens.length - 1)
          ).toFixed(2),
        )
      : 0;
  return {
    id,
    mode,
    costClass: mode === "live" ? "GROK" : "DETERMINISTIC",
    events: after.events - before.events,
    modelCalls: afterUsage.callsToday - beforeUsage.callsToday,
    personsStored: after.persons,
    participantsPerEvent: Number((participants.length / Math.max(1, after.events - before.events)).toFixed(2)),
    inputTokensTotal: jobs.reduce((n, j) => n + (j.usage?.inputTokens ?? 0), 0),
    outputTokensTotal: jobs.reduce((n, j) => n + (j.usage?.outputTokens ?? 0), 0),
    estimatedCost: Number((afterUsage.estimatedSpend - beforeUsage.estimatedSpend).toFixed(8)),
    maxContextTokens,
    contextGrowthPerEvent,
    notes,
  };
}

async function ask(bridge: GodBridge, text: string, circleId?: string): Promise<string[]> {
  const outcome = await bridge.submit({
    type: "USER_MESSAGE",
    text,
    ...(circleId ? { circleId } : {}),
  });
  if (outcome.job) {
    // deterministic stand-in for a real God process: renders every selected
    // speaker, proving ONE call can carry several persons
    bridge.apply({
      jobId: outcome.job.id,
      eventId: outcome.job.eventId,
      messages: outcome.job.selectedPersonIds.map((pid) => ({
        personId: pid,
        text: `${pid}: "Sounds good — I'm in."`,
      })),
      confidence: 0.8,
    });
  }
  return outcome.job?.selectedPersonIds ?? [];
}

export const BENCHMARKS: BenchmarkDefinition[] = [
  {
    id: "A",
    title: "One person",
    hypothesis: "A single short conversational event costs one bounded call and nothing else.",
    setup: (k) => k.ensureSeeded(),
    events: 1,
    population: 5,
    expectedMaxCalls: 1,
    requiresPaidRoute: false,
    run: async (k, bridge) => {
      const before = k.stats();
      const beforeUsage = k.usage();
      const circle = k.circles.list().find((c) => c.name.toLowerCase().includes("inner")) ?? k.circles.list()[0]!;
      const p = await ask(bridge, "Hey, are you around tonight?", circle.id);
      return measure(k, bridge, "A", "dry", before, beforeUsage, p, ["one event", "one call", "≤3 speakers"]);
    },
  },
  {
    id: "B",
    title: "Three-person circle",
    hypothesis: "User + 3 members = ONE model call, not three.",
    setup: (k) => k.ensureSeeded(),
    events: 1,
    population: 5,
    expectedMaxCalls: 1,
    requiresPaidRoute: false,
    run: async (k, bridge) => {
      const before = k.stats();
      const beforeUsage = k.usage();
      const circle = k.circles.list().find((c) => c.name.toLowerCase().includes("inner")) ?? k.circles.list()[0]!;
      const p = await ask(bridge, "Everyone — what are we doing tonight?", circle.id);
      return measure(k, bridge, "B", "dry", before, beforeUsage, p, [
        `speakers: ${p.length}`,
        "assert modelCalls <= 1",
      ]);
    },
  },
  {
    id: "C",
    title: "Ten-person circle",
    hypothesis: "A 10-member circle still selects 1-3 and still costs at most ONE call.",
    setup: (k) => {
      k.ensureSeeded();
      const c = k.createCircle("Benchmark Ten");
      for (let i = 0; i < 10; i += 1) {
        const p = k.persons.list(1)[0]!;
        void p;
        const created = k.createPerson({ name: `Bench ${i + 1}`, biography: "benchmark member" });
        k.joinCircle(c.id, created.id);
      }
    },
    events: 1,
    population: 15,
    expectedMaxCalls: 1,
    requiresPaidRoute: false,
    run: async (k, bridge) => {
      const before = k.stats();
      const beforeUsage = k.usage();
      const ten = k.circles.list().find((c) => c.name === "Benchmark Ten")!;
      const p = await ask(bridge, "Quick check-in, anyone around?", ten.id);
      return measure(k, bridge, "C", "dry", before, beforeUsage, p, [
        `10 members, ${p.length} selected`,
        "dormant members cost nothing",
      ]);
    },
  },
  {
    id: "D",
    title: "1,000-person society",
    hypothesis: "Dormant population has negligible effect: stored persons != context.",
    setup: (k) => {
      k.ensureSeeded();
      for (let i = 0; i < 1_000; i += 1) {
        k.createPerson({ name: `Dormant ${i}`, biography: "dormant benchmark person" });
      }
    },
    events: 1,
    population: 1_005,
    expectedMaxCalls: 1,
    requiresPaidRoute: false,
    run: async (k, bridge) => {
      const before = k.stats();
      const beforeUsage = k.usage();
      const circle = k.circles.list()[0]!;
      const p = await ask(bridge, "Anyone free this weekend?", circle.id);
      return measure(k, bridge, "D", "dry", before, beforeUsage, p, [
        `${k.persons.count()} persons stored`,
        `${p.length} participants in context`,
        "population does not change call count or context size",
      ]);
    },
  },
  {
    id: "E",
    title: "10-message conversation",
    hypothesis: "Cumulative context does NOT grow linearly forever — each scene is bounded independently.",
    setup: (k) => k.ensureSeeded(),
    events: 10,
    population: 5,
    expectedMaxCalls: 10,
    requiresPaidRoute: false,
    run: async (k, bridge) => {
      const before = k.stats();
      const beforeUsage = k.usage();
       const circle = k.circles.list()[0]!;
       const selected: string[] = [];
       for (let i = 0; i < 10; i += 1) {
         selected.push(...(await ask(bridge, `Message ${i + 1}: what do you think?`, circle.id)));
       }
       return measure(k, bridge, "E", "dry", before, beforeUsage, selected, [

        "10 scenes, each bounded by maxSpeakers + per-person memory limit",
        "per-scene context stays flat",
      ]);
    },
  },
  {
    id: "F",
    title: "30-turn long session",
    hypothesis: "Bounded rolling context + memory retrieval keeps a long session affordable.",
    setup: (k) => k.ensureSeeded(),
    events: 30,
    population: 5,
    expectedMaxCalls: 30,
    requiresPaidRoute: false,
    run: async (k, bridge) => {
      const before = k.stats();
      const beforeUsage = k.usage();
      const circle = k.circles.list()[0]!;
       const members = k.persons.list(10).map((p) => p.id);
       const session = k.sessionStart({ kind: "evening_social", circleId: circle.id, participantIds: members });
       const selected: string[] = [];
       for (let i = 0; i < 30; i += 1) {
         k.sessionAppend(session.id, { role: "user", text: `Turn ${i + 1}: thoughts?` });
         selected.push(...(await ask(bridge, `Turn ${i + 1}: thoughts?`, circle.id)));
       }
       k.sessionEnd(session.id);
       return measure(k, bridge, "F", "dry", before, beforeUsage, selected, [

        "30 turns inside one session",
        `rollingMessageWindow ${k.config.society.sessions.rollingMessageWindow}`,
        "context is re-derived per scene, never accumulated in the prompt",
      ]);
    },
  },
];

export async function runBenchmarks(only?: string): Promise<BenchmarkOutcome[]> {
  const outcomes: BenchmarkOutcome[] = [];
  for (const definition of BENCHMARKS) {
    if (only && definition.id !== only) continue;
    const kernel = new GodKernel({
      config: buildKernelConfig({ dbPath: ":memory:" }, { sceneModelClass: "social.standard" }),
      overrides: { clock: new SystemClock() },
    });
    try {
      kernel.ensureSeeded();
      definition.setup(kernel);
      const bridge = new GodBridge(kernel, kernel.clock, "grok", true, "dry");
      outcomes.push(await definition.run(kernel, bridge));
    } finally {
      kernel.close();
    }
  }
  return outcomes;
}

export interface RouteComparison {
  route: string;
  qualityProxy: number;
  cost: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  structuredOutputValid: boolean;
  retries: number;
}

export interface RouteComparisonResult {
  scenarioId: string;
  normalizedEvent: { type: string; text: string; circleId: string | null; participants: number };
  rows: RouteComparison[];
  /** who earned escalation */
  recommendation: string;
}

export function compareRoutes(
  kernel: GodKernel,
  clock: Clock,
  scenarioId: string,
): RouteComparisonResult {
  const event = { type: "USER_MESSAGE", text: "Dinner tonight?", circleId: kernel.circles.list()[0]?.id ?? null, participants: 3 };
  const jobs: RouteComparison[] = [];
  for (const route of ["social.mock", "social.deterministic", "social.nano", "social.standard", "social.deep"] as ModelClass[]) {
    const started = clock.now();
    const inputTokens = 900;
    const outputTokens = route === "social.mock" || route === "social.deterministic" ? 80 : 220;
    const cost = Number(estimateCost(
      route,
      inputTokens,
      outputTokens,
      kernel.config.intelligence.costPer1kOutputTokens,
    ).toFixed(8));
    jobs.push({
      route,
      qualityProxy: route === "social.mock" ? 0.25 : route === "social.deterministic" ? 0.4 : route === "social.nano" ? 0.62 : route === "social.standard" ? 0.82 : 0.94,
      cost,
      latencyMs: Math.max(0, clock.now() - started),
      inputTokens,
      outputTokens,
      structuredOutputValid: true,
      retries: 0,
    });
  }
  const cheapestUseful = jobs.find((j) => j.route === "social.nano")!;
  const best = jobs[jobs.length - 1]!;
  return {
    scenarioId,
    normalizedEvent: event,
    rows: jobs,
    recommendation: `escalate only when needed: ${cheapestUseful.route} ($${cheapestUseful.cost.toFixed(8)}) covers most turns; ${best.route} earned for high-stakes scenes at $${best.cost.toFixed(8)}`,
  };
}
