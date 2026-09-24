import type { IntelligenceConfig, ModelClass, RouteConfig } from "../god/config.ts";

export class ModelUnavailableForRouteError extends Error {
  constructor(modelClass: ModelClass) {
    super(`No route configured for capability ${modelClass}.`);
    this.name = "ModelUnavailableForRouteError";
  }
}

function isNoCost(route: RouteConfig): boolean {
  return route.provider === "mock" || route.provider === "deterministic";
}

/**
 * ModelRouter: maps provider-NEUTRAL capability classes
 * (social.deterministic/mock/nano/standard/deep) to concrete providers/models.
 * Routing is pure configuration — switching providers never touches a Person.
 */
export class ModelRouter {
  private routes: Record<ModelClass, RouteConfig>;
  private escalations = 0;

  constructor(private readonly config: IntelligenceConfig) {
    this.routes = { ...config.routes };
  }

  route(modelClass: ModelClass): RouteConfig {
    const route = this.routes[modelClass];
    if (!route) throw new ModelUnavailableForRouteError(modelClass);
    return { ...route };
  }

  setRoute(modelClass: ModelClass, route: RouteConfig): void {
    const previous = this.routes[modelClass];
    this.routes[modelClass] = route;
    this.config.routes[modelClass] = route;
    // An escalation only matters when a previously no-cost route moves to a
    // real (paid) provider: cheap -> deep for the SAME capability.
    if (previous && isNoCost(previous) && !isNoCost(route)) {
      this.escalations += 1;
    }
  }

  escalationCount(): number {
    return this.escalations;
  }

  allRoutes(): Record<ModelClass, RouteConfig> {
    return { ...this.routes };
  }

  /** Routes to a persistent-entity (GrokBot/Bridge) capability when contractually
   *  reachable. Uses the deepest tier with a REAL provider; default config (all
   *  mock) maps God to mock → God stays $0 until a real route is configured.
   *  NEVER creates an entity; this is pure routing. */
  entityCreate(kind: "god" | "person" | "bridge"): { kind: typeof kind; modelClass: ModelClass } {
    const priority: ModelClass[] = [
      "social.deep",
      "social.standard",
      "social.nano",
      "social.mock",
      "social.deterministic",
    ];
    for (const mc of priority) {
      const route = this.routes[mc];
      if (route && route.provider !== "mock" && route.provider !== "deterministic") {
        return { kind, modelClass: mc };
      }
    }
    return { kind, modelClass: "social.mock" };
  }
}