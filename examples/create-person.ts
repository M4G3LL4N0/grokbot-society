#!/usr/bin/env node
/**
 * Example: Create a person and assign roles
 *
 * Run: pnpm tsx examples/create-person.ts
 */

import { createKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";

async function main() {
  // Create an in-memory kernel (no persistent DB)
  const kernel = createKernel(
    { maxPersons: 100 },
    { clock: new SimulatedClock() }
  );

  // Create a person
  const person = kernel.createPerson({
    name: "Aria Chen",
    biography: "Urban explorer and street photographer. Finds beauty in forgotten corners.",
    identity: { core: "curious, observant, quietly intense" },
    personality: { summary: "notices what others miss" },
    interests: ["photography", "urban exploration", "coffee", "vinyl records"],
    currentState: { mood: 0.3, availability: "available", socialIntensity: "normal" },
    preferences: { communicationStyle: "thoughtful, visual" },
  });

  console.log(`Created person: ${person.name} (${person.id})`);

  // Assign roles
  kernel.assignRole(person.id, "friend");
  kernel.assignRole(person.id, "creative_friend");
  kernel.assignRole(person.id, "storyteller");

  console.log("Assigned roles: friend, creative_friend, storyteller");

  // Verify
  const roles = kernel.roles.assignments(person.id);
  console.log("Current roles:", roles.map(r => r.name).join(", "));

  // Get identity card
  const card = kernel.identityCard(person.id);
  if (card) {
    console.log("\nIdentity Card:");
    console.log(`  Name: ${card.name}`);
    console.log(`  Archetype: ${card.archetype}`);
    console.log(`  Essence: ${card.essence}`);
    console.log(`  Voice: ${card.voice}`);
    console.log(`  Interests: ${card.interests.join(", ")}`);
    console.log(`  Goals: ${card.goals.join(", ")}`);
  }

  kernel.close();
  console.log("\n✓ Example completed successfully");
}

main().catch(console.error);