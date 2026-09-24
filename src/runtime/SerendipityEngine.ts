import type { Clock } from "../god/clock.ts";
import type { PersonState } from "../god/types.ts";
import type { PersonService } from "../people";
import type { RoleService } from "../roles";
import type { CircleService } from "../circles";
import type { TimelineService } from "../events";
import type { SocietyConfig } from "../god/config.ts";

const NAME_POOL = [
  "Emma", "Alex", "Maya", "Jordan", "Priya", "Sam", "Leo", "Nora", "Kai",
  "Riley", "Zara", "Theo", "Ivy", "Luca", "Mina", "Owen", "Cleo", "Noah",
  "Aria", "Felix", "Nadia", "Ronan", "Suki", "Marco", "Tess", "Andre",
  "Bianca", "Cole", "Dana", "Elliot", "Freya", "Gabe", "Hana", "Ilan",
  "June", "Kofi", "Lena", "Miles", "Niko", "Opal",
];

export interface SerendipityOutcome {
  fired: boolean;
  person?: PersonState;
  reason: string;
}

/**
 * SerendipityEngine: new people emerge naturally, but eligibility is
 * deterministic FIRST (cooldown, population limits, circle compatibility,
 * user social intensity, recent introductions). A new Person is only fleshed
 * out if the introduction actually triggers — and creation costs zero inference.
 */
export class SerendipityEngine {
  constructor(
    private readonly config: SocietyConfig,
    private readonly clock: Clock,
    private readonly meta: { get: (k: string) => unknown; set: (k: string, v: unknown) => void },
    private readonly persons: PersonService,
    private readonly roles: RoleService,
    private readonly circles: CircleService,
    private readonly timeline: TimelineService,
    private readonly rng: () => number = Math.random,
  ) {}

  consider(opts: {
    matchingCircleId: string | null;
    userSocialIntensity: string;
  }): SerendipityOutcome {
    const now = this.clock.now();
    if (!this.config.serendipity.enabled) {
      return { fired: false, reason: "serendipity disabled" };
    }

    // ---- deterministic eligibility, no randomness up front
    if (this.persons.count() >= this.config.maxPersons) {
      return { fired: false, reason: `population limit ${this.config.maxPersons}` };
    }
    if (opts.userSocialIntensity === "do_not_disturb") {
      return { fired: false, reason: "user do_not_disturb" };
    }

    const lastAt = (this.meta.get("serendipity_last_at") as number | undefined) ?? 0;
    if (now - lastAt < this.config.serendipity.cooldownMs) {
      return { fired: false, reason: "cooldown active" };
    }

    const recents = (this.meta.get("serendipity_recent") as string[] | undefined) ?? [];
    const fresh = recents.filter((ts) => now - Number(ts) < this.config.serendipity.introductionWindowMs);
    if (fresh.length >= this.config.serendipity.maxRecentIntroductions) {
      return { fired: false, reason: "too many recent introductions" };
    }

    const circle = opts.matchingCircleId
      ? this.circles.get(opts.matchingCircleId)
      : this.circles.list()[0];
    if (!circle) {
      return { fired: false, reason: "no compatible circle" };
    }

    // ---- probability gate (only after deterministic eligibility)
    if (this.rng() >= this.config.serendipity.probability) {
      return { fired: false, reason: "probability not triggered" };
    }

    // ---- flesh out a new Person because the introduction actually fired
    const name = NAME_POOL[Math.floor(this.rng() * NAME_POOL.length)] ?? "Ash";
    const person = this.persons.create({
      name,
      biography: `A newer face in ${circle.name}. Just drifted in — no shared history yet.`,
      interests: ["meetups", "conversation", "light plans"],
      currentState: { mood: "curious" },
      socialIntensity: "normal",
    });
    this.roles.assign(person.id, "acquaintance");
    this.circles.addMember(circle.id, person.id, "person");
    this.timeline.append({
      personId: person.id,
      circleId: circle.id,
      kind: "introduced",
      content: `${name} appeared in ${circle.name}.`,
      at: now,
    });

    this.meta.set("serendipity_last_at", now);
    this.meta.set("serendipity_recent", [...fresh, String(now)]);

    return { fired: true, person, reason: `introduced into ${circle.name}` };
  }
}