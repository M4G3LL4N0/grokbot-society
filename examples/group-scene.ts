#!/usr/bin/env node
/**
 * Example: Run a group scene with multiple participants
 *
 * Run: pnpm tsx examples/group-scene.ts
 */

import { createKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";

async function main() {
  // Use a file DB so seed persists
  const kernel = createKernel(
    { dbPath: "/tmp/example-group-scene.db" },
    { clock: new SimulatedClock() }
  );

  // Ensure demo society is seeded
  kernel.ensureSeeded();

  // Get the Inner Circle
  const circles = kernel.circles.list();
  const innerCircle = circles.find(c => c.name === "Inner Circle");
  if (!innerCircle) throw new Error("Inner Circle not found");

  const memberIds = kernel.circles.memberPersonIds(innerCircle.id);

  console.log(`Using circle: ${innerCircle.name} (${innerCircle.id})`);
  console.log(`Members: ${memberIds.length}`);

  // List members
  for (const memberId of memberIds) {
    const p = kernel.persons.get(memberId);
    console.log(`  ${p?.name}`);
  }

  // Run a group scene
  const prompt = "Anyone up for a spontaneous road trip this weekend?";
  console.log(`\nUser: "${prompt}"`);

  const event = await kernel.tell(prompt, { circleId: innerCircle.id });

  console.log(`\nEvent: ${event.id} [${event.eventType}] — ${event.status}`);
  console.log("Stages:", event.stages.join(" → "));

  const scene = event.payload?.sceneResult as {
    output?: { messages: Array<{ personId: string; text: string }> };
    selected?: string[];
    blockedReason?: string | null;
  } | undefined;

  if (scene?.output?.messages) {
    console.log("\nScene Output:");
    for (const msg of scene.output.messages) {
      const person = kernel.persons.get(msg.personId);
      console.log(`  ${person?.name ?? msg.personId}: ${msg.text}`);
    }
  }

  console.log(`\nSelected speakers: ${scene?.selected?.length ?? 0}`);
  console.log(`Blocked reason: ${scene?.blockedReason ?? "none"}`);

  // Stats
  const stats = kernel.stats();
  console.log(`\nModel calls: ${stats.modelCalls}`);
  console.log(`Est. spend: $${stats.totalCost.toFixed(6)}`);

  kernel.close();
  console.log("\n✓ Example completed");
}

main().catch(console.error);