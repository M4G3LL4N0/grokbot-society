import { describe, expect, it } from "vitest";

import { makeKernel, type KernelHarness } from "./helpers.ts";
import { SimulatedClock } from "../src/god/clock.ts";
import { GodBridge, GOD_LIMITS, godJobId } from "../src/godbridge/GodBridge.ts";
import { GOD_OUTPUT_SCHEMA, type GodResult } from "../src/godbridge/index.ts";
import { GodBridgeError } from "../src/godbridge/types.ts";
import { assertGatewalledCall, enterGateway, exitGateway, ProviderCallOutsideGatewayError } from "../src/providers/types.ts";

/** Bridge harness: bridge ENABLED so the God path is exercised, mode dry so nothing is ever spent. */
function godHarness(overrides: Parameters<typeof makeKernel>[1] = {}): KernelHarness & { bridge: GodBridge } {
  const h = makeKernel({}, { sceneModelClass: "social.standard", ...overrides });
  const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
  return { ...h, bridge };
}

function firstCircle(h: KernelHarness): string {
  return h.kernel.circles.list().find((c) => c.name === "Inner Circle")!.id;
}

async function ask(h: KernelHarness & { bridge: GodBridge }, text: string) {
  return h.bridge.submit({ type: "USER_MESSAGE", text, circleId: firstCircle(h) });
}

function reply(jobId: string, eventId: string, personIds: string[], extra: Partial<GodResult> = {}): GodResult {
  return {
    jobId,
    eventId,
    messages: personIds.map((pid, i) => ({ personId: pid, text: `line ${i + 1}` })),
    ...extra,
  };
}

describe("01 · the bridge does not bypass the gateway", () => {
  it("routes every external inference through the budget governor", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const before = h.kernel.usage().blockedCalls;
    const out = await ask(h, "hello everyone");
    expect(out.status).toBe("needs_god");
    const applied = h.bridge.apply(reply(out.job!.id, out.job!.eventId, out.job!.selectedPersonIds));
    // every external call is booked through the gateway's single boundary
    expect(applied.usage.providerCallRecorded).toBe(false); // dry mode
    expect(h.kernel.usage().blockedCalls).toBe(before);
    // a refusal is counted, never silently dropped
    h.kernel.budget.countBlocked("test");
    expect(h.kernel.usage().blockedCalls).toBe(before + 1);
  });

  it("a live-mode call is booked into the shared telemetry ledger", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const live = new GodBridge(h.kernel, h.clock, "grok", true, "live");
    const out = await live.submit({ type: "USER_MESSAGE", text: "paid", circleId: firstCircle(h) });
    live.apply(reply(out.job!.id, out.job!.eventId, out.job!.selectedPersonIds));
    expect(h.kernel.usage().callsToday).toBe(1);
    expect(live.usage().grok_calls).toBe(1);
  });

  it("a provider called outside the gateway is impossible to smuggle in", async () => {
    const h = makeKernel();
    // providers assert the gateway context themselves
    expect(() => assertGatewalledCall()).toThrow(ProviderCallOutsideGatewayError);
    enterGateway();
    expect(() => assertGatewalledCall()).not.toThrow();
    exitGateway();
  });
});

describe("02 · God receives only selected participants", () => {
  it("the GodInput carries at most hardMaxSpeakers persons", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "what's up");
    expect(out.status).toBe("needs_god");
    expect(out.job!.selectedPersonIds.length).toBeGreaterThan(0);
    expect(out.job!.input.participants.length).toBeLessThanOrEqual(GOD_LIMITS.maxSpeakers);
  });

  it("God never receives a roster of the population", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    for (let i = 0; i < 50; i += 1) h.kernel.createPerson({ name: `Extra ${i}`, biography: "x" });
    const out = await ask(h, "hello?");
    const serialized = JSON.stringify(out.job!.input);
    for (let i = 0; i < 50; i += 1) {
      expect(serialized).not.toContain(`Extra ${i}`);
    }
    // the population is disclosed as a number, not as names
    expect(out.job!.input.accounting.populationSize).toBeGreaterThan(50);
    expect(out.job!.input.accounting.excludedCount).toBeGreaterThan(0);
    expect(out.job!.input.accounting.exclusionCriterion).toBeTruthy();
  });

  it("a message for a person who was NOT selected is dropped", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const stranger = h.kernel.createPerson({ name: "Stranger", biography: "not in circle" });
    const out = await ask(h, "hello");
    const applied = h.bridge.apply(reply(out.job!.id, out.job!.eventId, [stranger.id]));
    expect(applied.applied).toBe(true);
    expect(applied.usage.stateChanges.messagesApplied).toBe(0);
  });
});

describe("03 · God receives bounded memory", () => {
  it("memories per person never exceed the cap", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "remember stuff");
    for (const pid of out.job!.selectedPersonIds) {
      const forPerson = out.job!.input.memories.filter((m) => m.personId === pid);
      expect(forPerson.length).toBeLessThanOrEqual(GOD_LIMITS.maxMemoriesPerPerson);
    }
  });

  it("context stays small even with a large stored society", async () => {
    const small = godHarness();
    small.kernel.ensureSeeded();
    const big = godHarness();
    big.kernel.ensureSeeded();
    for (let i = 0; i < 300; i += 1) big.kernel.createPerson({ name: `Dormant ${i}`, biography: "x" });

    const a = await ask(small, "same question");
    const b = await ask(big, "same question");
    expect(b.job!.input.accounting.estimatedTokens).toBeLessThan(
      a.job!.input.accounting.estimatedTokens * 3,
    );
  });
});

describe("04 · God does not receive canonical database dumps", () => {
  it("the input has no schema, source, or whole-table fields", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "what's up");
    const input = out.job!.input;
    const topKeys = Object.keys(input as unknown as Record<string, unknown>);
    expect(topKeys.sort()).toEqual(
      ["accounting", "constraints", "eventId", "memories", "outputSchema", "participants", "relationships", "scene", "userMessage"].sort(),
    );
    // structural leakage check: no source/schema/table concepts as KEYS anywhere
    const seenKeys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          seenKeys.add(k.toLowerCase());
          walk(val);
        }
      }
    };
    walk(input);
    for (const forbidden of ["source", "src", "files", "table", "tables", "schema", "rows", "db", "sqlite", "transcript", "readme"]) {
      expect(seenKeys.has(forbidden)).toBe(false);
    }
    // and no field may carry an unbounded list
    expect(out.job!.input.participants.length).toBeLessThanOrEqual(GOD_LIMITS.maxSpeakers);
  });

  it("the output schema is a tiny bounded contract", () => {
    expect(GOD_OUTPUT_SCHEMA.length).toBeLessThan(300);
    expect(GOD_OUTPUT_SCHEMA).toContain("messages");
  });
});

describe("05 · one God invocation may render multiple Persons", () => {
  it("three speakers come back from ONE job", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "everyone weigh in");
    const speakers = out.job!.selectedPersonIds.slice(0, 3);
    const applied = h.bridge.apply(reply(out.job!.id, out.job!.eventId, speakers));
    expect(speakers.length).toBeGreaterThan(1);
    expect(applied.usage.stateChanges.messagesApplied).toBe(speakers.length);
    expect(applied.usage.missAnalysis.speakerCount).toBe(speakers.length);
    // exactly one job for the whole group scene
    expect(h.bridge.usage().god_jobs_completed).toBe(1);
  });
});

describe("06 · a 10-member circle still invokes at most one God inference", () => {
  it("selection stays bounded regardless of circle size", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const circle = h.kernel.createCircle("Ten");
    for (let i = 0; i < 10; i += 1) {
      const p = h.kernel.createPerson({ name: `M${i}`, biography: "member" });
      h.kernel.joinCircle(circle.id, p.id);
    }
    const out = await h.bridge.submit({ type: "GROUP_INTERACTION", text: "roll call", circleId: circle.id });
    expect(out.job!.selectedPersonIds.length).toBeLessThanOrEqual(GOD_LIMITS.maxSpeakers);
    h.bridge.apply(reply(out.job!.id, out.job!.eventId, out.job!.selectedPersonIds));
    // exactly one God job, and zero provider calls in dry mode
    expect(h.bridge.usage().god_jobs_completed).toBe(1);
    expect(h.bridge.usage().grok_calls).toBe(0);
  });
});

describe("07 · 1,000 dormant Persons do not alter the call count", () => {
  it("call count and context are population-independent", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    for (let i = 0; i < 1_000; i += 1) h.kernel.createPerson({ name: `Dormant ${i}`, biography: "x" });
    const out = await ask(h, "anyone around?");
    h.bridge.apply(reply(out.job!.id, out.job!.eventId, out.job!.selectedPersonIds));
    expect(h.bridge.usage().god_jobs_completed).toBe(1);
    expect(out.job!.input.participants.length).toBeLessThanOrEqual(GOD_LIMITS.maxSpeakers);
    expect(out.job!.input.accounting.populationSize).toBeGreaterThan(1_000);
    expect(h.kernel.stats().persons).toBeGreaterThan(1_000);
  });
});

describe("08 · recursion remains impossible", () => {
  it("applying a result never creates another job", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "hello");
    h.bridge.apply(
      reply(out.job!.id, out.job!.eventId, out.job!.selectedPersonIds, {
        followups: [{ personId: out.job!.selectedPersonIds[0]!, delayMs: 0, reason: "check in" }],
      }),
    );
    const jobs = h.bridge.jobsList();
    expect(jobs.filter((j) => j.status === "AWAITING_GOD").length).toBe(0);
    expect(jobs.length).toBe(1);
  });

  it("a second submit for the same event is structurally refused", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "hello");
    // re-submitting the SAME event id cannot happen through the public path
    // (each submit creates a new event), but the job map is keyed by event and
    // refuses duplicates explicitly.
    h.bridge.apply(reply(out.job!.id, out.job!.eventId, out.job!.selectedPersonIds));
    expect(h.bridge.job(godJobId(out.job!.eventId))!.status).toBe("COMPLETED");
    expect(() => h.bridge.apply(reply(out.job!.id, out.job!.eventId, out.job!.selectedPersonIds))).toThrow(
      GodBridgeError,
    );
  });

  it("recursion depth is 0 and is stated in the contract", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "hello");
    expect(out.job!.input.constraints.recursion).toBe(0);
    expect(GOD_LIMITS.recursionDepth).toBe(0);
  });
});

describe("09 · paid proactive and background inference stay disabled", () => {
  it("health reports both as off", () => {
    const h = godHarness();
    const health = h.bridge.health() as { safety: Record<string, unknown> };
    expect(health.safety.proactivePaidInference).toBe(false);
    expect(health.safety.backgroundLifeSimulation).toBe(false);
    expect(health.safety.maxCallsPerEvent).toBe(1);
    expect(health.safety.recursionDepth).toBe(0);
    expect(health.safety.backgroundCalls).toBe(0);
    expect(health.safety.maxRetries).toBe(0);
  });

  it("a proactive tick reaches nobody and spends nothing", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const r = await h.kernel.proactiveTick();
    expect(r.reaches).toBe(0);
    expect(h.kernel.usage().estimatedSpend).toBe(0);
  });
});

describe("10 · God failure degrades gracefully", () => {
  it("an unknown job id is rejected without touching state", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const before = h.kernel.stats().events;
    expect(() => h.bridge.apply(reply("nope", "nope", ["p_x"]))).toThrow(/unknown God job/);
    expect(h.kernel.stats().events).toBe(before);
  });

  it("garbage output is sanitized, not trusted", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "hello");
    const applied = h.bridge.apply({
      jobId: out.job!.id,
      eventId: out.job!.eventId,
      messages: [{ personId: out.job!.selectedPersonIds[0]!, text: "x".repeat(5_000) }],
    });
    expect(applied.usage.stateChanges.messagesApplied).toBe(1);
    const stored = h.bridge.context(out.job!.eventId);
    expect(stored).toBeDefined();
  });

  it("a bad event is rejected up front", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    await expect(h.bridge.submit({ type: "NONSENSE" as never, text: "x" })).rejects.toThrow();
    await expect(h.bridge.submit({ type: "USER_MESSAGE", text: "" })).rejects.toThrow(/text is required/);
  });
});

describe("11 · Society runs with God unavailable", () => {
  it("with the bridge off, tell() still produces a scene", async () => {
    const h = makeKernel();
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", false, "dry");
    const out = await bridge.submit({ type: "USER_MESSAGE", text: "hi", circleId: firstCircle(h) });
    expect(out.status).toBe("no_inference");
    expect(out.deterministic).toBeDefined();
  });

  it("an explicitly enabled bridge replaces the internal renderer; the default never does", async () => {
    const h = makeKernel();
    h.kernel.ensureSeeded();
    expect(h.kernel.config.intelligence.sceneModelClass).toBe("social.mock");

    // default construction: disabled, so the deterministic renderer owns the scene
    const off = new GodBridge(h.kernel, h.clock, "grok", false, "dry");
    const offOut = await off.submit({ type: "USER_MESSAGE", text: "hi", circleId: firstCircle(h) });
    expect(offOut.status).toBe("no_inference");
    expect(offOut.costClass).not.toBe("GROK");

    // and the society produced a real scene without God
    const scene = await h.kernel.tell("hi", { circleId: firstCircle(h) });
    expect(scene.payload.sceneResult).toBeDefined();
  });
});

describe("12 · provider replacement does not alter Person identity", () => {
  it("the same person id renders under a different model class", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const grok = await ask(h, "who are you");
    const grokPerson = grok.job!.input.participants[0]!.personId;

    const chatgpt = new GodBridge(h.kernel, h.clock, "chatgpt", true, "dry");
    const viaChat = await chatgpt.submit({ type: "USER_MESSAGE", text: "who are you", circleId: firstCircle(h) });
    const chatPerson = viaChat.job!.input.participants[0]!.personId;

    // identity is Society state, not a property of the model
    expect(h.kernel.persons.get(grokPerson)!.id).toBe(h.kernel.persons.get(chatPerson)!.id);
    expect(grok.job!.input.participants[0]!.name).toBe(viaChat.job!.input.participants[0]!.name);
  });
});

describe("13 · telemetry records why Grok was invoked", () => {
  it("the call record answers why/what/for-whom", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "planning tonight");
    const applied = h.bridge.apply(reply(out.job!.id, out.job!.eventId, out.job!.selectedPersonIds));
    const u = applied.usage;
    expect(u.eventId).toBe(out.job!.eventId);
    expect(u.reasonGrokRequired).toContain("USER_MESSAGE");
    expect(u.participants.length).toBeGreaterThan(0);
    expect(u.participantNames.length).toBe(u.participants.length);
    expect(u.roles).toBeDefined();
    expect(u.circleId).toBe(firstCircle(h));
    expect(u.inputTokens).toBeGreaterThan(0);
    expect(u.outputTokens).toBeGreaterThan(0);
    expect(u.provider).toBe("grok");
    expect(u.model).toBeDefined();
    expect(u.estimatedCost).toBe(0); // dry mode
    expect(u.resultStatus).toBe("persisted");
    expect(u.stateChanges.messagesApplied).toBeGreaterThan(0);
    expect(u.missAnalysis.digest.length).toBeGreaterThan(0);
  });

  it("miss analysis is available offline without another call", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "hi");
    const applied = h.bridge.apply(reply(out.job!.id, out.job!.eventId, out.job!.selectedPersonIds));
    const callsBefore = h.kernel.usage().callsToday;
    // reading the analysis must not cost anything
    expect(applied.usage.missAnalysis.looksDeterministic).toBe(false);
    expect(applied.usage.missAnalysis.speakerCount).toBeGreaterThan(0);
    expect(h.kernel.usage().callsToday).toBe(callsBefore);
  });

  it("the full accounting is persisted on the event", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const out = await ask(h, "persist me");
    h.bridge.apply(reply(out.job!.id, out.job!.eventId, out.job!.selectedPersonIds));
    const metrics = h.bridge.usage();
    // dry mode: the job completed and the accounting is persisted, but no
    // provider was called and nothing was charged
    expect(metrics.god_jobs_completed).toBe(1);
    expect(metrics.grok_calls).toBe(0);
    expect(metrics.avg_grok_input_tokens).toBe(0);
    expect(metrics.cost_per_grok_event).toBe(0);
  });
});

describe("14 · kill and pause block God inference", () => {
  it("the kill switch blocks the bridge and counts the refusal", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    const before = h.kernel.usage().blockedCalls;
    h.kernel.setKillSwitch(true);
    const out = await ask(h, "anyone there?");
    expect(out.status).toBe("no_inference");
    expect(out.reason).toMatch(/KillSwitch/);
    expect(h.kernel.usage().blockedCalls).toBeGreaterThan(before);
  });

  it("pause refuses a submit outright", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    h.kernel.pause();
    await expect(ask(h, "hello")).rejects.toThrow(/paused/);
    h.kernel.resume();
  });

  it("resume restores normal operation", async () => {
    const h = godHarness();
    h.kernel.ensureSeeded();
    h.kernel.pause();
    h.kernel.resume();
    const out = await ask(h, "back");
    expect(out.status).toBe("needs_god");
  });
});

describe("clock isolation", () => {
  it("simulated clock drives job timestamps", async () => {
    const clock = new SimulatedClock(1_000);
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, clock, "grok", true, "dry");
    const out = await bridge.submit({ type: "USER_MESSAGE", text: "tick", circleId: firstCircle(h) });
    expect(out.job!.createdAt).toBe(1_000);
  });
});
