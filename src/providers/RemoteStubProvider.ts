import type { ModelClass } from "../god/types.ts";
import { ModelUnavailableError } from "../god/errors.ts";
import {
  assertGatewalledCall,
  type Provider,
  type ProviderRequest,
  type ProviderResult,
} from "./types.ts";

export type StubKind = "nano" | "standard" | "deep";

/**
 * Fail-closed stubs for real capabilities (nano / ChatGPT-standard / Grok).
 *
 * - They are NOT configured during this build phase => isAvailable() false.
 * - Any attempted call while unavailable throws ModelUnavailableError.
 * - When an API key is supplied later, a real client slots into `generate`.
 *   The contract (provider name gives up `social.deep`) never owns Person
 *   identity or society state — GrokBots are interfaces, not canonical state.
 */
export class RemoteStubProvider implements Provider {
  readonly name: string;
  readonly supports: ModelClass[];
  calls = 0;

  private envKey: string;

  constructor(kind: StubKind) {
    if (kind === "nano") {
      this.name = "nano";
      this.supports = ["social.nano"];
      this.envKey = "SOCIETY_NANO_API_KEY";
    } else if (kind === "standard") {
      this.name = "standard";
      this.supports = ["social.standard"];
      this.envKey = "OPENAI_API_KEY";
    } else {
      this.name = "deep";
      this.supports = ["social.deep"];
      this.envKey = "GROK_API_KEY";
    }
  }

  isAvailable(): boolean {
    return Boolean(process.env[this.envKey]);
  }

  async generate(_request: ProviderRequest): Promise<ProviderResult> {
    assertGatewalledCall();
    if (!this.isAvailable()) {
      throw new ModelUnavailableError(
        `${this.name} is not configured (missing ${this.envKey}). Build phase uses MockProvider only.`,
      );
    }
    // Intentionally unreachable until a real client is wired in a later phase.
    throw new ModelUnavailableError(
      `${this.name} client not wired yet by design (no paid/API resources during build).`,
    );
  }
}