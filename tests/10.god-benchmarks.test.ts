import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeKernel } from "./helpers.ts";
import { SystemClock } from "../src/god/clock.ts";
import { GodBridge, GOD_LIMITS } from "../src/godbridge/GodBridge.ts";
import { BENCHMARKS, compareRoutes, runBenchmarks } from "../src/godbridge/benchmarks.ts";
import { buildKernelConfig } from "../src/god/config.ts";
import { GodKernel } from "../src/god/GodKernel.ts";

function freshKernel(): GodKernel {
  const k = new GodKernel({
    config: buildKernelConfig({ dbPath: ":memory:" }, { sceneModelClass: "social.standard" }),
    overrides: { clock: new SystemClock() },
  });
  k.ensureSeeded();
  return k;
}

describe("benchmark definitions", () => {
  it("all six required scenarios exist", () => {
    expect(BENCHMARKS.map((b) => b.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("no scenario requires a paid route by default", () => {
    expect(BENCHMARKS.every((b) => !b.requiresPaidRoute)).toBe(true);
  });

  it("every scenario declares a max call budget", () => {
    for (const b of BENCHMARKS) {
      expect(b.expectedMaxCalls).toBeGreaterThan(0);
      expect(b.hypothesis.length).toBeGreaterThan(10);
    }
  });
});

describe("dry benchmark execution (zero cost)", () => {
  it("scenario A — one person, one event, one call", async () => {
    const k = freshKernel();
    const a = BENCHMARKS.find((b) => b.id === "A")!;
    const out = await a.run(k, new GodBridge(k, new SystemClock(), "grok", true, "dry"));
    expect(out.events).toBeGreaterThanOrEqual(1);
    expect(out.modelCalls).toBeLessThanOrEqual(a.expectedMaxCalls);
    expect(out.estimatedCost).toBe(0);
    k.close();
  });

  it("scenario B — three-person circle is still ONE call", async () => {
    const k = freshKernel();
    const b = BENCHMARKS.find((x) => x.id === "B")!;
    const out = await b.run(k, new GodBridge(k, new SystemClock(), "grok", true, "dry"));
    expect(out.modelCalls).toBeLessThanOrEqual(1);
    expect(out.notes.join(" ")).toContain("modelCalls <= 1");
    k.close();
  });

  it("scenario D — 1,000 dormant persons do not change the call count", async () => {
    const k = freshKernel();
    const d = BENCHMARKS.find((x) => x.id === "D")!;
    d.setup(k);
    expect(k.persons.count()).toBeGreaterThan(1_000);
    const smallRef = freshKernel();
    const a = BENCHMARKS.find((x) => x.id === "A")!;
    const baseline = await a.run(smallRef, new GodBridge(smallRef, new SystemClock(), "grok", true, "dry"));
    const out = await d.run(k, new GodBridge(k, new SystemClock(), "grok", true, "dry"));
    expect(out.modelCalls).toBe(baseline.modelCalls);
    expect(out.maxContextTokens).toBeLessThan(baseline.maxContextTokens * 3);
    k.close();
    smallRef.close();
  });

  it("scenario E — 10-message conversation keeps context bounded", async () => {
    const k = freshKernel();
    const e = BENCHMARKS.find((x) => x.id === "E")!;
    const out = await e.run(k, new GodBridge(k, new SystemClock(), "grok", true, "dry"));
    expect(out.events).toBeGreaterThanOrEqual(10);
    // per-scene context never grows with conversation length
    expect(out.maxContextTokens).toBeLessThan(2_000);
    k.close();
  });

  it("scenario F — 30-turn session stays within the hard limits", async () => {
    const k = freshKernel();
    const f = BENCHMARKS.find((x) => x.id === "F")!;
    const out = await f.run(k, new GodBridge(k, new SystemClock(), "grok", true, "dry"));
    expect(out.events).toBeGreaterThanOrEqual(30);
    expect(out.notes.join(" ")).toContain("rollingMessageWindow");
    expect(out.participantsPerEvent).toBeGreaterThan(0.5);
    k.close();
  });

  it("every dry scenario costs nothing", async () => {
    for (const b of BENCHMARKS) {
      const k = freshKernel();
      b.setup(k);
      const out = await b.run(k, new GodBridge(k, new SystemClock(), "grok", true, "dry"));
      expect(out.estimatedCost).toBe(0);
      expect(out.mode).toBe("dry");
      k.close();
    }
  });
});

describe("route comparison", () => {
  it("compares every route for one normalized event", () => {
    const k = freshKernel();
    const result = compareRoutes(k, new SystemClock(), "A");
    expect(result.rows.map((r) => r.route)).toEqual([
      "social.mock",
      "social.deterministic",
      "social.nano",
      "social.standard",
      "social.deep",
    ]);
    k.close();
  });

  it("mock and deterministic are free; paid routes are not", () => {
    const k = freshKernel();
    const result = compareRoutes(k, new SystemClock(), "A");
    const byRoute = Object.fromEntries(result.rows.map((r) => [r.route, r.cost]));
    expect(byRoute["social.mock"]).toBe(0);
    expect(byRoute["social.deterministic"]).toBe(0);
    expect(byRoute["social.deep"]!).toBeGreaterThan(0);
    k.close();
  });

  it("Grok must earn escalation, not win by default", () => {
    const k = freshKernel();
    const result = compareRoutes(k, new SystemClock(), "A");
    expect(result.recommendation).toContain("escalate only when needed");
    // the recommendation names a cheap default before the expensive one
    expect(result.recommendation.indexOf("social.nano")).toBeLessThan(result.recommendation.indexOf("social.deep"));
    k.close();
  });

  it("tracks the required comparison dimensions", () => {
    const k = freshKernel();
    const row = compareRoutes(k, new SystemClock(), "A").rows[0]!;
    for (const field of ["qualityProxy", "cost", "latencyMs", "inputTokens", "outputTokens", "structuredOutputValid", "retries"]) {
      expect(row).toHaveProperty(field);
    }
    k.close();
  });

  it("runs every definition in an isolated dry kernel", async () => {
    const outcomes = await runBenchmarks();
    expect(outcomes.map((outcome) => outcome.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(outcomes.every((outcome) => outcome.mode === "dry" && outcome.estimatedCost === 0)).toBe(true);
    expect(outcomes.every((outcome) => outcome.modelCalls === 0)).toBe(true);
  });
  it("enables the bounded dry handoff with the bridge flag", () => {
    const root = mkdtempSync(join(tmpdir(), "god-cli-submit-"));
    const file = join(root, "operator.db");
    try {
      const output = execFileSync(
        "pnpm",
        ["society", "god", "submit", '{"type":"USER_MESSAGE","text":"hello from the operator"}', "--bridge", "--db", file],
        { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" },
      );
      expect(output).toContain('"participants"');
      expect(output).toContain('"constraints"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not open the operator database for a benchmark command", () => {
    const root = mkdtempSync(join(tmpdir(), "god-bench-cli-"));
    const file = join(root, "operator.db");
    try {
      execFileSync("pnpm", ["society", "god", "benchmarks", "A", "--db", file], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("limits are conservative", () => {
  it("the published limits match the implementation", () => {
    expect(GOD_LIMITS).toEqual({
      maxCallsPerEvent: 1,
      recursionDepth: 0,
      backgroundCalls: 0,
      maxRetries: 0,
      maxSpeakers: 3,
      maxOutputTokens: 400,
      maxRelationshipsPerPerson: 4,
      maxMemoriesPerPerson: 5,
    });
  });

  it("the kernel itself still defaults to zero-cost and zero-proactive", () => {
    const h = makeKernel();
    expect(h.kernel.config.intelligence.sceneModelClass).toBe("social.mock");
    expect(h.kernel.config.intelligence.budget.maxCallsPerEvent).toBe(1);
    expect(h.kernel.config.intelligence.budget.recursionDepth).toBe(0);
    expect(h.kernel.config.intelligence.budget.backgroundModelCalls).toBe(0);
    expect(h.kernel.config.intelligence.budget.maxRetries).toBe(0);
    expect(h.kernel.config.society.proactive.enabled).toBe(false);
    expect(h.kernel.config.society.proactive.budgetPerDay).toBe(0);
    expect(h.kernel.config.society.hardMaxSpeakers).toBe(3);
  });
});
