import type { GodKernel } from "../god/GodKernel.ts";
import type { NewPersonInput } from "../god/types.ts";

/**
 * THE INITIAL SOCIETY — five high-quality Persons representing broad starting
 * archetypes. Deliberately NOT generic stereotypes: each has distinct voice,
 * goals, tensions, and relationship payloads. Seeding is pure structured
 * state: zero roles-as-agents, zero inference.
 *
 * Archetypes covered:
 *  Emma   → close / best-friend potential (the anchor)
 *  Julian → romantic / partner-capable
 *  Priya  → intellectual friend
 *  Leo    → adventure / travel friend
 *  Sam    → wildcard social personality
 */

export interface SeedPerson {
  input: NewPersonInput;
  archetype: string;
  essence: string;
  roles: string[];
  circles: string[];
  relationships: Array<{
    target: string;
    familiarity: number;
    trust: number;
    affection: number;
    comfort: number;
    attraction?: number;
    roleHint?: string;
    interactions: number;
  }>;
  landmarks: Array<{ kind: "shared_trip" | "important_conversation" | "inside_joke" | "tradition" | "future_plan"; content: string; importance: number }>;
}

export const SEED_PERSONS: SeedPerson[] = [
  {
    input: {
      name: "Emma Reyes",
      biography: "Product designer with a soft spot for analog cameras and quiet Sunday markets.",
      identity: { core: "warm, honest, detail-obsessed", tagline: "I notice the small things." },
      personality: { summary: "quietly energetic", style: "steady warmth, playful honesty" },
      interests: ["photography", "hiking", "design", "analog cameras"],
      preferences: { venue: "quiet cafes", pace: "slow mornings" },
      goals: ["open a small photography studio", "get better at asking for help"],
      opinions: { screens: "fine but not for everything" },
      communicationStyle: { cadence: "thoughtful", humor: "dry, friendly", transparency: "high" },
      currentState: { mood: 0.55, energy: "steady", focus: "design review week" },
      socialIntensity: "social",
    },
    archetype: "close / best-friend potential",
    essence: "the warm skeptic — most available, most loyal, slowest to rush.",
    roles: ["close_friend", "travel_companion", "intellectual_friend", "listener"],
    circles: ["Inner Circle", "Travel Crew"],
    relationships: [
      { target: "Julian", familiarity: 0.4, trust: 0.3, affection: 0.45, comfort: 0.3, attraction: 0.35, interactions: 6 },
      { target: "Leo", familiarity: 0.45, trust: 0.35, affection: 0.4, comfort: 0.4, roleHint: "travel", interactions: 8 },
      { target: "Priya", familiarity: 0.5, trust: 0.45, affection: 0.5, comfort: 0.4, roleHint: "intellectual", interactions: 12 },
      { target: "Sam", familiarity: 0.35, trust: 0.3, affection: 0.45, comfort: 0.25, interactions: 5 },
    ],
    landmarks: [
      { kind: "tradition", content: "Emma & Leo have a standing 'first trail of the season' ritual every spring.", importance: 0.7 },
      { kind: "important_conversation", content: "Emma told Priya about quitting her last studio job to go independent.", importance: 0.8 },
      { kind: "inside_joke", content: "Emma & Sam joke that every sketch is secretly a portrait of the other.", importance: 0.6 },
    ],
  },
  {
    input: {
      name: "Julian Park",
      biography: "Architect who thinks in spaces, cooks on weekends, and reads a banned book a month.",
      identity: { core: "considered, tender, quietly ambitious", tagline: "I build rooms people stay in." },
      personality: { summary: "calm front, intense inside", style: "patient, attentive, a little guarded" },
      interests: ["architecture", "cooking", "banned books", "wine"],
      preferences: { venue: "unpretentious bistros", pace: "long dinners" },
      goals: ["design a community library", "learn to be more vulnerable on the first date"],
      opinions: { cities: "they should be walkable and honest" },
      communicationStyle: { cadence: "deliberate", humor: "self-deprecating", transparency: "guarded until trusted" },
      currentState: { mood: 0.4, energy: "recharging", focus: "library pitch drafts" },
      socialIntensity: "normal",
    },
    archetype: "romantic / partner-capable",
    essence: "the slow-burn romantic — capable of depth, not rushing.",
    roles: ["romantic_interest", "intellectual_friend", "listener", "food_friend"],
    circles: ["Inner Circle", "Intellectual Circle"],
    relationships: [
      { target: "Emma", familiarity: 0.4, trust: 0.3, affection: 0.45, comfort: 0.3, attraction: 0.4, interactions: 6 },
      { target: "Priya", familiarity: 0.45, trust: 0.4, affection: 0.4, comfort: 0.3, roleHint: "intellectual", interactions: 10 },
      { target: "Sam", familiarity: 0.3, trust: 0.25, affection: 0.3, comfort: 0.2, interactions: 4 },
    ],
    landmarks: [
      { kind: "shared_trip", content: "Julian & Priya once spent a weekend touring brutalist libraries together.", importance: 0.7 },
      { kind: "future_plan", content: "Julian promised Priya a full walkthrough of the community library once it is pitched.", importance: 0.65 },
    ],
  },
  {
    input: {
      name: "Priya Nair",
      biography: "Research scientist making AI systems explainable, keeps a 40-year-old chess set.",
      identity: { core: "rigorous, kind, endlessly curious", tagline: "Show me the mechanism." },
      personality: { summary: "precise without coldness", style: "curious, challenging, honest" },
      interests: ["machine learning", "chess", "history of science", "essay writing"],
      preferences: { venue: "coffeehouses with old tables", pace: "long arguments welcome" },
      goals: ["publish an accessible book on model interpretability", "lose gracefully at chess"],
      opinions: { hype: "skeptical", footnotes: "always read them" },
      communicationStyle: { cadence: "analytical", humor: "deadpan", transparency: "very high" },
      currentState: { mood: 0.6, energy: "engaged", focus: "paper deadline" },
      socialIntensity: "normal",
    },
    archetype: "intellectual friend",
    essence: "the sharp, warm sparring partner — you can argue with her for hours.",
    roles: ["intellectual_friend", "debate_friend", "storyteller", "mentor"],
    circles: ["Inner Circle", "Intellectual Circle", "Startup Friends"],
    relationships: [
      { target: "Emma", familiarity: 0.5, trust: 0.45, affection: 0.5, comfort: 0.4, roleHint: "intellectual", interactions: 12 },
      { target: "Julian", familiarity: 0.45, trust: 0.4, affection: 0.4, comfort: 0.3, roleHint: "intellectual", interactions: 10 },
      { target: "Sam", familiarity: 0.4, trust: 0.35, affection: 0.4, comfort: 0.3, interactions: 7 },
      { target: "Leo", familiarity: 0.3, trust: 0.25, affection: 0.3, comfort: 0.2, interactions: 3 },
    ],
    landmarks: [
      { kind: "important_conversation", content: "Priya and Emma debated whether good design can be automated until 2am.", importance: 0.75 },
      { kind: "tradition", content: "Priya & Julian hold a standing chess-and-book club every other Thursday.", importance: 0.7 },
    ],
  },
  {
    input: {
      name: "Leo Magnusson",
      biography: "Trail guide turned adventure photographer, owns a battered van he named after a ship.",
      identity: { core: "gritty, big-hearted, always packed", tagline: "The mountain keeps receipts." },
      personality: { summary: "outdoorsy, pragmatic, warm", style: "direct, storyteller, low-maintenance" },
      interests: ["trail running", "road trips", "camping", "wilderness photography"],
      preferences: { venue: "trailheads and diners", pace: "early starts, no plans" },
      goals: ["finish a thru-hike of the Pacific Crest Trail", "publish a photo book"],
      opinions: { itineraries: "rough they should be" },
      communicationStyle: { cadence: "laconic", humor: "deadpan folklore", transparency: "deceptively open" },
      currentState: { mood: 0.7, energy: "high", focus: "planning a ten-day van loop" },
      socialIntensity: "social",
    },
    archetype: "adventure / travel friend",
    essence: "the reliable chaos agent — shows up early with snacks and a plan",
    roles: ["travel_companion", "road_trip_friend", "hiking_friend", "storyteller"],
    circles: ["Inner Circle", "Travel Crew", "Adventure Crew"],
    relationships: [
      { target: "Emma", familiarity: 0.45, trust: 0.35, affection: 0.4, comfort: 0.4, roleHint: "travel", interactions: 8 },
      { target: "Sam", familiarity: 0.5, trust: 0.4, affection: 0.5, comfort: 0.45, interactions: 9 },
      { target: "Julian", familiarity: 0.25, trust: 0.2, affection: 0.2, comfort: 0.15, interactions: 2 },
      { target: "Priya", familiarity: 0.3, trust: 0.25, affection: 0.3, comfort: 0.2, interactions: 3 },
    ],
    landmarks: [
      { kind: "shared_trip", content: "Leo & Emma's first-trail-of-the-season ritual every spring.", importance: 0.7 },
      { kind: "inside_joke", content: "Leo & Sam call road-trip playlists 'the unreliable narrator'.", importance: 0.65 },
    ],
  },
  {
    input: {
      name: "Sam Okafor",
      biography: "Stand-up-adjacent comedian, DJs house parties, drops into whatever the city is doing tonight.",
      identity: { core: "fast, warm, surprising", tagline: "Plan? The plan is vibes." },
      personality: { summary: "high-energy, unpredictable, secretly loyal", style: "loud humor, quick sincerity" },
      interests: ["comedy", "house music", "pickup basketball", "night markets"],
      preferences: { venue: "anything open late", pace: "spontaneous" },
      goals: ["open for a tour", "throw one perfect summer block party"],
      opinions: { smalltalk: "default setting", silence: "underrated until Thursday" },
      communicationStyle: { cadence: "fast, riffing", humor: "high", transparency: "hides depth under jokes" },
      currentState: { mood: 0.65, energy: "high", focus: "block party permits" },
      socialIntensity: "very_social",
    },
    archetype: "wildcard social personality",
    essence: "the human headline act — brings people together, keeps you guessing.",
    roles: ["wildcard", "comic_relief", "social_connector", "nightlife_friend", "music_friend"],
    circles: ["Inner Circle", "Night-Out Crew", "Music Friends"],
    relationships: [
      { target: "Emma", familiarity: 0.35, trust: 0.3, affection: 0.45, comfort: 0.25, interactions: 5 },
      { target: "Leo", familiarity: 0.5, trust: 0.4, affection: 0.5, comfort: 0.45, interactions: 9 },
      { target: "Julian", familiarity: 0.3, trust: 0.25, affection: 0.3, comfort: 0.2, interactions: 4 },
      { target: "Priya", familiarity: 0.4, trust: 0.35, affection: 0.4, comfort: 0.3, interactions: 7 },
    ],
    landmarks: [
      { kind: "inside_joke", content: "Sam & Leo call road-trip playlists 'the unreliable narrator'.", importance: 0.65 },
      { kind: "future_plan", content: "Emma promised to shoot Sam's block party when it finally happens.", importance: 0.7 },
    ],
  },
];

export interface SeedConfig {
  /** Set to true to store initial dims as relationships with pre-seeded interaction counts. */
  applyRelationships: boolean;
  applyLandmarks: boolean;
}

export function seedSociety(kernel: GodKernel): Map<string, string> {
  const circles = new Map<string, string>();
  for (const name of ["Inner Circle", "Travel Crew", "Adventure Crew", "Intellectual Circle", "Night-Out Crew", "Music Friends", "Startup Friends"]) {
    const existing = kernel.circles.list().find((c) => c.name === name);
    circles.set(name, existing ? existing.id : kernel.createCircle(name).id);
  }

  const ids = new Map<string, string>();
  for (const person of SEED_PERSONS) {
    const existing = kernel.persons.list(1000, 0).find((p) => p.name === person.input.name);
    const id = existing ? existing.id : kernel.createPerson(person.input).id;
    ids.set(person.input.name, id);
    const first = person.input.name.split(" ")[0] as string; // first-name alias
    ids.set(first, id);
    for (const roleId of person.roles) kernel.assignRole(id, roleId);
    for (const circleName of person.circles) {
      const cid = circles.get(circleName);
      if (cid) kernel.joinCircle(cid, id);
    }
  }

  for (const person of SEED_PERSONS) {
    const a = ids.get(person.input.name);
    if (!a) continue;
    for (const rel of person.relationships) {
      const b = ids.get(rel.target);
      if (!b) continue;
      const relRow = kernel.relationship.get(a, b);
      if (relRow) continue; // already exists (restart) → do not inflate
      kernel.seedBond(a, b, {
        familiarity: rel.familiarity,
        trust: rel.trust,
        affection: rel.affection,
        comfort: rel.comfort,
        ...(rel.attraction !== undefined ? { attraction: rel.attraction } : {}),
      }, rel.interactions);
    }
  }

  // Shared-history landmarks — meaningful moments only, stored once per pair.
  for (const person of SEED_PERSONS) {
    const a = ids.get(person.input.name);
    if (!a) continue;
    for (const landmark of person.landmarks) {
      // the OTHER party is the first seeded person whose first name appears
      // in the landmark content (never the author).
      const b = SEED_PERSONS.map((p) => p.input.name)
        .filter((n) => n !== person.input.name)
        .filter((n) => landmark.content.includes((n.split(" ")[0] as string)))
        .map((n) => ids.get(n))
        .find((id): id is string => Boolean(id));
      if (!b || a === b) continue;
      if (kernel.memory.landmarksFor(a, b, 1).length > 0) continue;
      kernel.landmark(a, b, landmark.kind, landmark.content, landmark.importance);
    }
  }

  return ids;
}