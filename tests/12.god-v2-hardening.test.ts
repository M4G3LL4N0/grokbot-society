import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeKernel } from "./helpers.ts";
import { createKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";
import { GodBridge, GOD_LIMITS, godJobId } from "../src/godbridge/GodBridge.ts";
import { estimateTokens } from "../src/telemetry/TelemetryService.ts";
import type { GodResult } from "../src/godbridge/types.ts";

function circleId(kernel: ReturnType<typeof makeKernel>["kernel"]): string {
  return kernel.circles.list().find((c) => c.name === "Inner Circle")!.id;
}

function result(jobIdValue: string, eventId: string, personIds: string[], extra: Partial<GodResult> = {}): GodResult {
  return {
    jobId: jobIdValue,
    eventId,
    messages: personIds.map((personId) => ({ personId, text: "A short reply." })),
    ...extra,
  };
}

describe("God v2 hardening", () => {
  it("is disabled unless explicitly enabled", async () => {
    const h = makeKernel();
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock);
    const outcome = await bridge.submit({ type: "USER_MESSAGE", text: "hello", circleId: circleId(h.kernel) });
    expect(outcome.status).toBe("no_inference");
    expect(outcome.job).toBeUndefined();
  });

  it("uses the canonical selector and excludes do-not-disturb Persons", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const circle = h.kernel.circles.list().find((c) => c.name === "Inner Circle")!;
    const excluded = h.kernel.circles.memberPersonIds(circle.id)[0]!;
    h.kernel.setSocialIntensity(excluded, "do_not_disturb");
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const outcome = await bridge.submit({ type: "GROUP_INTERACTION", text: "quick check-in", circleId: circle.id });
    expect(outcome.status).toBe("needs_god");
    expect(outcome.job!.selectedPersonIds).not.toContain(excluded);
    expect(outcome.job!.input.participants.every((p) => p.why.length > 0)).toBe(true);
  });

  it("rehydrates the exact package after circle membership changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "god-v2-rehydrate-"));
    const file = join(root, "society.db");
    try {
      const first = createKernel({ dbPath: file }, { clock: new SimulatedClock() }, { sceneModelClass: "social.standard" });
      first.ensureSeeded();
      const circle = first.circles.list().find((c) => c.name === "Inner Circle")!;
      const bridge = new GodBridge(first, first.clock, "grok", true, "dry");
      const submitted = await bridge.submit({ type: "GROUP_INTERACTION", text: "remember this scene", circleId: circle.id });
      const expected = structuredClone(submitted.job!.input);
      for (const personId of first.circles.memberPersonIds(circle.id)) first.circles.removeMember(circle.id, personId);
      const eventId = submitted.job!.eventId;
      first.close();

      const second = createKernel({ dbPath: file }, { clock: new SimulatedClock() }, { sceneModelClass: "social.standard" });
      const reopened = new GodBridge(second, second.clock, "grok", true, "dry");
      expect(reopened.context(eventId)).toEqual(expected);
      expect(reopened.job(godJobId(eventId))?.status).toBe("AWAITING_GOD");
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not count a dry result as a provider call", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const submitted = await bridge.submit({ type: "USER_MESSAGE", text: "accounting check", circleId: circleId(h.kernel) });
    const applied = bridge.apply(result(submitted.job!.id, submitted.job!.eventId, submitted.job!.selectedPersonIds));
    expect(applied.usage.providerCallRecorded).toBe(false);
    expect(h.kernel.telemetry.totalCalls()).toBe(0);
    expect(bridge.usage().grok_calls).toBe(0);
  });

  it("persists messages and schedules future follow-ups without an immediate event", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const submitted = await bridge.submit({ type: "USER_MESSAGE", text: "schedule this", circleId: circleId(h.kernel) });
    const before = h.kernel.events.dueFollowups(h.clock.now()).length;
    const applied = bridge.apply(
      result(submitted.job!.id, submitted.job!.eventId, submitted.job!.selectedPersonIds, {
        followups: [{ personId: submitted.job!.selectedPersonIds[0]!, delayMs: 60_000, reason: "check in" }],
      }),
    );
    expect(applied.usage.stateChanges.messagesApplied).toBeGreaterThan(0);
    expect(h.kernel.events.dueFollowups(h.clock.now())).toHaveLength(before);
    expect(h.kernel.timeline.forPerson(submitted.job!.selectedPersonIds[0]!, 5).some((entry) => entry.kind === "message")).toBe(true);
  });

  it("rejects unknown relationship dimensions without creating a bond", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const submitted = await bridge.submit({ type: "USER_MESSAGE", text: "no invented dimensions", circleId: circleId(h.kernel) });
    const before = h.kernel.relationship.count();
    const applied = bridge.apply(
      result(submitted.job!.id, submitted.job!.eventId, submitted.job!.selectedPersonIds, {
        relationshipCandidates: [
          { personId: submitted.job!.selectedPersonIds[0]!, targetId: submitted.job!.selectedPersonIds[1]!, dim: "invented", delta: 1 },
        ],
      }),
    );
    expect(applied.usage.stateChanges.relationshipCandidates).toBe(0);
    expect(h.kernel.relationship.count()).toBe(before);
  });

  it("rejects an enabled bridge on a zero-cost route", async () => {
    const h = makeKernel();
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const outcome = await bridge.submit({ type: "USER_MESSAGE", text: "no paid route", circleId: circleId(h.kernel) });
    expect(outcome.status).toBe("no_inference");
    expect(outcome.costClass).not.toBe("GROK");
  });

  it("allows a dry bridge when the model tier would reject a live route", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard", budget: { modelTier: "mock" } });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const outcome = await bridge.submit({ type: "USER_MESSAGE", text: "dry tier check", circleId: circleId(h.kernel) });
    expect(outcome.status).toBe("needs_god");
  });

  it("persists the selected ids on the event row", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const outcome = await bridge.submit({ type: "GROUP_INTERACTION", text: "selected ids", circleId: circleId(h.kernel) });
    const row = h.kernel.db.prepare("SELECT person_ids_json FROM events WHERE id = ?").get(outcome.job!.eventId) as { person_ids_json: string };
    expect(JSON.parse(row.person_ids_json)).toEqual(outcome.job!.selectedPersonIds);
  });

  it("drops follow-ups outside the allowed delay range", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const outcome = await bridge.submit({ type: "USER_MESSAGE", text: "follow-up bounds", circleId: circleId(h.kernel) });
    const applied = bridge.apply(
      result(outcome.job!.id, outcome.job!.eventId, outcome.job!.selectedPersonIds, {
        followups: [{ personId: outcome.job!.selectedPersonIds[0]!, delayMs: 0, reason: "too soon" }],
      }),
    );
    expect(applied.usage.stateChanges.followups).toBe(0);
    expect(h.kernel.events.dueFollowups(h.clock.now())).toHaveLength(0);
  });

  it("uses reported live usage and records exactly one external call", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "live");
    const outcome = await bridge.submit({ type: "USER_MESSAGE", text: "measured call", circleId: circleId(h.kernel) });
    const applied = bridge.apply({
      ...result(outcome.job!.id, outcome.job!.eventId, outcome.job!.selectedPersonIds),
      usage: { inputTokens: 111, outputTokens: 22, reportedCost: 0.5, latencyMs: 50 },
    } as unknown as GodResult);
    expect(applied.usage.inputTokens).toBe(111);
    expect(applied.usage.outputTokens).toBe(22);
    expect(applied.usage.reportedCost).toBe(0.5);
    expect(applied.usage.estimatedCost).toBe(0.5);
    expect(applied.usage.providerCallRecorded).toBe(true);
    expect(h.kernel.telemetry.totalCalls()).toBe(1);
    expect(h.kernel.telemetry.recent()[0]?.estimatedCost).toBe(0.5);
  });

  it("restores a completed job with its terminal status", async () => {
    const root = mkdtempSync(join(tmpdir(), "god-v2-completed-"));
    const file = join(root, "society.db");
    try {
      const first = createKernel({ dbPath: file }, { clock: new SimulatedClock() }, { sceneModelClass: "social.standard" });
      first.ensureSeeded();
      const bridge = new GodBridge(first, first.clock, "grok", true, "dry");
      const outcome = await bridge.submit({ type: "USER_MESSAGE", text: "finish this", circleId: circleId(first) });
      bridge.apply(result(outcome.job!.id, outcome.job!.eventId, outcome.job!.selectedPersonIds));
      const eventId = outcome.job!.eventId;
      first.close();
      const second = createKernel({ dbPath: file }, { clock: new SimulatedClock() }, { sceneModelClass: "social.standard" });
      const reopened = new GodBridge(second, second.clock, "grok", true, "dry");
      expect(reopened.job(godJobId(eventId))?.status).toBe("COMPLETED");
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses live accounting when the configured budget is exhausted", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard", budget: { dailyBudget: 0 } });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "live");
    const outcome = await bridge.submit({ type: "USER_MESSAGE", text: "budget block", circleId: circleId(h.kernel) });
    expect(outcome.status).toBe("no_inference");
    expect(h.kernel.telemetry.totalCalls()).toBe(0);
  });

  it("uses the persisted model and mode when a result arrives in a fresh process", async () => {
    const root = mkdtempSync(join(tmpdir(), "god-v2-mode-"));
    const file = join(root, "society.db");
    try {
      const first = createKernel({ dbPath: file }, { clock: new SimulatedClock() }, { sceneModelClass: "social.standard" });
      first.ensureSeeded();
      const bridge = new GodBridge(first, first.clock, "chatgpt", true, "live");
      const submitted = await bridge.submit({ type: "USER_MESSAGE", text: "fresh result mode", circleId: circleId(first) });
      const eventId = submitted.job!.eventId;
      first.close();
      const second = createKernel({ dbPath: file }, { clock: new SimulatedClock() }, { sceneModelClass: "social.standard" });
      const reopened = new GodBridge(second, second.clock, "grok", false, "dry");
      const applied = reopened.apply({
        ...result(submitted.job!.id, eventId, submitted.job!.selectedPersonIds),
        usage: { inputTokens: 10, outputTokens: 5, reportedCost: 0.25 },
      });
      expect(applied.usage.mode).toBe("live");
      expect(applied.usage.provider).toBe("chatgpt");
      expect(applied.usage.estimatedCost).toBe(0.25);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a result whose job id does not match the persisted job", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const outcome = await bridge.submit({ type: "USER_MESSAGE", text: "job identity", circleId: circleId(h.kernel) });
    expect(() => bridge.apply({
      ...result("godjob_wrong", outcome.job!.eventId, outcome.job!.selectedPersonIds),
    })).toThrow(/unknown God job|job/i);
  });

  it("does not apply a result after pause or kill switch is engaged", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const paused = await bridge.submit({ type: "USER_MESSAGE", text: "pause after submit", circleId: circleId(h.kernel) });
    h.kernel.pause();
    expect(() => bridge.apply(result(paused.job!.id, paused.job!.eventId, paused.job!.selectedPersonIds))).toThrow(/paused/i);
    h.kernel.resume();
    const killed = await bridge.submit({ type: "USER_MESSAGE", text: "kill after submit", circleId: circleId(h.kernel) });
    h.kernel.setKillSwitch(true);
    expect(() => bridge.apply(result(killed.job!.id, killed.job!.eventId, killed.job!.selectedPersonIds))).toThrow(/kill|inference/i);
  });

  it("keeps live telemetry and budget accounting across a fresh process", async () => {
    const root = mkdtempSync(join(tmpdir(), "god-v2-telemetry-"));
    const file = join(root, "society.db");
    try {
      const first = createKernel({ dbPath: file }, { clock: new SimulatedClock() }, { sceneModelClass: "social.standard" });
      first.ensureSeeded();
      const bridge = new GodBridge(first, first.clock, "grok", true, "live");
      const submitted = await bridge.submit({ type: "USER_MESSAGE", text: "persistent telemetry", circleId: circleId(first) });
      bridge.apply({
        ...result(submitted.job!.id, submitted.job!.eventId, submitted.job!.selectedPersonIds),
        usage: { inputTokens: 10, outputTokens: 5, reportedCost: 0.25 },
      });
      first.close();
      const second = createKernel({ dbPath: file }, { clock: new SimulatedClock() }, { sceneModelClass: "social.standard" });
      expect(second.telemetry.totalCalls()).toBe(1);
      expect(second.telemetry.recent()[0]?.estimatedCost).toBe(0.25);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists the kill switch across CLI processes", () => {
    const root = mkdtempSync(join(tmpdir(), "god-v2-kill-"));
    const file = join(root, "society.db");
    try {
      const first = createKernel({ dbPath: file }, { clock: new SimulatedClock() });
      first.setKillSwitch(true);
      first.close();
      const second = createKernel({ dbPath: file }, { clock: new SimulatedClock() });
      expect(second.killSwitch).toBe(true);
      second.setKillSwitch(false);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("caps the complete structured output, not only message text", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "dry");
    const outcome = await bridge.submit({ type: "USER_MESSAGE", text: "bounded output", circleId: circleId(h.kernel) });
    bridge.apply({
      ...result(outcome.job!.id, outcome.job!.eventId, outcome.job!.selectedPersonIds),
      timelineCandidates: Array.from({ length: 10 }, (_, index) => ({
        personId: outcome.job!.selectedPersonIds[0]!,
        kind: "scene",
        content: `timeline ${index} ${"x".repeat(250)}`,
      })),
    });
    const row = h.kernel.db.prepare("SELECT payload_json FROM events WHERE id = ?").get(outcome.job!.eventId) as { payload_json: string };
    const scene = (JSON.parse(row.payload_json) as { sceneResult?: { output?: unknown } }).sceneResult?.output;
    expect(estimateTokens(JSON.stringify(scene))).toBeLessThanOrEqual(GOD_LIMITS.maxOutputTokens);
  });

  it("does not let a reported zero cost bypass modeled live spend", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, h.clock, "grok", true, "live");
    const outcome = await bridge.submit({ type: "USER_MESSAGE", text: "cost floor", circleId: circleId(h.kernel) });
    const applied = bridge.apply({
      ...result(outcome.job!.id, outcome.job!.eventId, outcome.job!.selectedPersonIds),
      usage: { inputTokens: 10, outputTokens: 5, reportedCost: 0 },
    });
    expect(applied.usage.estimatedCost).toBeGreaterThan(0);
    expect(h.kernel.telemetry.recent()[0]?.estimatedCost).toBeGreaterThan(0);
  });

  it("exposes one gateway-owned external accounting boundary", () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    const gateway = h.kernel.gateway as unknown as { acceptExternalResult?: unknown };
    expect(typeof gateway.acceptExternalResult).toBe("function");
  });
});
