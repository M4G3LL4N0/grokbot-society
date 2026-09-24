import { createKernel, GodKernel } from "./GodKernel.ts";
import { ALL_ROLES, DEFAULT_CIRCLE_NAMES } from "../seed/roles.ts";

const DEMO_PERSONS = [
  {
    name: "Emma Reyes", biography: "Product designer with a soft spot for analog cameras.",
    identity: { core: "warm, honest, detail-obsessed" }, personality: { summary: "quietly energetic" },
    interests: ["photography", "hiking", "design"], currentState: { mood: 0.4 },
  },
  {
    name: "Maya Chen", biography: "Startup founder who bikes everywhere.",
    identity: { core: "sharp, playful, builder-first" }, personality: { summary: "loves a good debate" },
    interests: ["startups", "coffee", "running"], currentState: { mood: 0.1 },
  },
  {
    name: "Alex Morgan", biography: "Writes fiction at night, edits docs by day.",
    identity: { core: "gentle, curious, comic" }, personality: { summary: "dry humor, attentive listener" },
    interests: ["books", "music", "nightlife"], currentState: { mood: 0.0 },
  },
];

function stubPerson(kernel: GodKernel, person: (typeof DEMO_PERSONS)[number]): string {
  const p = kernel.createPerson(person);
  return p.id;
}

async function main(): Promise<void> {
  const kernel = createKernel({ maxPersons: 100 });
  const circleName = "Inner Circle";
  const circleId = kernel.circles.list().find((c) => c.name === circleName)?.id;
  if (!circleId) throw new Error("seed circle missing");

  const ids = DEMO_PERSONS.map((person) => stubPerson(kernel, person));
  for (const personId of ids) {
    kernel.assignRole(personId, "friend");
    kernel.assignRole(personId, "social_connector");
    kernel.joinCircle(circleId, personId);
  }
  if (ids[0] && ids[1]) kernel.relate(ids[0], ids[1], { familiarity: 0.5, affection: 0.4 });
  if (ids[0] && ids[2]) kernel.relate(ids[0], ids[2], { familiarity: 0.6 });

  console.log(`Society booted: ${kernel.stats().persons} persons, ${kernel.stats().circles} circles, ${kernel.stats().roles} roles.`);
  console.log(`Providers registered: mock, deterministic, nano, standard, deep (zero paid inference).\n`);

  const event = await kernel.tell("Who's up for a weekend hike somewhere not too crowded?", {
    circleId,
  });
  console.log(`Event ${event.id} [${event.eventType}] status=${event.status}`);
  console.log("Stages:", event.stages.join(" -> "));
  const scene = (event.payload?.sceneResult as { output?: { messages: Array<{ personId: string; text: string }> } } | undefined)
    ?.output?.messages ?? [];
  console.log("Messages:");
  for (const m of scene) {
    const person = kernel.getPerson(m.personId);
    console.log(`  ${person?.name ?? m.personId}: ${m.text}`);
  }
  console.log("\nStats:", JSON.stringify(kernel.stats(), null, 2));
  console.log("\nAll paths above ran on MockProvider ($0). No GrokBot wired yet by design.");
  console.log(`Roles in registry (${ALL_ROLES.length}): ${ALL_ROLES.map((r) => r.id).join(", ")}`);
  console.log(`Seed circles (${DEFAULT_CIRCLE_NAMES.length}): ${DEFAULT_CIRCLE_NAMES.join(", ")}`);
  kernel.close();
}

void main();