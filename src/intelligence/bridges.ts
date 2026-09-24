import type { ModelClass } from "../god/types.ts";

/**
 * BoundedScenePackage — the EXACT minimal payload SocialOS hands an external
 * entity (GrokBot "God" or a ChatGPT bridge). Small, self-contained, and only
 * as much state as one scene needs. Canonical identity/roles/memory/
 * relationships/circles/timeline NEVER leave SocialOS.
 */
export interface BoundedScenePackage {
  scene: {
    eventId: string;
    eventType: string;
    actor: { id: string; name: string } | null;
    message: string;
    participants: Array<{
      personId: string;
      displayName: string;
      roleIds: string[];
    }>;
  };
  /** Indexed by personId. Strictly bounded (IdentityCardCompiler output). */
  identity: Record<string, unknown>;
  responsibilities: Record<string, { roleId: string; summary: string }[]>;
  relationship: Record<string, Array<{ other: string; dims: Record<string, number> }>>;
  memory: Record<string, Array<{ type: string; text: string }>>;
  outputBudget: { maxMessages: number; maxTokens: number };
}

/** Structured result the external entity must return. */
export interface BoundedSceneResult {
  messages: Array<{ personId: string; text: string }>;
  memoryCandidates: unknown[];
  relationshipCandidates: unknown[];
  timelineCandidates: unknown[];
  followups: Array<{ personId: string; kind: string; at: number }>;
}

export class BridgeDisabledError extends Error {
  constructor(name: string) {
    super(`${name} is disabled. Enable via kernel config before use.`);
    this.name = "BridgeDisabledError";
  }
}

interface CapableRenderer {
  readonly name: string;
  readonly enabled: boolean;
  renderScene(pkg: BoundedScenePackage): Promise<BoundedSceneResult>;
}

/**
 * SocialCoreAdapter — the hand reticle for the ONE persistent GrokBot ("God",
 * id `SocialCore`). SocialOS composes per-Person context isolation; ONE request
 * can render MANY persons (multi-person scene = one call). God NEVER stores
 * canonical state. Disabled by default: society must run without it, at $0.
 */
export class SocialCoreAdapter implements CapableRenderer {
  readonly name = "socialcore";
  readonly enabled = false;

  constructor(private readonly route: { modelClass: ModelClass }) {
    void route;
  }

  async renderScene(_pkg: BoundedScenePackage): Promise<BoundedSceneResult> {
    throw new BridgeDisabledError(this.name);
  }
}

/** ChatGPT bridge — repetitive/zero-value work stays local; only high-value
 *  reasoning may ever route here. NOT a persistent Person. Disabled. */
export class ChatGPTBridge implements CapableRenderer {
  readonly name = "chatgpt";
  readonly enabled = false;

  async renderScene(_pkg: BoundedScenePackage): Promise<BoundedSceneResult> {
    throw new BridgeDisabledError(this.name);
  }
}

export function createBridges(godRoute: { modelClass: ModelClass }): {
  socialcore: SocialCoreAdapter;
  chatgpt: ChatGPTBridge;
} {
  return {
    socialcore: new SocialCoreAdapter(godRoute),
    chatgpt: new ChatGPTBridge(),
  };
}