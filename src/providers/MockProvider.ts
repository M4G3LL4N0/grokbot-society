import type { ModelClass } from "../god/types.ts";
import {
  assertGatewalledCall,
  extractMeta,
  type Provider,
  type ProviderRequest,
  type ProviderResult,
  type SceneProviderPayload,
} from "./types.ts";
import { estimateTokens } from "../telemetry/TelemetryService.ts";

const REPLY_TEMPLATES = [
  (msg: string) => `"Sounds good — tell me more about ${short(msg)}?"`,
  () => `"Ha, that's a vibe. I'm in."`,
  (msg: string) => `"I've been thinking about exactly that. ${short(msg)} feels like the right next step."`,
  () => `"Okay okay — count me in. You're the planner anyway."`,
];

function short(msg: string, max = 8): string {
  const words = msg.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return msg.trim();
  return words.slice(0, max).join(" ") + "…";
}

/**
 * MockProvider — built FIRST. The entire system must boot and run through it
 * with no paid model configured. It is a deterministic, zero-cost stand-in
 * that still exercises the full structured single-inference scene protocol:
 * one call in, one SceneOutput (multi-message) out.
 */
export class MockProvider implements Provider {
  readonly name = "mock";
  readonly supports: ModelClass[] = [
    "social.deterministic",
    "social.mock",
    "social.nano",
    "social.standard",
    "social.deep",
  ];

  /** Introspection hooks used by tests + telemetry proofs. */
  calls = 0;
  lastRequest: ProviderRequest | null = null;
  readonly isAvailable: () => boolean;
  overrideProviderName?: string;

  constructor(isAvailable: () => boolean = () => true) {
    this.isAvailable = isAvailable;
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    assertGatewalledCall();
    this.calls += 1;
    this.lastRequest = request;

    const participants = extractMeta(request.context);
    const participantIds = Array.isArray(participants.participants)
      ? (participants.participants as string[])
      : [];
    const userMessage = typeof participants.actorMessage === "string" ? participants.actorMessage : "";

    const speakers = participantIds.slice(0, 3);
    const payload: SceneProviderPayload = {
      messages: [],
      memoryCandidates: [],
      relationshipCandidates: [],
      timelineCandidates: [],
      followups: [],
    };

    speakers.forEach((personId, index) => {
      if (index >= 3) return;
      const template = REPLY_TEMPLATES[index % REPLY_TEMPLATES.length] ?? REPLY_TEMPLATES[0]!;
      payload.messages.push({
        personId,
        text: template(userMessage),
      });
    });

    if (speakers.length > 0) {
      // single tiny relationship + timeline candidate from a validated scene
      if (speakers.length >= 2) {
        payload.relationshipCandidates.push({
          personA: speakers[0]!,
          personB: speakers[1]!,
          dimsDelta: { familiarity: 0.08, comfort: 0.05 },
        });
      }
      payload.timelineCandidates.push({
        personId: speakers[0]!,
        kind: "scene",
        content: `Responded in a scene about "${short(userMessage, 6)}".`,
      });
      payload.memoryCandidates.push({
        personId: speakers[0]!,
        scope: "private",
        type: "scene",
        content: `Took part in a conversation: ${short(userMessage, 10)}`,
        importance: 0.35,
        confidence: 0.6,
      });
      payload.followups.push({
        personId: speakers[0]!,
        delayMs: 86_400_000,
        reason: "check_in",
      });
    }

    const content = JSON.stringify(payload);
    const inputTokens = request.context.reduce((n, s) => n + estimateTokens(s), 0);
    const outputTokens = estimateTokens(content);
    return {
      provider: this.overrideProviderName ?? this.name,
      model: "mock-v1",
      content,
      usage: { inputTokens, outputTokens },
      cost: 0,
    };
  }
}