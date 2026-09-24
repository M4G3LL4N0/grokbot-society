import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/providers/MockProvider.ts";
import { DeterministicProvider } from "../src/providers/DeterministicProvider.ts";
import { RemoteStubProvider } from "../src/providers/RemoteStubProvider.ts";
import { ProviderCallOutsideGatewayError, assertGatewalledCall } from "../src/providers/types.ts";
import { makeKernel } from "./helpers.ts";

describe("PROOF: provider calls outside IntelligenceGateway are architecturally blocked", () => {
  it("direct provider invocation throws ProviderCallOutsideGatewayError", async () => {
    const mock = new MockProvider();
    await expect(
      mock.generate({
        modelClass: "social.mock",
        shape: "scene",
        context: ["__meta__ {}\nhello"],
      }),
    ).rejects.toBeInstanceOf(ProviderCallOutsideGatewayError);
    expect(mock.calls).toBe(0);
  });

  it("every built-in provider is gated the same way", async () => {
    const deterministic = new DeterministicProvider();
    await expect(
      deterministic.generate({ modelClass: "social.deterministic", shape: "scene", context: ["x"] }),
    ).rejects.toBeInstanceOf(ProviderCallOutsideGatewayError);

    const deep = new RemoteStubProvider("deep");
    await expect(
      deep.generate({ modelClass: "social.deep", shape: "scene", context: ["x"] }),
    ).rejects.toBeInstanceOf(ProviderCallOutsideGatewayError);
    expect(deterministic.calls).toBe(0);
  });

  it("the gateway context guard is what providers enforce", async () => {
    // Inside a gateway diary the very same mock call succeeds.
    const { kernel } = makeKernel();
    const mock = kernel.gateway.getProvider("mock") as MockProvider;
    expect(assertGatewalledCall).toThrow(); // running outside any diary here
    const result = await kernel.gateway.generate({
      eventId: "ev-gated",
      caller: "test",
      reason: "scene",
      modelClass: "social.mock",
      context: ["__meta__ {}\ninside gateway"],
      skipCache: true,
    });
    expect(result.provider).toBe("mock");
    expect(mock.calls).toBe(1);
  });
});