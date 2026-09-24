import { randomUUID } from "node:crypto";

let sequence = 0;

/** Collision-tolerant, prefixed, sortable-ish id generator. */
export function id(prefix: string): string {
  sequence += 1;
  return `${prefix}_${randomUUID().slice(0, 8)}_${sequence.toString(36)}`;
}

export function nowId(): string {
  return id("ts");
}