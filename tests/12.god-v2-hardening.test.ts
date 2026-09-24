import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeKernel } from "./helpers.ts";
import { createKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";
import { GodBridge, godJobId } from "../src/godbridge/GodBridge.ts";
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

  it("exposes one gateway-owned external accounting boundary", () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    const gateway = h.kernel.gateway as unknown as { acceptExternalResult?: unknown };
    expect(typeof gateway.acceptExternalResult).toBe("function");
  });
});
