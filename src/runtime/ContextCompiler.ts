import type { PersonService } from "../people";
import type { RoleService } from "../roles";
import type { RelationshipService } from "../relationships";
import type { CircleService } from "../circles";
import type { TimelineService } from "../events";
import type { MemoryService } from "../memory";
import { json } from "../god/db.ts";
import type { SceneContext } from "../god/types.ts";
import type { SelectedParticipant } from "./ParticipantSelector.ts";

export interface SceneInput {
  eventId: string;
  eventType: string;
  participants: SelectedParticipant[];
  circleId: string | null;
  actorMessage: string;
  actorId: string | null;
  actorUserId: string;
  actorName: string;
  includeColdMemory?: boolean;
}

const SYSTEM_INSTRUCTIONS = [
  "You are writing short replies for clearly artificial synthetic companions (not biological humans).",
  "Speak ONLY as the participants listed in this scene. Never speak for the user or anyone else.",
  "Keep each message to 1–2 short sentences. Be warm, consistent, transparently artificial.",
  "Respect privacy: only surface knowledge available through allowed scopes.",
  "Return JSON matching the scene schema exactly.",
].join("\n");

/**
 * ContextCompiler builds `BASELINE + DELTA + CURRENT EVENT` context for the
 * single inference request. ONLY selected participants appear in the model
 * context — never the whole circle or world.
 */
export class ContextCompiler {
  constructor(
    private readonly persons: PersonService,
    private readonly roles: RoleService,
    private readonly relationships: RelationshipService,
    private readonly circles: CircleService,
    private readonly timeline: TimelineService,
    private readonly memory: MemoryService,
  ) {}

  buildScene(input: SceneInput): SceneContext {
    const sections: string[] = [];
    const circleName = input.circleId
      ? (this.circles.get(input.circleId)?.name ?? input.circleId)
      : null;

    const participantNames: Record<string, string> = {};
    const participantIds: string[] = [];
    for (const p of input.participants) {
      const person = this.persons.get(p.personId);
      if (!person) continue;
      participantIds.push(p.personId);
      participantNames[p.personId] = person.name;
    }

    sections.push(
      "__meta__ " +
        json({
          participants: participantIds,
          participantNames,
          actorMessage: input.actorMessage,
          actorId: input.actorId,
          actorUserId: input.actorUserId,
          circleId: input.circleId,
          circleName,
        }),
    );
    sections.push("SYSTEM\n" + SYSTEM_INSTRUCTIONS);

    if (circleName) {
      const circleTimeline = input.circleId
        ? this.timeline.forCircle(input.circleId, 3)
        : [];
      const tl = circleTimeline.length
        ? circleTimeline.map((e) => `· ${e.content}`).join("\n")
        : "· the circle is quiet so far";
      sections.push(
        `CIRCLE: ${circleName}\nLast moments:\n${tl}`,
      );
    }

    for (const participant of input.participants) {
      const section = this.participantSection(participant, input);
      sections.push(section);
    }

    sections.push(
      `USER (${input.actorName})\nJust said: ${input.actorMessage || "(silence)"}`,
    );

    const estimatedTokens = sections.reduce(
      (n, s) => n + Math.max(1, Math.ceil(s.length / 4)),
      0,
    );

    return { eventId: input.eventId, participantIds, sections, estimatedTokens };
  }

  private participantSection(p: SelectedParticipant, input: SceneInput): string {
    const person = this.persons.get(p.personId);
    if (!person) return "";
    const roles = this.roles.assignments(p.personId).map((r) => r.name);
    const lines: string[] = [];

    const coreBits = [
      person.identity?.core ?? person.identity?.tagline ?? "",
      person.biography ? person.biography.split(" ").slice(0, 24).join(" ") : "",
      person.personality?.summary ?? "",
    ]
      .filter(Boolean)
      .join(" | ");

    lines.push(`PROFILE ${person.name} [${roles.join(", ") || "no roles"}]`);
    if (coreBits) lines.push(coreBits);
    if (person.currentState?.mood) lines.push(`mood: ${String(person.currentState.mood)}`);

    // relationship context to co-participants (compact)
    const otherIds = input.participants
      .map((op) => op.personId)
      .filter((oid) => oid !== p.personId);
    const relBits: string[] = [];
    for (const otherId of otherIds) {
      const rel = this.relationships.get(p.personId, otherId);
      const other = this.persons.get(otherId);
      if (rel && other) {
        const f = rel.dims.familiarity;
        const aff = rel.dims.affection;
        relBits.push(
          `${other.name.split(" ")[0]}:${rel.status}(fam ${f.toFixed(2)}, aff ${aff.toFixed(2)})`,
        );
      }
    }
    if (relBits.length) lines.push(`with: ${relBits.join(", ")}`);

    // memory: small relevant set (HOT recent + WARM relevant only)
    const mem = this.memory.retrieveForScene(p.personId, {
      participantIds: otherIds,
      circleId: input.circleId,
      includeCold: input.includeColdMemory ?? false,
    });
    const snippets = [...mem.hot.slice(0, 2), ...mem.warm.slice(0, 2)];
    if (snippets.length) {
      lines.push(
        "remembers: " + snippets.slice(0, 3).map((m) => `"${m.content}"`).join(", "),
      );
    }

    const recentTl = this.timeline.forPerson(p.personId, 2);
    if (recentTl.length) {
      lines.push("last: " + recentTl.map((e) => e.content).join(" | "));
    }

    return lines.join("\n");
  }
}