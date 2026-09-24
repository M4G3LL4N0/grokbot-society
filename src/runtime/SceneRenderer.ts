import type { RenderSceneInput, RenderSceneOutput, SceneOutput, ModelClass } from "../god/types.ts";
import type { ContextCompiler } from "./ContextCompiler.ts";
import type { IntelligenceGateway } from "../intelligence/IntelligenceGateway.ts";

export interface SceneRendererDeps {
  compiler: ContextCompiler;
  gateway: IntelligenceGateway;
  sceneModelClass: ModelClass;
  userInfo: { userId: string; name: string };
}

/** Parse + sanitize the structured scene payload a provider returns. */
export function parseSceneOutput(content: string): SceneOutput {
  let raw: Partial<SceneOutput>;
  try {
    raw = JSON.parse(content) as Partial<SceneOutput>;
  } catch {
    raw = {};
  }
  const sanitizeMessages = (
    value: unknown,
  ): SceneOutput["messages"] =>
    Array.isArray(value)
      ? value
          .filter((m): m is { personId: string; text: string } =>
            Boolean(m && typeof m === "object" && typeof m.personId === "string" && typeof m.text === "string"),
          )
          .map((m) => ({ personId: m.personId, text: m.text }))
      : [];

  return {
    messages: sanitizeMessages(raw.messages),
    memoryCandidates: Array.isArray(raw.memoryCandidates) ? raw.memoryCandidates : [],
    relationshipCandidates: Array.isArray(raw.relationshipCandidates) ? raw.relationshipCandidates : [],
    timelineCandidates: Array.isArray(raw.timelineCandidates) ? raw.timelineCandidates : [],
    followups: Array.isArray(raw.followups) ? raw.followups : [],
  };
}

/**
 * MockSceneRenderer — the provider-neutral scene render path, MockProvider
 * enabled by default ($0). Future CapableRenderers (CheapProvider /
 * ChatGPTBridge / GrokBotBridge) implement the SAME contract and slot in via
 * kernel config without touching canonical identity, roles, memory or
 * relationships. ONE request renders the whole scene; participants are
 * isolated by SocialOS-supplied context, never by N provider instances.
 */
export class MockSceneRenderer {
  readonly name = "mock";
  readonly enabled = true;

  constructor(private readonly deps: SceneRendererDeps) {}

  async renderScene(input: RenderSceneInput): Promise<RenderSceneOutput> {
    const sceneCtx = this.deps.compiler.buildScene({
      eventId: input.event.id,
      eventType: input.event.eventType,
      participants: input.selectedPeople.map((p) => ({
        personId: p.personId,
        score: p.score,
        reasons: p.reasons,
      })),
      circleId: input.circle?.id ?? null,
      actorMessage:
        typeof input.event.payload?.message === "string"
          ? input.event.payload.message
          : "",
      actorId: input.event.actorId,
      actorUserId: this.deps.userInfo.userId,
      actorName: this.deps.userInfo.name,
    });

    const result = await this.deps.gateway.generate({
      eventId: input.event.id,
      caller: "SceneRenderer",
      reason: "scene",
      modelClass: this.deps.sceneModelClass,
      shape: "scene",
      context: sceneCtx.sections,
      cacheDeps: input.selectedPeople.map((p) => p.personId),
    });

    return {
      output: parseSceneOutput(result.content),
      provider: result.provider,
      model: result.model,
      cacheStatus: result.cacheStatus,
    };
  }
}