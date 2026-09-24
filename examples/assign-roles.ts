#!/usr/bin/env node
/**
 * Example: Assign roles and see how they affect actor composition
 *
 * Run: pnpm tsx examples/assign-roles.ts
 */

import { createKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";

async function main() {
  const kernel = createKernel(
    { maxPersons: 100 },
    { clock: new SimulatedClock() }
  );

  const person = kernel.createPerson({
    name: "Morgan",
    biography: "Systems thinker who builds tools for builders.",
    identity: { core: "analytical, generous, pragmatic" },
    personality: { summary: "makes complex things simple" },
    interests: ["systems design", "open source", "climbing", "cooking"],
    currentState: { mood: 0.2, availability: "available", socialIntensity: "social" },
  });

  console.log(`Created: ${person.name} (${person.id})`);

  // Assign multiple roles
  const rolesToAssign = [
    "intellectual_friend",
    "founder_friend",
    "debate_friend",
    "gym_friend",
  ];

  for (const roleId of rolesToAssign) {
    kernel.assignRole(person.id, roleId);
    console.log(`Assigned: ${roleId}`);
  }

  // Compose actor context (what a scene sees)
  const actor = kernel.composeActorContext(
    person.id,
    "event:example",
    [person.id], // solo scene for demo
    null
  );

  console.log("\nActor Context (roles in this scene):");
  console.log(`  Person: ${actor.card.name}`);
  console.log(`  Roles: ${actor.roles.map(r => r.name).join(", ")}`);
  console.log(`  Role categories: ${[...new Set(actor.roles.map(r => r.category))].join(", ")}`);

  // Show role details
  console.log("\nRole Details:");
  for (const role of actor.roles) {
    console.log(`  ${role.name} (${role.category}):`);
    console.log(`    Tendencies: ${role.tendencies.join(", ")}`);
    console.log(`    Capabilities: ${role.capabilities.join(", ")}`);
  }

  kernel.close();
  console.log("\n✓ Example completed");
}

main().catch(console.error);