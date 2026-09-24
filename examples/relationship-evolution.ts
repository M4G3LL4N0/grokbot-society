#!/usr/bin/env node
/**
 * Example: Watch relationships evolve over multiple interactions
 *
 * Run: pnpm tsx examples/relationship-evolution.ts
 */

import { createKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";

async function main() {
  const kernel = createKernel(
    { relationshipLearningRate: 0.15 }, // default inertia
    { clock: new SimulatedClock() }
  );

  // Create two people
  const a = kernel.createPerson({ name: "River" });
  const b = kernel.createPerson({ name: "Sage" });

  console.log("Initial relationship: strangers");
  let rel = kernel.relationship.getSummary(a.id, b.id);
  console.log(`  Status: ${rel?.status}, dims: ${formatDims(rel?.dims)}`);

  // Simulate multiple interactions via scenes
  const scenes = [
    "Hey, want to grab coffee?",
    "That was great, thanks for listening earlier.",
    "I've been thinking about what you said about the project.",
    "You're one of the few people who really gets it.",
    "Same time next week?",
  ];

  for (let i = 0; i < scenes.length; i++) {
    const event = await kernel.tell(scenes[i], {
      circleId: null, // direct interaction
      // For direct interaction, we'd need to specify personIds
      // but tell() with circleId=null defaults to USER_MESSAGE
    });

    // Manually apply relationship delta for demo
    // (In real scenes, SocialDirector emits relationshipCandidates)
    kernel.relationship.relate(a.id, b.id, {
      familiarity: 0.15,
      trust: 0.1,
      affection: 0.1,
    });

    rel = kernel.relationship.getSummary(a.id, b.id);
    console.log(`\nAfter interaction ${i + 1}:`);
    console.log(`  "${scenes[i]}"`);
    console.log(`  Status: ${rel?.status}`);
    console.log(`  Dims: ${formatDims(rel?.dims)}`);
    console.log(`  Interactions: ${rel?.interactions}`);
  }

  console.log("\n--- Inertia Demo ---");
  console.log("Even after 5 interactions, status is:", rel?.status);
  console.log("Inertia (learningRate=0.15) prevents instant jumps.");

  kernel.close();
  console.log("\n✓ Example completed");
}

function formatDims(dims?: Record<string, number>): string {
  if (!dims) return "none";
  return Object.entries(dims)
    .map(([k, v]) => `${k}:${v.toFixed(2)}`)
    .join(", ");
}

main().catch(console.error);