import { describe, expect, it } from "vitest";
import { makeKernel } from "./helpers.ts";
import {
  BudgetExceededError,
  KillSwitchError,
  ModelUnavailableError,
  RecursionBlockedError,
} from "../src/god/errors.ts";
import {
  assertGatewalledCall,
  type Provider,
  type ProviderRequest,
  type ProviderResult,
} from "../src/providers/types.ts";
import type { ModelClass } from "../src/god/types.ts";

describe("PROOF: gateways fail closed", () => {
  it("kill switch prevents all model calls", async () => {
    const { kernel, mock } = makeKernel({}, { killSwitch: true });

    await expect(
      kernel.gateway.generate({
        eventId: "ev-kill",
        caller: "test",
        reason: "scene",
        modelClass: "social.mock",
        context: ["__meta__ {}\nhello"],
      }),
    ).rejects.toBeInstanceOf(KillSwitchError);
    expect(mock.calls).toBe(0);

    // end-to-end: society stays deterministic and operational
    const circle = kernel.createCircle("Inner Circle");
    const p1 = kernel.createPerson({ name: "A" });
    const p2 = kernel.createPerson({ name: "B" });
    kernel.joinCircle(circle.id, p1.id);
    kernel.joinCircle(circle.id, p2.id);
    const event = await kernel.tell("anyone there?", { circleId: circle.id });
    expect(event.status).toBe("deterministic_fallback");
    expect(mock.calls).toBe(0);
    expect(kernel.stats().modelCalls).toBe(0);
  });

  it("budget limit prevents model calls beyond max_calls_per_event", async () => {
    const { kernel, mock } = makeKernel({}, { budget: { maxCallsPerEvent: 1 } });

    const req = {
      eventId: "ev-budget",
      caller: "test",
      reason: "scene",
      modelClass: "social.mock" as const,
      shape: "scene" as const,
      context: ["__meta__ {}\nfirst"],
      skipCache: true,
    };
    await kernel.gateway.generate(req);
    expect(mock.calls).toBe(1);

    await expect(kernel.gateway.generate(req)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(mock.calls).toBe(1); // second attempt never reached the provider
    expect(kernel.telemetry.totalCalls()).toBe(1);
  });

  it("recursion cannot occur (recursionDepth = 0)", async () => {
    const { kernel } = makeKernel();
    const blocking = new BlockingProvider();
    kernel.gateway.register(blocking);
    kernel.router.setRoute("social.mock", { provider: "blocking", model: "b1" });

    const req = {
      eventId: "ev-rec",
      caller: "test",
      reason: "scene",
      modelClass: "social.mock" as const,
      shape: "scene" as const,
      context: ["__meta__ {}\nhold"],
      skipCache: true,
    };

    const inFlight = kernel.gateway.generate(req);
    await waitFor(() => blocking.entered === 1);

    // a second inference on the same event chain while one is in flight
    await expect(kernel.gateway.generate(req)).rejects.toBeInstanceOf(
      RecursionBlockedError,
    );
    expect(blocking.calls).toBe(1);

    blocking.release();
    await inFlight;
    expect(blocking.calls).toBe(1);
  });

  it("attempting a call through a recursive follow-up is blocked too", async () => {
    const { kernel } = makeKernel();
    // canReserve preflight refuses nested background inference for the same event
    const allowed = kernel.budget.canReserve({
      eventId: "x",
      reason: "scene",
      reasonKind: "foreground",
      modelClass: "social.mock",
      estimatedInputTokens: 100,
      estimatedOutputTokens: 100,
    });
    expect(allowed).toBe(true);
    const allowance = kernel.budget.reserve({
      eventId: "x",
      reason: "scene",
      reasonKind: "foreground",
      modelClass: "social.mock",
      estimatedInputTokens: 100,
      estimatedOutputTokens: 100,
      estimatedCost: 0,
    });
    try {
      await expect(
        Promise.resolve(kernel.budget.canReserve({
          eventId: "x",
          reason: "scene",
          reasonKind: "foreground",
          modelClass: "social.mock",
          estimatedInputTokens: 100,
          estimatedOutputTokens: 100,
        })),
      ).resolves.toBe(false);
    } finally {
      allowance.release();
    }
  });

  it("unavailable model class fails closed (no fallback to paid)", async () => {
    const { kernel, mock } = makeKernel();
    // point a capability at the not-yet-configured stub: configured routes are
    // the operator's choice; here standard maps to an unconfigured stub.
    kernel.router.setRoute("social.standard", { provider: "standard", model: "stub-v1" });
    await expect(
      kernel.gateway.generate({
        eventId: "ev-unavail",
        caller: "test",
        reason: "scene",
        modelClass: "social.standard",
        context: ["hi"],
      }),
    ).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(mock.calls).toBe(0);
  });
});

class BlockingProvider implements Provider {
  readonly name = "blocking";
  readonly supports: ModelClass[] = ["social.mock"];
  calls = 0;
  entered = 0;
  private releaseFn: (() => void) | null = null;

  isAvailable(): boolean {
    return true;
  }

  async generate(_request: ProviderRequest): Promise<ProviderResult> {
    assertGatewalledCall();
    this.calls += 1;
    this.entered += 1;
    const usage = { inputTokens: 1, outputTokens: 1 };
    return new Promise<ProviderResult>((resolve) => {
      this.releaseFn = () =>
        resolve({
          provider: "blocking",
          model: "b1",
          content: JSON.stringify({ messages: [] }),
          usage,
          cost: 0,
        });
    });
  }

  release(): void {
    this.releaseFn?.();
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}