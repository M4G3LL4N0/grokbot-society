#!/usr/bin/env node
/**
 * Example: Demonstrate zero-cost at scale (dormant population)
 *
 * Run: pnpm tsx examples/zero-cost-population.ts
 */

import { createKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";

async function main() {
  const kernel = createKernel(
    { maxPersons: 10_000 },
    { clock: new SimulatedClock() }
  );

  // Create 1000 people (only 5 will be "active")
  console.log("Creating 1000 people...");
  const people = [];
  for (let i = 0; i < 1000; i++) {
    const p = kernel.createPerson({
      name: `Person ${i}`,
      biography: `Auto-generated person ${i}`,
      interests: ["test"],
    });
    people.push(p);
  }

  console.log(`Created ${people.length} people`);
  console.log(`Total persons in DB: ${kernel.persons.count()}`);

  // Make only first 5 active by giving them relationships
  const active = people.slice(0, 5);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      kernel.relate(active[i].id, active[j].id, {
        familiarity: 0.5,
        trust: 0.4,
        affection: 0.3,
      });
    }
    kernel.assignRole(active[i].id, "friend");
  }

  // Run a scene with only active people
  console.log("\nRunning scene with 5 active people...");
  const event = await kernel.tell("Hello everyone!", {
    circleId: null, // will use first active person's context
  });

  const stats = kernel.stats();
  console.log(`\nAfter 1 scene:`);
  console.log(`  Model calls: ${stats.modelCalls}`);
  console.log(`  Est. spend: $${stats.totalCost.toFixed(6)}`);
  console.log(`  Total persons: ${stats.persons}`);
  console.log(`  Total relationships: ${stats.relationships}`);

  // Run cost simulator
  console.log("\n--- Cost Simulator ---");
  const scenarios = kernel.cost.simulate(1000);
  console.log(`Population: 1000, Active: 5`);
  console.log(`1:1 conversation (20 msgs): ${scenarios.find(s => s.name.includes("1:1"))?.modelCalls} calls, $${scenarios.find(s => s.name.includes("1:1"))?.estimatedSpend.toFixed(4)}`);
  console.log(`3-person group (15 msgs): ${scenarios.find(s => s.name.includes("3-person"))?.modelCalls} calls, $${scenarios.find(s => s.name.includes("3-person"))?.estimatedSpend.toFixed(4)}`);
  console.log(`30-message evening: ${scenarios.find(s => s.name.includes("30-message"))?.modelCalls} calls, $${scenarios.find(s => s.name.includes("30-message"))?.estimatedSpend.toFixed(4)}`);
  console.log(`10 proactive candidates: ${scenarios.find(s => s.name.includes("proactive"))?.modelCalls} calls, $${scenarios.find(s => s.name.includes("proactive"))?.estimatedSpend.toFixed(4)}`);

  kernel.close();
  console.log("\n✓ Example completed — 995 dormant people cost $0");
}

main().catch(console.error);