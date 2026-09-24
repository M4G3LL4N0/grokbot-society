#!/usr/bin/env node
/**
 * Example: Long-session abstraction (road trip, evening, etc.)
 *
 * Run: pnpm tsx examples/session.ts
 */

import { createKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";

async function main() {
  const kernel = createKernel(
    {},
    { clock: new SimulatedClock() }
  );

  kernel.ensureSeeded();

  // Get a few people for the session
  const people = kernel.persons.list(10);
  const participants = people.slice(0, 3).map(p => p.id);

  console.log("Starting session with participants:");
  for (const id of participants) {
    const p = kernel.persons.get(id);
    console.log(`  ${p?.name}`);
  }

  // Start a session
  const session = kernel.sessionStart({
    kind: "road_trip",
    circleId: null,
    participantIds: participants,
  });

  console.log(`\nSession started: ${session.id} (${session.kind})`);

  // Add messages to the session
  const messages = [
    { role: "user" as const, personId: null, text: "Road trip to the coast! Who's driving?" },
    { role: "person" as const, personId: participants[0], text: "I can drive the first leg." },
    { role: "person" as const, personId: participants[1], text: "I'll navigate and DJ." },
    { role: "person" as const, personId: participants[2], text: "Snacks are on me!" },
    { role: "user" as const, personId: null, text: "Perfect. Let's hit it." },
    { role: "person" as const, personId: participants[0], text: "Leaving in 10. Buckle up." },
  ];

  for (const msg of messages) {
    kernel.sessionAppend(session.id, msg);
    console.log(`  [${msg.role}] ${msg.personId ? kernel.persons.get(msg.personId)?.name : "You"}: ${msg.text}`);
  }

  // Compile session context (bounded rolling window)
  const context = kernel.sessionContext(session.id);
  console.log(`\nSession context (bounded):`);
  console.log(`  Messages in window: ${context.messages.length}`);
  console.log(`  Participant cards: ${context.participants.length}`);
  console.log(`  (Rolling window = 6, max cards = 4)`);

  // Show the bounded context
  console.log("\nContext messages:");
  for (const msg of context.messages) {
    const name = msg.personId ? kernel.persons.get(msg.personId)?.name : "You";
    console.log(`  [${msg.role}] ${name}: ${msg.text}`);
  }

  // End session
  const ended = kernel.sessionEnd(session.id);
  console.log(`\nSession ended: ${ended?.id} (${ended?.messageCount} messages)`);

  kernel.close();
  console.log("\n✓ Example completed");
}

main().catch(console.error);