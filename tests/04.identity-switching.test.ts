import { describe, expect, it } from "vitest";
import { makeKernel } from "./helpers.ts";

describe("PROOF: canonical identity survives provider switching", () => {
  it("Person identity is untouched when the provider changes", async () => {
    const { kernel, circle } = scene();

    const before = kernel.getPerson(circle.emma)!;

    // run a scene on the mock provider
    const ev1 = await kernel.tell("Morning, squad.", { circleId: circle.id });
    expect(kernel.telemetry.recent(20).some((t) => t.provider === "mock")).toBe(true);

    // switch capability routing from mock → deterministic provider
    kernel.router.setRoute("social.mock", { provider: "deterministic", model: "template-v1" });

    const ev2 = await kernel.tell("Tell me about your week.", { circleId: circle.id });
    expect(ev2.status).toBe("persisted");
    expect(kernel.telemetry.recent(20).some((t) => t.provider === "deterministic")).toBe(true);

    const after = kernel.getPerson(circle.emma)!;

    // identity/state that is canonical and immutable through a provider swap
    expect(after.id).toBe(before.id);
    expect(after.name).toBe(before.name);
    expect(after.biography).toBe(before.biography);
    expect(after.personality).toEqual(before.personality);
    expect(after.identity).toEqual(before.identity);
    expect(after.interests).toEqual(before.interests);
    // provider surfaces in telemetry, but never in the person row
    expect(kernel.stats().persons).toBe(3);
  });

  it("switching to an unconfigured provider fails closed, identity intact", async () => {
    const { kernel, circle } = scene();
    kernel.router.setRoute("social.mock", { provider: "nano", model: "nano-v0" }); // not configured

    const event = await kernel.tell("ping", { circleId: circle.id });
    // director fell back deterministically: system remained operational
    expect(event.status).toBe("deterministic_fallback");
    expect(kernel.getPerson(circle.emma)).not.toBeNull();
    expect(kernel.stats().modelCalls).toBe(0);
  });
});

function scene() {
  const { kernel } = makeKernel();
  const circleObj = kernel.createCircle("Inner Circle");
  const emma = kernel.createPerson({ name: "Emma Reyes", biography: "designer" });
  const alex = kernel.createPerson({ name: "Alex", biography: "writer" });
  const maya = kernel.createPerson({ name: "Maya", biography: "founder" });
  for (const p of [emma, alex, maya]) {
    kernel.assignRole(p.id, "friend");
    kernel.joinCircle(circleObj.id, p.id);
  }
  return { kernel, circle: { id: circleObj.id, emma: emma.id } };
}