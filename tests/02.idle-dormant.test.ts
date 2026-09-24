import { describe, expect, it } from "vitest";
import { makeKernel } from "./helpers.ts";

describe("PROOF: lazy world + dormant state is zero-inference", () => {
  it("idle elapsed time makes zero model calls", async () => {
    const { kernel, clock, mock } = makeKernel();
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push(kernel.createPerson({ name: `D${i}` }).id);
    const circle = kernel.createCircle("Quiet Circle");
    for (const id of ids) kernel.joinCircle(circle.id, id);

    expect(kernel.stats().modelCalls).toBe(0);
    clock.advance(21 * 86_400_000); // three weeks of silence
    const processed = await kernel.tick();
    expect(processed).toBe(0);
    expect(kernel.stats().modelCalls).toBe(0);
    expect(mock.calls).toBe(0);
    expect(kernel.stats().events).toBe(0); // no events synthesized per missed day
  });

  it("dormant society state consumes zero inference", async () => {
    const { kernel, clock, mock } = makeKernel();
    for (let i = 0; i < 100; i++) kernel.createPerson({ name: `S${i}` });

    // 1,000 "days" of dormancy
    clock.advance(1000 * 86_400_000);

    // waking a dormant person resolves ONLY minimal missing state.
    const personId = kernel.persons.list(1, 0)[0]!.id;
    const woken = kernel.wakeLazy(personId);
    expect(woken).not.toBeNull();
    expect(woken!.currentState.dormantDays).toBe(1000);
    expect(typeof woken!.currentState.mood).toBe("number");
    expect(kernel.stats().modelCalls).toBe(0);
    expect(mock.calls).toBe(0);
    // exactly one resolution artifact, not one event per missed day
    expect(kernel.timeline.forPerson(personId).filter((e) => e.kind === "wake")).toHaveLength(1);
    // relationships/circles/persons are untouched dormant state
    expect(kernel.relationship.count()).toBe(0);
    expect(kernel.stats().events).toBe(0);
  });

  it("serendipity does not manufacture activity for idle societies", async () => {
    const { kernel, clock, mock } = makeKernel({}, undefined, () => 0); // rng always triggers serendipity
    kernel.createPerson({ name: "Only" });
    const before = kernel.persons.count();
    clock.advance(30 * 86_400_000);
    await kernel.tick();
    expect(kernel.persons.count()).toBe(before); // no models, no new people invented out of thin air
    expect(kernel.stats().modelCalls).toBe(0);
    expect(mock.calls).toBe(0);
  });
});