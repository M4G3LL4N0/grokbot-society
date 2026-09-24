/** Injectable time source. SystemClock for production, SimulatedClock for tests. */
export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class SimulatedClock implements Clock {
  private t: number;

  constructor(start = 1_700_000_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  advance(ms: number): number {
    this.t += ms;
    return this.t;
  }

  set(ms: number): number {
    this.t = ms;
    return this.t;
  }
}