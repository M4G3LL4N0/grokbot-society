import type { PersonService } from "../people";
import type { RoleService } from "../roles";
import type { RelationshipService } from "../relationships";
import type { CircleService } from "../circles";
import type { TimelineService } from "../events";
import type { Clock } from "../god/clock.ts";
import type { SocialIntensity } from "../god/types.ts";

const BUSY_HARD_EXCLUDE = true;
const RECENT_SPEAKER_WINDOW_MS = 45 * 60_000;
const INTENSITY_BOOST: Record<SocialIntensity, number> = {
  quiet: -2.0,
  low: -1.5,
  normal: 0,
  social: 1.0,
  very_social: 1.5,
  do_not_disturb: -100,
};

export interface SelectionContext {
  eventId: string;
  candidatePersonIds: string[];
  circleId: string | null;
  actorMessage: string;
  circleMemberIds: string[];
}

export interface SelectedParticipant {
  personId: string;
  score: number;
  reasons: string[];
}

/** Topic/role keyword relevance of the message to a person's interests+roles. */
function topicScore(
  message: string,
  words: string[],
  roleWords: string[],
): number {
  const tokens = new Set(
    message.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2),
  );
  if (tokens.size === 0) return 0;
  let n = 0;
  for (const w of words) if (tokens.has(w)) n += 1;
  for (const w of roleWords) if (tokens.has(w)) n += 1;
  return Math.min(2.0, n * 0.5);
}

/**
 * ParticipantSelector: deterministic scoring only. Never activates everyone in
 * a circle; default target is 1–3 speakers, ordinary hard maximum is
 * `hardMaxSpeakers`, and zero eligible participants means silence is valid.
 */
export class ParticipantSelector {
  constructor(
    private readonly persons: PersonService,
    private readonly roles: RoleService,
    private readonly relationships: RelationshipService,
    private readonly circles: CircleService,
    private readonly timeline: TimelineService,
    private readonly clock: Clock,
    private readonly maxSpeakers: number,
    private readonly hardMaxSpeakers: number,
  ) {}

  select(ctx: SelectionContext): SelectedParticipant[] {
    const scored: SelectedParticipant[] = [];

    for (const personId of ctx.candidatePersonIds) {
      const person = this.persons.get(personId);
      if (!person) continue;

      // availability: hard filters first
      if (person.socialIntensity === "do_not_disturb") continue;
      if (BUSY_HARD_EXCLUDE && person.currentState?.busy === true) continue;

      const reasons: string[] = [];
      let score = 0;

      // social intensity / pacing
      score += INTENSITY_BOOST[person.socialIntensity] ?? 0;
      reasons.push(`intensity=${person.socialIntensity}`);

      // circle relevance
      const memberOfCircle =
        ctx.circleId !== null && ctx.circleMemberIds.includes(personId);
      if (memberOfCircle) {
        score += 2.5;
        reasons.push("circle_member");
      }

      // relationship relevance to co-candidates (avg familiarity)
      const pool = ctx.candidatePersonIds.filter((p) => p !== personId);
      const relScores: number[] = [];
      for (const other of pool) {
        const rel = this.relationships.get(personId, other);
        if (rel) relScores.push(rel.dims.familiarity * 0.4 + rel.dims.affection * 0.2);
      }
      if (relScores.length > 0) {
        const avg = relScores.reduce((a, b) => a + b, 0) / relScores.length;
        score += avg;
        reasons.push(`co_rel=${avg.toFixed(2)}`);
      }

      // topic / role relevance
      const roleDefs = this.roles.assignments(personId);
      const roleWords = roleDefs.flatMap((r) => [r.name, ...r.tendencies]);
      const interestsWords = person.interests.map((i) => i.toLowerCase());
      const ts = topicScore(ctx.actorMessage, interestsWords, roleWords);
      score += ts;
      if (ts > 0) reasons.push(`topic=${ts.toFixed(2)}`);

      // speaker recency (social pacing)
      const recent = this.timeline.forPerson(personId, 10).filter(
        (e) => e.createdAt >= this.clock.now() - RECENT_SPEAKER_WINDOW_MS,
      ).length;
      if (recent > 0) {
        score -= Math.min(2.0, recent); // recently spoke => cooler
        reasons.push(`recent_x${recent}`);
      }

      scored.push({ personId, score, reasons });
    }

    scored.sort((a, b) => b.score - a.score);
    const cut = Math.min(this.maxSpeakers, this.hardMaxSpeakers);
    return scored.slice(0, cut);
  }
}