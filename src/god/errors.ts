/** Domain errors. All provider/model operations fail CLOSED. */

export class SocietyError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Global kill switch engaged. No provider call may proceed. */
export class KillSwitchError extends SocietyError {
  constructor(message = "Kill switch engaged: all model inference is blocked.") {
    super("KILL_SWITCH", message);
  }
}

/** Budget limits reached. System continues deterministically; inference is blocked. */
export class BudgetExceededError extends SocietyError {
  detail: Record<string, unknown>;

  constructor(
    message: string,
    detail: Record<string, unknown> = {},
  ) {
    super("BUDGET_EXCEEDED", message);
    this.detail = detail;
  }
}

/** Recursion depth exceeded. Nested inference is prohibited. */
export class RecursionBlockedError extends SocietyError {
  constructor(message = "Recursion is disabled: nested model inference is blocked.") {
    super("RECURSION_BLOCKED", message);
  }
}

/** A provider was invoked outside the IntelligenceGateway. Architecturally blocked. */
export class ProviderCallOutsideGatewayError extends SocietyError {
  constructor(message = "Provider calls are architecturally blocked outside the IntelligenceGateway.") {
    super("PROVIDER_CALL_OUTSIDE_GATEWAY", message);
  }
}

/** Route/capability requested but not configured or unavailable. */
export class ModelUnavailableError extends SocietyError {
  constructor(message = "Requested model capability is not configured or unavailable.") {
    super("MODEL_UNAVAILABLE", message);
  }
}

/** Deterministic validation of output/state failed. */
export class ValidationError extends SocietyError {
  constructor(message: string) {
    super("VALIDATION_FAILED", message);
  }
}