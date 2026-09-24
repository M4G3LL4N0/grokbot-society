#!/usr/bin/env node
/**
 * Example: Create a circle, add members, and inspect social graph
 *
 * Run: pnpm tsx examples/create-circle.ts
 */

import { createKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";

async function main() {
  const kernel = createKernel(
    { maxPersons: 100, maxCircles: 50 },
    { clock: new SimulatedClock() }
  );

  // Create a few people
  const people = [
    kernel.createPerson({ name: "Alex", biography: "Hiker and map nerd." }),
    kernel.createPerson({ name: "Blake", biography: "Bird watcher, quiet." }),
    kernel.createPerson({ name: "Casey", biography: "Trail runner, energetic." }),
    kernel.createPerson({ name: "Dana", biography: "Nature photographer." }),
  ];

  console.log("Created people:");
  for (const p of people) console.log(`  ${p.name} (${p.id})`);

  // Create a circle
  const circle = kernel.circles.create({
    name: "Weekend Hikers",
    kind: "interest",
    metadata: { region: "Pacific Northwest", difficulty: "moderate" },
  });

  console.log(`\nCreated circle: ${circle.name} (${circle.id})`);

  // Add members
  for (const p of people) {
    kernel.joinCircle(circle.id, p.id);
    console.log(`  Added ${p.name} to circle`);
  }

  // Assign relevant roles
  kernel.assignRole(people[0].id, "hiking_friend");
  kernel.assignRole(people[1].id, "hiking_friend");
  kernel.assignRole(people[2].id, "hiking_friend");
  kernel.assignRole(people[3].id, "hiking_friend");

  // Create some relationships
  kernel.relate(people[0].id, people[1].id, { familiarity: 0.6, trust: 0.7, affection: 0.5 });
  kernel.relate(people[2].id, people[3].id, { familiarity: 0.8, trust: 0.9, affection: 0.7 });

  // Inspect circle
  const members = kernel.circles.memberPersonIds(circle.id);
  console.log(`\nCircle members (${members.length}):`);
  for (const memberId of members) {
    const person = kernel.persons.get(memberId);
    const roles = kernel.roles.assignments(memberId).map(r => r.name).join(", ");
    console.log(`  ${person?.name} — roles: ${roles}`);
  }

  // Social graph queries
  console.log("\nSocial Graph:");
  console.log(`  Circle members: ${kernel.graph.circleMembersWithRoles(circle.id).length}`);
  const ties = kernel.graph.strongestTies(people[2].id, 3);
  console.log(`  Strongest ties for ${people[2].name}:`);
  for (const tie of ties) {
    const other = kernel.persons.get(tie.otherId);
    console.log(`    ${other?.name}: score ${tie.score.toFixed(2)}`);
  }

  kernel.close();
  console.log("\n✓ Example completed");
}

main().catch(console.error);