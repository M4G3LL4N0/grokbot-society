import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeKernel } from "./helpers.ts";
import {
  migrateLegacyFacts,
  type LegacyFacts,
} from "../src/godbridge/migration.ts";

function handoff(name: string): string {
  return readFileSync(new URL(`../handoff/god-v2/${name}`, import.meta.url), "utf8");
}

describe("13 · legacy God migration", () => {
  it("imports only durable facts and reports transient fields", () => {
    const h = makeKernel();
    try {
      const input: LegacyFacts = {
        persons: [
          {
            name: "Ada",
            biography: "Builds careful systems.",
            identity: { core: "precise" },
            personality: { summary: "steady" },
            interests: ["math", "maps"],
            preferences: { pace: "slow" },
            goals: ["finish the atlas"],
            opinions: { coffee: "useful" },
            communicationStyle: { tone: "concise" },
            socialIntensity: "quiet",
            roles: ["friend"],
            circles: ["Migration Circle"],
            prompt: "private system prompt",
          },
          {
            name: "Lin",
            biography: "Keeps a small studio.",
            identity: { core: "curious" },
            personality: { summary: "playful" },
            interests: ["ceramics"],
            preferences: { pace: "steady" },
            goals: ["open the studio"],
            opinions: { weather: "changeable" },
            communicationStyle: { tone: "warm" },
            socialIntensity: "normal",
            roles: ["social_connector"],
            circles: ["Migration Circle"],
            developmentHistory: "old debate",
          },
        ],
        relationships: [
          {
            a: "Ada",
            b: "Lin",
            dims: { familiarity: 0.6, trust: 0.4, invented_dimension: 1 },
            interactions: 4,
            transcript: "conversation transcript",
          },
        ],
        circles: [
          {
            name: "Migration Circle",
            kind: "circle",
            members: ["Ada", "Lin"],
            logs: "migration log",
          },
        ],
        memories: [
          {
            a: "Ada",
            b: "Lin",
            kind: "shared_trip",
            content: "They visited the coast together.",
            importance: 0.7,
            filler: "small talk",
          },
          {
            personId: "Ada",
            kind: "preference",
            content: "Ada prefers quiet cafés.",
            importance: 0.6,
          },
        ],
        preferences: [
          { key: "social_intensity", value: "normal" },
          { key: "pace", value: "slow" },
        ],
        prompts: ["old prompt"],
        transcripts: ["old transcript"],
        filler: ["pleasantries"],
        logs: ["debug log"],
        developmentHistory: ["design debate"],
      };

      const before = h.kernel.stats();
      const report = migrateLegacyFacts(h.kernel, input);
      const after = h.kernel.stats();

      expect(report.counts).toMatchObject({
        persons: 2,
        relationships: 1,
        circles: 1,
        memories: 2,
        preferences: 2,
        roles: 2,
      });
      expect(after.persons - before.persons).toBe(2);
      expect(after.relationships - before.relationships).toBe(1);
      expect(after.circles - before.circles).toBe(1);
      expect(after.memories - before.memories).toBe(3);

      const ada = h.kernel.persons.list().find((person) => person.name === "Ada");
      const lin = h.kernel.persons.list().find((person) => person.name === "Lin");
      expect(ada?.preferences).toEqual({ pace: "slow" });
      expect(ada?.biography).toBe("Builds careful systems.");
      expect(lin?.preferences).toEqual({ pace: "steady" });
      expect(ada && lin && h.kernel.relationship.get(ada.id, lin.id)).toMatchObject({
        interactions: 4,
        dims: { familiarity: 0.6, trust: 0.4 },
      });

      const circle = h.kernel.circles.list().find((candidate) => candidate.name === "Migration Circle");
      expect(circle).toBeDefined();
      expect(circle && h.kernel.circles.memberPersonIds(circle.id).sort()).toEqual(
        [ada?.id, lin?.id].filter(Boolean).sort(),
      );
      expect(h.kernel.memory.search(ada!.id, "coast")).toHaveLength(1);
      expect(h.kernel.db.meta.get("user.preferences")).toMatchObject({
        social_intensity: "normal",
        pace: "slow",
      });
      expect(report.ignoredFields).toEqual(
        expect.arrayContaining([
          "prompts",
          "transcripts",
          "filler",
          "logs",
          "developmentHistory",
          "persons[0].prompt",
          "persons[1].developmentHistory",
          "relationships[0].transcript",
          "circles[0].logs",
          "memories[0].filler",
        ]),
      );
      expect(JSON.stringify(report.ignoredFields)).not.toContain("private system prompt");
    } finally {
      h.kernel.close();
    }
  });

  it("reports unknown fields and keeps nested transient data out of durable records", () => {
    const h = makeKernel();
    try {
      const report = migrateLegacyFacts(h.kernel, {
        persons: [
          {
            id: "legacy-ada",
            name: "Ada",
            identity: { core: "stable", prompt: "nested secret" },
            prompt: "person secret",
            unknownFact: "do not copy",
          },
          { id: "legacy-lin", name: "Lin" },
        ],
        relationships: [
          {
            personA: "legacy-ada",
            personB: "legacy-lin",
            dimensions: { trust: 0.7 },
            filler: "relationship filler",
          },
        ],
        preferences: { theme: "dark", retries: 2, enabled: true },
        memories: [
          { personId: "legacy-ada", kind: "filler", content: "small talk" },
        ],
        debug: { secret: "do not import" },
      } as unknown as LegacyFacts);

      const ada = h.kernel.persons.list().find((person) => person.name === "Ada");
      const lin = h.kernel.persons.list().find((person) => person.name === "Lin");
      expect(ada?.identity).toEqual({ core: "stable" });
      expect(ada && lin && h.kernel.relationship.get(ada.id, lin.id)).toMatchObject({
        dims: { trust: 0.7 },
      });
      expect(h.kernel.db.meta.get("user.preferences")).toEqual({
        theme: "dark",
        retries: 2,
        enabled: true,
      });
      expect(report.ignoredFields).toEqual(
        expect.arrayContaining([
          "debug",
          "persons[0].identity.prompt",
          "persons[0].prompt",
          "persons[0].unknownFact",
          "relationships[0].filler",
          "memories[0].kind",
        ]),
      );
      expect(JSON.stringify(h.kernel.db.meta.get("user.preferences"))).not.toContain("do not import");
    } finally {
      h.kernel.close();
    }
  });

  it("ignores transient-only input without copying it into state", () => {
    const h = makeKernel();
    try {
      const report = migrateLegacyFacts(h.kernel, {
        prompts: ["system prompt"],
        transcripts: ["assistant transcript"],
        filler: ["pleasantry"],
        logs: ["request log"],
        developmentHistory: ["planning thread"],
      } as LegacyFacts);
      const serialized = JSON.stringify({
        persons: h.kernel.persons.list(),
        relationships: h.kernel.relationship.relationshipsFor("person_0"),
        memories: h.kernel.stats(),
        meta: h.kernel.db.meta.get("user.preferences"),
      });
      expect(report.counts).toMatchObject({ persons: 0, relationships: 0, circles: 0, memories: 0, preferences: 0 });
      expect(serialized).not.toContain("system prompt");
      expect(serialized).not.toContain("assistant transcript");
      expect(serialized).not.toContain("pleasantry");
      expect(serialized).not.toContain("request log");
      expect(serialized).not.toContain("planning thread");
    } finally {
      h.kernel.close();
    }
  });

  it("supports the operator migration command", () => {
    const root = mkdtempSync(join(tmpdir(), "god-migrate-cli-"));
    const file = join(root, "operator.db");
    try {
      const payload = JSON.stringify({ persons: [{ name: "CLI Migrant", biography: "durable fact" }] });
      const report = execFileSync(
        "pnpm",
        ["society", "god", "migrate", payload, "--db", file],
        { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" },
      );
      expect(report).toContain('"persons": 1');
      const people = execFileSync("pnpm", ["society", "people", "--db", file], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
      expect(people).toContain("CLI Migrant");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("13 · God v2 handoff contract", () => {
  it("describes one bounded God and durable-only migration", () => {
    const prompt = handoff("GOD_PROMPT.txt");
    const setup = handoff("SETUP.md");
    const contract = JSON.parse(handoff("CONTRACT.json")) as Record<string, unknown>;
    const health = handoff("HEALTHCHECK.md");
    const migration = handoff("MIGRATION.md");

    expect(prompt).toContain("premium social interface");
    expect(prompt).toContain("Society runtime owns canonical state");
    expect(prompt).toContain("Do not create GrokBots");
    expect(prompt).toContain("Do not do repository or code work");
    expect(prompt).toContain("Return control after each event");
    expect(prompt).not.toMatch(/\b(pnpm|npm|git|bash|readFile|exec|spawn)\b/i);
    expect(setup.toLowerCase()).toContain("dry");
    expect(setup).not.toContain("--live");
    expect(contract).toMatchObject({
      identity: { agents: 1, persistsState: false },
      execution: {
        defaultMode: "dry",
        liveMode: "explicit-operator-opt-in",
        repositoryWork: false,
      },
      limits: {
        maxCallsPerEvent: 1,
        recursionDepth: 0,
        backgroundModelCalls: 0,
        maxRetries: 0,
        maxSpeakers: 3,
      },
    });
    expect(health.toLowerCase()).toContain("dry");
    expect(health.toLowerCase()).toContain("live");
    expect(migration.toLowerCase()).toContain("durable");
    expect(migration.toLowerCase()).toContain("prompts");
    expect(migration.toLowerCase()).toContain("transcripts");
    expect(migration.toLowerCase()).toContain("filler");
    expect(migration.toLowerCase()).toContain("logs");
    expect(migration.toLowerCase()).toContain("development history");
    expect(migration).toContain("god migrate");
    expect(migration).not.toMatch(/```bash|pnpm society|profile`/i);
  });
});
