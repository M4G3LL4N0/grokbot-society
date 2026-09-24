import { describe, expect, it } from "vitest";
import { makeKernel } from "./helpers.ts";
import { ALL_ROLES } from "../src/seed/roles.ts";

describe("PROOF: mass creation is zero-inference", () => {
  it("creating 1,000 Persons makes zero model calls", () => {
    const { kernel, mock } = makeKernel({ maxPersons: 5000 });
    for (let i = 0; i < 1000; i++) {
      kernel.createPerson({ name: `P${i}`, biography: `person number ${i}` });
    }
    expect(kernel.persons.count()).toBe(1000);
    expect(kernel.stats().modelCalls).toBe(0);
    expect(mock.calls).toBe(0);
    expect(kernel.telemetry.totalCalls()).toBe(0);
  });

  it("assigning 1,000 Roles makes zero model calls", () => {
    const { kernel, mock } = makeKernel();
    const persons: string[] = [];
    for (let i = 0; i < 1000; i++) persons.push(kernel.createPerson({ name: `R${i}` }).id);
    const roleIds = kernel.roles.list().map((r) => r.id);
    expect(roleIds.length).toBe(ALL_ROLES.length);
    persons.forEach((p, i) => {
      kernel.roles.assign(p, roleIds[i % roleIds.length]!);
    });
    expect(kernel.stats().modelCalls).toBe(0);
    expect(mock.calls).toBe(0);
    // spot-check assignments landed
    const first = kernel.persons.list(1, 0)[0]!;
    expect(kernel.roles.assignments(first.id).length).toBe(1);
  });

  it("creating 100 Circles makes zero model calls", () => {
    const { kernel, mock } = makeKernel();
    const before = kernel.circles.count();
    for (let i = 0; i < 100; i++) kernel.createCircle(`Circle ${i}`);
    expect(kernel.circles.count() - before).toBe(100);
    expect(kernel.stats().modelCalls).toBe(0);
    expect(mock.calls).toBe(0);
  });

  it("adding thousands of relationships makes zero model calls", () => {
    const { kernel, mock } = makeKernel();
    const persons: string[] = [];
    for (let i = 0; i < 200; i++) persons.push(kernel.createPerson({ name: `L${i}` }).id);
    const before = kernel.relationship.count();
    for (let i = 0; i < persons.length; i++) {
      for (let j = i + 1; j < persons.length && j < i + 12; j++) {
        kernel.relate(persons[i]!, persons[j]!, {
          familiarity: 0.4,
          comfort: 0.2,
        });
      }
    }
    expect(kernel.relationship.count() - before).toBeGreaterThanOrEqual(2000);
    expect(kernel.stats().modelCalls).toBe(0);
    expect(mock.calls).toBe(0);
    expect(kernel.cache.stats().misses).toBe(0);
  });
});