import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { makeKernel, type KernelHarness, sceneMessages, selectedIds } from "./helpers.ts";
import { createKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";
import type { BoundedScenePackage } from "../src/intelligence/bridges.ts";

let h: KernelHarness;

beforeEach(() => {
  h = makeKernel();
});

function seeded() {
  h.kernel.ensureSeeded();
  return h.kernel;
}

function emmaId(k = h.kernel): string {
  return k.persons.list(1000).find((p) => p.name === "Emma Reyes")!.id;
}

function innerCircleId(k = h.kernel): string {
  return k.circles.list().find((c) => c.name === "Inner Circle")!.id;
}

describe("08 · Society MVP", () => {
  it("seeds the 5-person demo society with zero inference", () => {
    const k = seeded();
    const s = k.stats();
    expect(s.persons).toBe(5);
    expect(s.roles).toBe(29);
    expect(k.relationship.count()).toBeGreaterThanOrEqual(9);
    expect(k.memory.landmarksFor(emmaId(k)).length).toBe(3);
    expect(s.circles).toBeGreaterThanOrEqual(6);
    expect(k.circles.memberPersonIds(innerCircleId(k)).length).toBe(5);
    expect(s.modelCalls).toBe(0);
  });

  it("ensureSeeded is idempotent (no duplicates, no inflation)", () => {
    const k = seeded();
    const persons = k.persons.count();
    const rels = k.relationship.count();
    const mem = k.memory.count();
    const evs = (k.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
    k.ensureSeeded();
    k.ensureSeeded();
    expect(k.persons.count()).toBe(persons);
    expect(k.relationship.count()).toBe(rels);
    expect(k.memory.count()).toBe(mem);
    expect((k.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(evs);
  });

  it("role composition compiles a bounded, deterministic Actor Context", () => {
    const k = seeded();
    const a = emmaId(k);
    const others = k.persons.list(1000).filter((p) => p.id !== a).map((p) => p.id);
    const ctx1 = k.composeActorContext(a, "ev:x", others, innerCircleId(k));
    const ctx2 = k.composeActorContext(a, "ev:x", others, innerCircleId(k));
    expect(ctx1).toEqual(ctx2);
    expect(ctx1.roles.length).toBeGreaterThan(0); // Emma has 4 roles
    expect(ctx1.relationships.length).toBeLessThanOrEqual(4);
    expect(ctx1.memories.length).toBeLessThanOrEqual(5); // bounded memory set
    expect(ctx1.card.name).toBe("Emma Reyes");
    expect(ctx1.card.archetype).toBeTruthy();
    expect(ctx1.sceneRef).toBe("ev:x");
  });

  it("roles, circles and entity routes never create agents", () => {
    const k = seeded();
    const before = k.persons.count();
    const e = emmaId(k);
    k.assignRole(e, "wildcard");
    k.joinCircle(k.circles.list().find((c) => c.name === "Travel Crew")!.id, e);
    expect(k.entityCreate("god").kind).toBe("god");
    expect(k.entityCreate("person").kind).toBe("person");
    expect(k.entityCreate("bridge").kind).toBe("bridge");
    expect(k.persons.count()).toBe(before);
    expect(k.router.escalationCount()).toBe(0);
  });

  it("renders a bounded group scene in ONE provider call at $0", async () => {
    const k = seeded();
    const ev = await k.tell("Anyone up for dinner tonight?", { circleId: innerCircleId(k) });
    expect(ev.status).toBe("persisted");
    expect(sceneMessages(ev).length).toBeGreaterThan(0);
    expect(sceneMessages(ev).length).toBeLessThanOrEqual(3); // hardMaxSpeakers
    expect(selectedIds(ev).length).toBeGreaterThan(0);
    expect(k.telemetry.providerCallsForEvent(ev.id)).toBe(1); // one call per scene
    expect(k.telemetry.totalCost()).toBe(0); // mock provider => $0
  });

  it("sessions bound the rolling context (no full transcript)", () => {
    const k = seeded();
    const emma = emmaId(k);
    const s = k.sessionStart({ kind: "evening_social", circleId: innerCircleId(k), participantIds: [emma] });
    for (let i = 0; i < 12; i++) {
      k.sessionAppend(s.id, { role: i % 2 === 0 ? "user" : "person", personId: i % 2 === 0 ? null : emma, text: `message ${i}` });
    }
    const ctx = k.sessionContext(s.id);
    expect(ctx.messages.length).toBeLessThanOrEqual(6); // rollingMessageWindow
    expect(ctx.participants.length).toBeLessThanOrEqual(4); // maxParticipantCards
    expect(k.sessionMessages(s.id).length).toBe(12); // durable full log, prompt stays bounded
    const ended = k.sessionEnd(s.id);
    expect(ended?.status).toBe("ended");
  });

  it("shared-history landmarks are stored once per pair", () => {
    const k = seeded();
    const e = emmaId(k);
    const l = k.persons.list(1000).find((p) => p.name === "Leo Magnusson")!.id;
    k.landmark(e, l, "milestone", "they finally finished the thru-hike together", 0.9);
    const before = k.memory.landmarksFor(e, l).length;
    k.landmark(e, l, "milestone", "they finally finished the thru-hike together", 0.9);
    expect(k.memory.landmarksFor(e, l).length).toBe(before + 2); // one row per party
    expect(k.memory.landmarksFor(e).some((m) => m.content.includes("thru-hike"))).toBe(true);
  });

  describe("proactive pacing", () => {
    it("is disabled by default: candidates → NO_ACTION, zero calls", async () => {
      const k = seeded();
      const r = await k.proactiveTick();
      expect(r.reaches).toBe(0);
      expect(r.candidates).toBeGreaterThan(0);
      expect(k.telemetry.totalCalls()).toBe(0);
      expect(k.usage().proactive.noActions).toBe(r.candidates);
    });

    it("stays NO_ACTION below the relevance threshold even when enabled", async () => {
      const { kernel } = makeKernel({
        proactive: { enabled: true, minRelevance: 5 },
      });
      kernel.ensureSeeded();
      const r = await kernel.proactiveTick();
      expect(r.reaches).toBe(0);
      expect(kernel.telemetry.totalCalls()).toBe(0);
      const ev = await kernel.events.receive({
        eventType: "PROACTIVE_REACH",
        actorId: "user",
        personIds: [emmaId(kernel)],
        circleId: innerCircleId(kernel),
        payload: { pacingScore: 0.1 },
        source: "proactive",
      });
      expect(ev.status).toBe("no_action");
    });

    it("fires bounded reaches with budget + cooldown when configured", async () => {
      const { kernel, clock } = makeKernel({
        proactive: {
          enabled: true,
          minRelevance: 0.5,
          cooldownMs: 86_400_000,
          maxReachesPerTick: 5, // cover every eligible circle member so tick 2 is blocked by cooldown, not the tick cap
          budgetPerDay: 10,
        },
      });
      kernel.ensureSeeded();
      const r = await kernel.proactiveTick(innerCircleId(kernel));
      expect(r.reaches).toBeGreaterThan(0);
      expect(r.reaches).toBeLessThanOrEqual(5);
      const reachEvents = (kernel.db.prepare("SELECT * FROM events WHERE event_type = 'PROACTIVE_REACH'").all() as Array<{ id: string }>);
      expect(reachEvents.length).toBe(r.reaches);
      for (const ev of reachEvents) {
        expect(kernel.telemetry.providerCallsForEvent(ev.id)).toBe(1); // one call per reach
      }
      // cooldown holds: even after other activity, an immediate re-tick adds nothing
      clock.advance(60_000);
      const r2 = await kernel.proactiveTick(innerCircleId(kernel));
      expect(r2.reaches).toBe(0);
      // ...until the cooldown window elapses
      clock.advance(86_400_000);
      const r3 = await kernel.proactiveTick(innerCircleId(kernel));
      expect(r3.reaches).toBeGreaterThan(0);
    });
  });

  describe("circuit breakers", () => {
    it("trip on event explosion, context overflow and fan-out", () => {
      const k = h.kernel;
      for (let i = 0; i < 25; i++) k.breakers.observeEvent();
      expect(k.breakers.isTripped("rapid_event_explosion")).toBe(true);
      k.breakers.observeContextOverflow("sections=400");
      expect(k.breakers.isTripped("context_explosion")).toBe(true);
      k.breakers.observeFanout(9);
      expect(k.breakers.isTripped("participant_fan_out")).toBe(true);
      k.breakers.observeFailure();
      k.breakers.observeFailure();
      k.breakers.observeFailure();
      k.breakers.observeFailure();
      expect(k.breakers.isTripped("repeated_provider_failure")).toBe(true);
      expect(k.breakers.recentTrips().length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("cost simulator", () => {
    it("keeps dormant populations at ~$0", () => {
      const k = h.kernel;
      const reports = k.cost.report([5, 50, 500, 5000]);
      const last = reports[3]!;
      const proactive = last.find((s) => s.name.includes("proactive"))!;
      expect(proactive.modelCalls).toBe(0);
      expect(proactive.dormant).toBeGreaterThan(4900);
      expect(proactive.note).toContain("dormant");
      for (const s of last) {
        expect(s.dormant).toBeGreaterThanOrEqual(4980);
        expect(s.estimatedSpend).toBeGreaterThanOrEqual(0);
      }
      // active-only scenarios are the only spend driver
      expect(last.find((s) => s.name.includes("1:1"))!.modelCalls).toBeGreaterThan(0);
    });
  });

  describe("telemetry + governance", () => {
    it("usage explains every call and every blocked call", async () => {
      const k = seeded();
      await k.tell("hello", { circleId: innerCircleId(k) });
      k.setKillSwitch(true);
      const ev = await k.tell("blocked scenario", { circleId: innerCircleId(k) });
      expect(ev.status).toBe("deterministic_fallback");
      k.setKillSwitch(false);
      const u = k.usage();
      expect(u.callsToday).toBeGreaterThan(0);
      expect(u.callsPerEvent).toBeLessThanOrEqual(1); // one call per event cap
      expect(u.spendPerProvider["mock"]).toBeDefined();
      expect(u.providerEscalations).toBe(0);
      expect(u.blockedCalls).toBeGreaterThan(0);
      expect(u.proactive.enabled).toBe(false);
      expect(Array.isArray(u.trips)).toBe(true);
    });

    it("bridges are disabled contracts that can never cost money", async () => {
      const k = h.kernel;
      const cap = k.capableRenderers();
      const socialcore = cap.find((r) => r.name === "socialcore")!;
      const chatgpt = cap.find((r) => r.name === "chatgpt")!;
      expect(socialcore.enabled).toBe(false);
      expect(chatgpt.enabled).toBe(false);
      const pkg = {} as unknown as BoundedScenePackage;
      await expect(k.bridges.socialcore.renderScene(pkg)).rejects.toThrow(/disabled/i);
      await expect(k.bridges.chatgpt.renderScene(pkg)).rejects.toThrow(/disabled/i);
      expect(k.telemetry.totalCalls()).toBe(0);
    });
  });

  describe("pause / resume / kill switch", () => {
    it("pause blocks chat, resume restores it", async () => {
      const k = seeded();
      k.pause();
      await expect(k.tell("hi")).rejects.toThrow(/paused/i);
      k.resume();
      const ev = await k.tell("hi", { circleId: innerCircleId(k) });
      expect(ev.status).toBe("persisted");
    });

    it("kill switch fails ALL inference closed, deterministic output remains", async () => {
      const k = seeded();
      k.setKillSwitch(true);
      const ev = await k.tell("anything", { circleId: innerCircleId(k) });
      expect(ev.status).toBe("deterministic_fallback");
      expect((ev.payload.sceneResult as { blockedReason: string }).blockedReason).toMatch(/KillSwitch/i);
      expect(k.budget.blockedCallCount()).toBeGreaterThan(0);
    });
  });

  describe("restart persistence", () => {
    it("preserves canonical state across processes via a file database", () => {
      const file = join(tmpdir(), `society-restart-${randomUUID()}.db`);
      try {
        const clock = new SimulatedClock();
        let k = createKernel({ dbPath: file }, { clock });
        k.ensureSeeded();
        const after = {
          persons: k.persons.count(),
          rels: k.relationship.count(),
          mem: k.memory.count(),
          evs: (k.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n,
        };
        k.close();

        // simulate a fresh process: new kernel, same file, re-seeded
        k = createKernel({ dbPath: file }, { clock: new SimulatedClock() });
        k.ensureSeeded();
        expect(k.persons.count()).toBe(after.persons);
        expect(k.relationship.count()).toBe(after.rels);
        expect(k.memory.count()).toBe(after.mem);
        expect((k.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(after.evs);
        expect(k.getUserInfo().userId).toBeTruthy();
        k.close();
      } finally {
        rmSync(file, { force: true });
        rmSync(`${file}-wal`, { force: true });
        rmSync(`${file}-shm`, { force: true });
      }
    });
  });
});