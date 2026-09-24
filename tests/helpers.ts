import { createKernel, type GodKernel } from "../src/god/GodKernel.ts";
import { SimulatedClock } from "../src/god/clock.ts";
import { MockProvider } from "../src/providers/MockProvider.ts";
import type { BudgetLimits, IntelligenceConfig, SocietyConfigInput } from "../src/god/config.ts";

export interface KernelHarness {
  kernel: GodKernel;
  clock: SimulatedClock;
  mock: MockProvider;
}

/**
 * Fresh in-memory kernel on a simulated clock with serendipity dialed to
 * "never fires" by default (rng returns 1 > probability 0.25).
 */
export function makeKernel(
  society: SocietyConfigInput = {},
  intelligence?: Omit<Partial<IntelligenceConfig>, "budget"> & { budget?: Partial<BudgetLimits> },
  rng: () => number = () => 1,
): KernelHarness {
  const clock = new SimulatedClock();
  const kernel = createKernel(society, { clock, rng }, intelligence);
  const mock = kernel.gateway.getProvider("mock") as MockProvider;
  return { kernel, clock, mock };
}

export function sceneMessages(event: { payload: Record<string, unknown> }): Array<{ personId: string; text: string }> {
  const sc = event.payload?.sceneResult as {
    output?: { messages?: Array<{ personId: string; text: string }> };
  } | undefined;
  return sc?.output?.messages ?? [];
}

export function selectedIds(event: { payload: Record<string, unknown> }): string[] {
  const sc = event.payload?.sceneResult as { selected?: string[] } | undefined;
  return sc?.selected ?? [];
}

/** Persons helpers */
export function createPerson(kernel: GodKernel, name: string, extra: Record<string, unknown> = {}) {
  return kernel.createPerson({ name, ...extra });
}