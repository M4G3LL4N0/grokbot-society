import type {
  IdentityCard,
  PersonState,
  RoleDefinition,
  SocialIntensity,
} from "../god/types.ts";

/** Max length of any card field, so cards always stay compact. */
const FIELD_CAP = 120;

function cap(text: string, max = FIELD_CAP): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * IdentityCardCompiler — deterministic, zero-inference compilation of a
 * compact runtime Person card from canonical structured state. Cards are
 * frozen snapshots: intelligence (mock/cheap/GrokBot) reads a card, it never
 * writes one.
 */
export class IdentityCardCompiler {
  compile(person: PersonState, roles: RoleDefinition[] = []): IdentityCard {
    const identity = person.identity ?? {};
    const essence =
      (identity.core as string | undefined) ??
      (identity.tagline as string | undefined) ??
      (person.personality?.summary as string | undefined) ??
      person.biography?.split(".", 1)[0] ??
      "a person in this circle.";
    const voice =
      (person.communicationStyle?.humor as string | undefined) ??
      (person.communicationStyle?.cadence as string | undefined) ??
      "warm";

    const mood = typeof person.currentState?.mood === "number" ? person.currentState.mood : null;

    return {
      personId: person.id,
      name: cap(person.name, 40),
      archetype: cap(roles[0]?.name ?? "person", 40),
      essence: cap(essence),
      voice: cap(voice, 60),
      interests: person.interests.slice(0, 4).map((i) => cap(i, 40)),
      goals: (person.goals.slice(0, 2) as string[]).map((g) => cap(g)),
      mood: mood === null ? null : Number(mood.toFixed(2)),
      socialIntensity: person.socialIntensity as SocialIntensity,
    };
  }

  toText(card: IdentityCard): string {
    const interests = card.interests.length ? card.interests.join("; ") : "keeps it varied";
    const goals = card.goals.length ? card.goals.join("; ") : "no number one priority yet";
    return [
      `card:${card.name} [${card.archetype}]`,
      `essence: ${card.essence}`,
      `voice: ${card.voice}`,
      `interests: ${interests}`,
      `goals: ${goals}`,
      `mood: ${card.mood ?? "n/a"} · intensity: ${card.socialIntensity}`,
    ].join("\n");
  }
}