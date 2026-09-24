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

const OPENERS = [
  (name: string) => `${name}: "Yeah, I hear you."`,
  (name: string) => `${name}: "Good prompt, honestly."`,
  (name: string) => `${name}: "Let's keep it simple then."`,
  (name: string) => `${name}: "Noted. Where do we go from here?"`,
];

/**
 * social.deterministic — pure template/code cognition. No model at all, but
 * still routed through the IntelligenceGateway (single approved path) and
 * still subject to budget rules. This is the escalation floor: cache → state →
 * deterministic code → ... → deep/grok.
 */
export class DeterministicProvider implements Provider {
  readonly name = "deterministic";
  readonly supports: ModelClass[] = ["social.deterministic", "social.mock"];
  calls = 0;
  lastRequest: ProviderRequest | null = null;

  constructor(private readonly isAvailableFn: () => boolean = () => true) {}

  isAvailable(): boolean {
    return this.isAvailableFn();
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    assertGatewalledCall();
    this.calls += 1;
    this.lastRequest = request;

    const meta = extractMeta(request.context);
    const participantIds = Array.isArray(meta.participants)
      ? (meta.participants as string[])
      : [];
    const names = (meta.participantNames as Record<string, string>) ?? {};

    const payload: SceneProviderPayload = {
      messages: [],
      memoryCandidates: [],
      relationshipCandidates: [],
      timelineCandidates: [],
      followups: [],
    };

    participantIds.slice(0, 3).forEach((personId, index) => {
      const name = names[personId] ?? personId;
      const opener = OPENERS[index % OPENERS.length] ?? OPENERS[0]!;
      payload.messages.push({ personId, text: opener(name) });
    });

    const content = JSON.stringify(payload);
    const inputTokens = request.context.reduce((n, s) => n + estimateTokens(s), 0);
    const outputTokens = estimateTokens(content);
    return {
      provider: this.name,
      model: "template-v1",
      content,
      usage: { inputTokens, outputTokens },
      cost: 0,
    };
  }
}