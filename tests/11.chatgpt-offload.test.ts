import { describe, expect, it } from "vitest";

import { makeKernel } from "./helpers.ts";
import { SystemClock } from "../src/god/clock.ts";
import { GodBridge } from "../src/godbridge/GodBridge.ts";
import {
  ChatGPTBridge,
  ChatGPTBridgeDisabledError,
  renderStrategyLocally,
  validateStrategy,
  type ReasoningOffloadRequest,
  type SocialStrategy,
} from "../src/intelligence/offload.ts";

function request(participants: string[]): ReasoningOffloadRequest {
  return {
    objective: "Two friends disagree about tonight's plan; keep it warm",
    state: {
      eventId: "ev_1",
      scene: "USER_MESSAGE in circle",
      message: "what are we doing?",
      participants: participants.map((p) => ({ personId: p, name: p, roles: ["Close Friend"] })),
      relationships: [],
      memories: [],
    },
    constraints: { maxSpeakers: 3, maxOutputTokens: 400, recursion: 0 },
    desiredOutput: "social_strategy",
  };
}

describe("ChatGPT offload contract", () => {
  it("is disabled by default and refuses to reason", async () => {
    const bridge = new ChatGPTBridge({ enabled: false, modelClass: "social.standard" });
    await expect(bridge.reason(request(["a"]), ["a"])).rejects.toThrow(ChatGPTBridgeDisabledError);
  });

  it("stays disabled even when enabled without a transport", async () => {
    const bridge = new ChatGPTBridge({ enabled: true, modelClass: "social.standard" });
    await expect(bridge.reason(request(["a"]), ["a"])).rejects.toThrow(ChatGPTBridgeDisabledError);
  });

  it("never activates itself: the runtime ships no transport", () => {
    const h = makeKernel();
    expect(h.kernel.bridges.chatgpt.enabled).toBe(false);
  });

  it("returns a strategy, not prose, when a transport is injected", async () => {
    let received: ReasoningOffloadRequest | undefined;
    const bridge = new ChatGPTBridge({
      enabled: true,
      modelClass: "social.standard",
      call: async (r) => {
        received = r;
        return {
          objective: r.objective,
          beats: [
            { personId: "a", intent: "acknowledge the tension", tone: "warm", priority: 2 },
            { personId: "b", intent: "offer a middle path", tone: "calm", priority: 1 },
          ],
          conflicts: ["a wants early, b wants late"],
          rendering: "cheap_sufficient",
          confidence: 0.8,
        };
      },
    });
    const strategy = await bridge.reason(request(["a", "b"]), ["a", "b"]);
    expect(received?.desiredOutput).toBe("social_strategy");
    expect(strategy.beats.length).toBe(2);
    expect(strategy.rendering).toBe("cheap_sufficient");
  });

  it("drops beats for persons who were not in the scene", async () => {
    const strategy = validateStrategy(
      {
        objective: "x",
        beats: [
          { personId: "allowed", intent: "ok", tone: "warm" },
          { personId: "stranger", intent: "should be dropped", tone: "warm" },
        ],
        conflicts: [],
        rendering: "cheap_sufficient",
        confidence: 0.7,
      },
      ["allowed"],
      3,
    );
    expect(strategy.beats.map((b) => b.personId)).toEqual(["allowed"]);
  });

  it("caps beats at maxSpeakers", () => {
    const strategy = validateStrategy(
      {
        objective: "x",
        beats: ["a", "b", "c", "d"].map((p) => ({ personId: p, intent: "i", tone: "t" })),
        conflicts: [],
        rendering: "cheap_sufficient",
        confidence: 0.7,
      },
      ["a", "b", "c", "d"],
      2,
    );
    expect(strategy.beats.length).toBe(2);
  });

  it("rejects malformed strategies without calling another model", () => {
    expect(() => validateStrategy(null, ["a"], 3)).toThrow();
    expect(() => validateStrategy({ beats: [] }, ["a"], 3)).toThrow(/objective/);
    expect(() => validateStrategy({ objective: "x" }, ["a"], 3)).toThrow(/beats/);
  });

  it("cheap local rendering turns a strategy into a scene at zero cost", () => {
    const strategy: SocialStrategy = {
      objective: "keep it warm",
      beats: [
        { personId: "a", intent: "acknowledge", tone: "warm", anchor: "the road trip last spring", priority: 2 },
        { personId: "b", intent: "suggest", tone: "calm", priority: 1 },
      ],
      conflicts: [],
      rendering: "cheap_sufficient",
      confidence: 0.8,
    };
    const scene = renderStrategyLocally(strategy, 3);
    expect(scene.messages.length).toBe(2);
    expect(scene.messages[0]!.text).toContain("road trip last spring");
  });

  it("the offload loop does not require God at all", () => {
    const strategy: SocialStrategy = {
      objective: "x",
      beats: [{ personId: "a", intent: "speak", tone: "warm", priority: 1 }],
      conflicts: [],
      rendering: "cheap_sufficient",
      confidence: 0.6,
    };
    const scene = renderStrategyLocally(strategy, 3);
    expect(scene.messages.length).toBe(1);
  });
});

describe("offload composes with the God bridge", () => {
  it("a strategy that needs God escalates, and God still gets one call", async () => {
    const h = makeKernel({}, { sceneModelClass: "social.standard" });
    h.kernel.ensureSeeded();
    const bridge = new GodBridge(h.kernel, new SystemClock(), "grok", true, "dry");
    const circle = h.kernel.circles.list()[0]!.id;
    const out = await bridge.submit({ type: "USER_MESSAGE", text: "tension in the group", circleId: circle });
    expect(out.status).toBe("needs_god");
    const applied = bridge.apply({
      jobId: out.job!.id,
      eventId: out.job!.eventId,
      messages: out.job!.selectedPersonIds.map((p) => ({ personId: p, text: "let's keep it easy" })),
    });
    expect(applied.usage.stateChanges.messagesApplied).toBeGreaterThan(0);
    expect(h.kernel.usage().callsPerEvent).toBeLessThanOrEqual(1);
  });

  it("both external paths remain off in the default configuration", () => {
    const h = makeKernel();
    expect(h.kernel.bridges.socialcore.enabled).toBe(false);
    expect(h.kernel.bridges.chatgpt.enabled).toBe(false);
  });
});
