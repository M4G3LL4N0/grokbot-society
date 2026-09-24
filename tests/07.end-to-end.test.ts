import { describe, expect, it } from "vitest";
import { makeKernel, sceneMessages } from "./helpers.ts";

describe("PROOF: MockProvider supports end-to-end operation", () => {
  it("boots, chats, remembers, befriends and schedules — all on $0 mock", async () => {
    const { kernel, clock, mock } = makeKernel();
    const circle = kernel.createCircle("Inner Circle");

    const emma = kernel.createPerson({ name: "Emma", interests: ["hiking"] });
    const alex = kernel.createPerson({ name: "Alex", interests: ["music"] });
    const maya = kernel.createPerson({ name: "Maya", interests: ["startups"] });
    for (const p of [emma, alex, maya]) {
      kernel.assignRole(p.id, "friend");
      kernel.joinCircle(circle.id, p.id);
    }

    // ---- direct interaction
    const direct = await kernel.tell("Emma, quick coffee this week?", { personIds: [emma.id] });
    expect(direct.status).toBe("persisted");
    expect(sceneMessages(direct).length).toBeGreaterThanOrEqual(1);
    expect(kernel.telemetry.providerCallsForEvent(direct.id)).toBe(1);

    // ---- group interaction (one inference for three people)
    const group = await kernel.tell("Weekend ideas? I'm free both days.", { circleId: circle.id });
    expect(group.status).toBe("persisted");
    expect(mock.calls).toBe(2); // exactly one per interactive event

    // ---- state persisted (timeline + memory + followup)
    expect(kernel.timeline.recent(50).length).toBeGreaterThan(0);
    expect(kernel.memory.count()).toBeGreaterThan(0);
    const pending = kernel.db
      .prepare("SELECT COUNT(*) AS n FROM followups WHERE status = 'pending'")
      .get() as { n: number };
    expect(pending.n).toBeGreaterThan(0);

    // ---- scheduled followup runs with ZERO background inference
    const before = kernel.stats().modelCalls;
    clock.advance(2 * 86_400_000);
    const processed = await kernel.tick();
    expect(processed).toBeGreaterThan(0);
    const followupEvents = kernel.db
      .prepare("SELECT COUNT(*) AS n FROM events WHERE event_type = 'SCHEDULED_FOLLOWUP'")
      .get() as { n: number };
    expect(followupEvents.n).toBeGreaterThan(0);
    expect(kernel.stats().backgroundCalls).toBe(0);
    expect(kernel.stats().modelCalls).toBe(before); // no additional inference from background

    // ---- a real relationship grew (with inertia) among scene speakers
    const pairs: Array<[string, string]> = [
      [emma.id, alex.id],
      [alex.id, maya.id],
      [emma.id, maya.id],
    ];
    const grown = pairs.filter(([a, b]) => {
      const r = kernel.relationship.get(a, b);
      return r != null && r.interactions > 0;
    });
    expect(grown.length).toBeGreaterThan(0);
    for (const [a, b] of pairs) {
      const r = kernel.relationship.get(a, b);
      if (r) expect(r.status).not.toBe("spouse"); // inertia guards the ladder
    }
  });

  it("relationship inertia: a single interaction cannot manufacture a spouse", () => {
    const { kernel } = makeKernel();
    const a = kernel.createPerson({ name: "A" });
    const b = kernel.createPerson({ name: "B" });

    // one huge romantic-on-paper interaction
    kernel.relate(a.id, b.id, {
      familiarity: 0.9,
      trust: 0.9,
      affection: 0.9,
      attraction: 0.9,
      comfort: 0.9,
      shared_history: 0.9,
    });
    let rel = kernel.relationship.get(a.id, b.id)!;
    expect(rel.status).toBe("stranger"); // damped by inertia + interaction threshold
    expect(rel.dims.familiarity).toBeCloseTo(0.135, 3); // 0.9 * learningRate(0.15)

    // long sustained history (in many small steps) earns partnership
    for (let i = 0; i < 30; i++) {
      kernel.relate(a.id, b.id, { familiarity: 0.9, trust: 0.9, affection: 0.9, comfort: 0.9 });
    }
    rel = kernel.relationship.get(a.id, b.id)!;
    expect(rel.interactions).toBe(31);
    expect(["partner", "best_friend", "romantic_interest"]).toContain(rel.status);
    expect(rel.status).not.toBe("spouse"); // needs 60+ interactions
  });

  it("knowledge privacy: no omniscient hive mind", () => {
    const { kernel } = makeKernel();
    const circle = kernel.createCircle("Inner Circle");
    const emma = kernel.createPerson({ name: "Emma" });
    const alex = kernel.createPerson({ name: "Alex" });
    const stranger = kernel.createPerson({ name: "Stranger" });
    kernel.joinCircle(circle.id, emma.id);
    kernel.joinCircle(circle.id, alex.id);

    kernel.memory.store({
      personId: emma.id,
      scope: "private",
      type: "note",
      content: "private: I dislike loud restaurants",
      source: "seed",
    });
    kernel.memory.store({
      personId: emma.id,
      scope: "circle",
      scopeRef: circle.id,
      type: "preference",
      content: "circle: Emma offers rooftop venue",
      source: "seed",
    });
    kernel.memory.store({
      personId: emma.id,
      scope: "public",
      type: "fact",
      content: "public: Emma joined the design team",
      source: "seed",
    });

    // private memory is invisible to everyone else
    const alexView = kernel.memory.retrieveForScene(alex.id, { participantIds: [emma.id], circleId: circle.id });
    expect(alexView.hot.map((m) => m.content).join(" ")).not.toContain("loud restaurants");

    // circle memory flows to co-members of the same circle
    const alexCircleView = kernel.memory.retrieveForScene(alex.id, { participantIds: [emma.id], circleId: circle.id });
    expect(alexCircleView.hot.some((m) => m.content.includes("rooftop venue"))).toBe(true);

    // non-members cannot see circle memory, even when a circleId is passed
    const outsiderView = kernel.memory.retrieveForScene(stranger.id, { participantIds: [emma.id], circleId: circle.id });
    expect(outsiderView.hot.some((m) => m.content.includes("rooftop venue"))).toBe(false);

    // public facts are visible to everyone
    expect(outsiderView.hot.some((m) => m.content.includes("design team"))).toBe(true);
  });

  it("intelligence cache reuses identical requests without a second provider call", async () => {
    const { kernel, mock } = makeKernel();
    const req = {
      eventId: "ev-cache",
      caller: "test",
      reason: "scene",
      modelClass: "social.mock" as const,
      shape: "scene" as const,
      context: ["__meta__ {}\nidentical scene"],
    };
    await kernel.gateway.generate(req);
    expect(mock.calls).toBe(1);
    await kernel.gateway.generate(req);
    expect(mock.calls).toBe(1); // served from cache
    expect(kernel.telemetry.recent(10)[0]!.cacheStatus).toBe("hit");
    expect(kernel.cache.stats().hits).toBe(1);
  });
});