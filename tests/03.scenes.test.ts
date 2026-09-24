import { describe, expect, it } from "vitest";
import { makeKernel, sceneMessages, selectedIds } from "./helpers.ts";

describe("PROOF: single-inference scenes", () => {
  function threePersonCircle() {
    const { kernel, mock } = makeKernel();
    const circle = kernel.createCircle("Inner Circle");
    const emma = kernel.createPerson({ name: "Emma", interests: ["hiking", "design"] });
    const alex = kernel.createPerson({ name: "Alex", interests: ["books", "music"] });
    const maya = kernel.createPerson({ name: "Maya", interests: ["startups", "running"] });
    for (const p of [emma, alex, maya]) {
      kernel.assignRole(p.id, "friend");
      kernel.joinCircle(circle.id, p.id);
    }
    kernel.relate(emma.id, alex.id, { familiarity: 0.5, affection: 0.4 });
    kernel.relate(emma.id, maya.id, { familiarity: 0.6 });
    kernel.relate(alex.id, maya.id, { familiarity: 0.3 });
    return { kernel, mock, circle, emma, alex, maya };
  }

  it("three-person group scene makes at most one model request", async () => {
    const { kernel, mock, circle } = threePersonCircle();
    const event = await kernel.tell("Who's up for a weekend hike somewhere not too crowded?", {
      circleId: circle.id,
    });
    expect(event.status).toBe("persisted");
    expect(mock.calls).toBe(1);
    expect(kernel.stats().modelCalls).toBe(1);
    expect(kernel.telemetry.providerCallsForEvent(event.id)).toBe(1);

    const messages = sceneMessages(event);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.length).toBeLessThanOrEqual(3);
    const speakers = new Set(messages.map((m) => m.personId));
    for (const speakerId of speakers) {
      expect(kernel.getPerson(speakerId)).not.toBeNull();
    }
  });

  it("only selected participants enter model context", async () => {
    const { kernel, mock, circle } = threePersonCircle();
    const event = await kernel.tell("Let's plan a small kickoff trip.", { circleId: circle.id });
    const selected = selectedIds(event);
    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(selected.length).toBeLessThanOrEqual(3);

    const meta = JSON.parse(
      mock.lastRequest!.context.find((s) => s.startsWith("__meta__"))!.slice("__meta__".length),
    ) as { participants: string[] };

    // the participants in the model context are exactly the selected set
    expect(new Set(meta.participants)).toEqual(new Set(selected));

    const selectedNames = new Set(
      selected.map((id) => kernel.getPerson(id)!.name),
    );
    const profileNames = new Set<string>();
    for (const section of mock.lastRequest!.context) {
      if (section.startsWith("PROFILE ")) {
        const name = section.slice("PROFILE ".length).split(" [")[0]!;
        profileNames.add(name);
      }
    }
    expect(profileNames.size).toBe(selected.length);
    for (const name of profileNames) {
      expect(selectedNames.has(name)).toBe(true);
    }
    // no unselected person's profile ever skins into context
    for (const person of kernel.persons.list(100, 0)) {
      if (!selected.includes(person.id)) {
        expect(profileNames.has(person.name)).toBe(false);
      }
    }
  });

  it("silence is valid: nobody available → no inference, no fake chatter", async () => {
    const { kernel, mock, circle } = threePersonCircle();
    for (const p of kernel.persons.list(100, 0)) {
      kernel.setSocialIntensity(p.id, "do_not_disturb");
    }
    const event = await kernel.tell("Anyone home?", { circleId: circle.id });
    expect(event.status).toBe("silent");
    expect(sceneMessages(event)).toHaveLength(0);
    expect(mock.calls).toBe(0);
    expect(kernel.stats().modelCalls).toBe(0);
  });

  it("never activates everyone in a circle: 10 members → at most 3 speakers", async () => {
    const { kernel, mock } = makeKernel();
    const circle = kernel.createCircle("Big Circle");
    const persons: string[] = [];
    for (let i = 0; i < 10; i++) {
      const p = kernel.createPerson({ name: `M${i}`, interests: ["hiking"] });
      kernel.assignRole(p.id, "friend");
      kernel.joinCircle(circle.id, p.id);
      persons.push(p.id);
    }
    const event = await kernel.tell("Trail run Saturday?", { circleId: circle.id });
    const selected = selectedIds(event);
    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(persons.length).toBe(10);
    expect(mock.calls).toBe(1);
  });
});