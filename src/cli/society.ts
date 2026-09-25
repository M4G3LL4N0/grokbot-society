#!/usr/bin/env node
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { SystemClock } from "../god/clock.ts";
import { buildKernelConfig } from "../god/config.ts";
import { GodKernel } from "../god/GodKernel.ts";
import { BENCHMARKS, GodBridge, GOD_LIMITS, compareRoutes, runBenchmarks } from "../godbridge/index.ts";
import { migrateLegacyFacts } from "../godbridge/index.ts";
import type { GodEventInput, GodResult, LegacyFacts } from "../godbridge/index.ts";

// ───────────────────────────────────────────────────────────── helper out
function pad(s: unknown, width: number): string {
  const t = `${s}`;
  return t.length >= width ? t : t + " ".repeat(width - t.length);
}
function table(headers: string[], rows: Array<Array<unknown>>): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => `${r[i] ?? ""}`.length)));
  const line = "─".repeat(widths.reduce((a, w) => a + w + 3, 1));
  const fmt = (cells: unknown[]) => cells.map((c, i) => pad(c, (widths[i] ?? 0))).join(" │ ");
  return [`┌${line.slice(1, -1)}┐`, `│ ${fmt(headers)} │`, `├${line.slice(1, -1)}┤`, ...rows.map((r) => `│ ${fmt(r)} │`), `└${line.slice(1, -1)}┘`].join("\n");
}

function cmdStatus(k: GodKernel): string {
  const s = k.stats();
  const u = k.usage();
  const paused = k.isPaused();
  const lines = [
    `society: ${paused ? "PAUSED" : "active"} · kill switch: ${k.killSwitch ? "ON" : "off"} · mock provider (no paid inference required)`,
    `persons: ${s.persons} · roles: ${s.roles} · circles: ${s.circles} · relationships: ${s.relationships} · events: ${s.events} · memories: ${s.memories}`,
    `model calls: ${s.modelCalls} · background: ${s.backgroundCalls} · est. spend: $${s.totalCost.toFixed(6)}`,
    `cache: ${s.cache.hits} hits / ${s.cache.misses} misses (${s.cache.entries} entries) · blocked calls: ${u.blockedCalls} · escalations: ${u.providerEscalations}`,
    `active persons (7d): ${u.activePersons} · dormant: ${u.dormantPersons} · proactive: ${u.proactive.enabled ? "ON" : "off"} (${u.proactive.reaches} reach / ${u.proactive.noActions} no-action)`,
  ];
  return lines.join("\n");
}

function cmdPeople(k: GodKernel): string {
  const rows = k.persons.list(1000).map((p) => {
    const rels = k.relationship.relationshipsFor(p.id).length;
    const roles = k.roles.assignments(p.id).map((r) => r.name).join(", ");
    return [p.name, p.id, p.socialIntensity, rels, roles.slice(0, 40)];
  });
  return table(["name", "id", "intensity", "rels", "roles"], rows);
}

function findPerson(k: GodKernel, idOrName: string) {
  const q = idOrName.toLowerCase();
  return k.persons.list(1000).find((x) => x.id === idOrName || x.name === idOrName || x.name.toLowerCase().split(" ")[0] === q);
}
function cmdPerson(k: GodKernel, idOrName: string): string {
  const p = findPerson(k, idOrName);
  if (!p) return `unknown person: ${idOrName}`;
  const card = k.identityCard(p.id);
  const cardText = card ? k.identityCards.toText(card) : "";
  const relRows = k.relationship.relationshipsFor(p.id).map((r) => {
    const other = r.personA === p.id ? r.personB : r.personA;
    const otherName = k.persons.get(other)?.name ?? other;
    return [otherName, r.status, r.interactions, `${r.dims.familiarity?.toFixed(2) ?? "-"}/${r.dims.trust?.toFixed(2) ?? "-"}/${r.dims.affection?.toFixed(2) ?? "-"}`];
  });
  const landmarks = k.memory.landmarksFor(p.id).map((m) => `• ${m.content}`);
  const timeline = k.timeline.forPerson(p.id, 5).map((t) => `  🔸 ${t.content}`);
  return [
    `${p.name}  (${p.id})`,
    cardText,
    ``,
    `circles: ${k.circles.list().filter((c) => k.circles.memberPersonIds(c.id).includes(p.id)).map((c) => c.name).join(", ") || "none"}`,
    ``,
    table(["with", "status", "interactions", "fam/trust/aff"], relRows),
    ``,
    `landmarks:`,
    ...(landmarks.length ? landmarks : ["  none yet"]),
    ``,
    `recent timeline:`,
    ...(timeline.length ? timeline : ["  nothing on record"]),
  ].join("\n");
}

function cmdCircles(k: GodKernel): string {
  const rows = k.circles.list().map((c) => {
    const ids = k.circles.memberPersonIds(c.id);
    const names = ids.map((i) => k.persons.get(i)?.name ?? i).join(", ");
    return [c.name, c.id, ids.length, names.slice(0, 60)];
  });
  return table(["name", "id", "members", "people"], rows);
}

function cmdEvents(k: GodKernel): string {
  const rows = (
    k.db.prepare("SELECT id, event_type, status, created_at, circle_id FROM events ORDER BY created_at DESC LIMIT 20").all() as Array<Record<string, unknown>>
  ).map((e) => [String(e.event_type), String(e.status), String(e.circle_id ?? "-"), String(e.created_at)]);
  return table(["event_type", "status", "circle", "at"], rows);
}

function cmdBudget(k: GodKernel): string {
  const b = k.budget.config;
  const u = k.usage();
  return [
    `hourly budget: $${b.hourlyBudget.toFixed(2)} · daily: $${b.dailyBudget.toFixed(2)}`,
    `max calls/event: ${b.maxCallsPerEvent} · max input tokens: ${b.maxInputTokensPerCall} · tier: ${b.modelTier} · background calls: ${b.backgroundModelCalls}`,
    `kill switch: ${k.killSwitch ? "ON" : "off"} · blocked calls so far: ${u.blockedCalls}`,
    `today: $${u.estimatedSpend.toFixed(6)} across ${u.callsToday} calls (${u.callsPerEvent}/event avg)`,
  ].join("\n");
}

function cmdSimulate(k: GodKernel): string {
  const out: string[] = [];
  for (const report of k.cost.report()) {
    out.push(`population: ${report[0]?.population}`);
    out.push(table(["scenario", "calls", "in-tokens", "out-tokens", "est spend", "note"], report.map((s) => [s.name, s.modelCalls, s.inputTokens, s.outputTokens, `$${s.estimatedSpend.toFixed(6)}`, s.dormant ? `${s.dormant} dormant → $0` : "no dormant"])));
    out.push("");
  }
  return out.join("\n");
}

async function cmdChat(k: GodKernel, message: string, opts: { circleId?: string | null }): Promise<string> {
  const ev = await k.tell(message, { circleId: opts.circleId });
  const result = ev.payload.sceneResult as { output: { messages: Array<{ personId: string; text: string }> }; selected: string[]; blockedReason: string | null; skipped?: boolean } | undefined;
  const lines = [`event ${ev.id} · ${ev.eventType} · status: ${ev.status}`];
  if (ev.status === "no_action") lines.push("  (pacing: none of these people merited a scene — quiet is valid)");
  if (ev.status === "deterministic_fallback") lines.push(`  (deterministic fallback — inference was blocked: ${result?.blockedReason})`);
  for (const m of result?.output?.messages ?? []) {
    const speaker = k.persons.get(m.personId)?.name ?? m.personId;
    lines.push(`  ${speaker}: ${m.text}`);
  }
  return lines.join("\n");
}

async function cmdInteractive(k: GodKernel): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = ["interactive society chat — type messages, /help, /exit"];
  const prompt = () =>
    new Promise<string>((resolve) => rl.question("you> ", resolve));
  for (;;) {
    const input = await prompt();
    const msg = input.trim();
    if (msg === "" || msg === "/help") {
      lines.push("  (plain text = message the society · /exit, /person <name>, /events, /budget, /status)");
      continue;
    }
    if (msg === "/exit" || msg === "/quit" || msg === "/q") break;
    if (msg === "/events") { lines.push(cmdEvents(k)); continue; }
    if (msg === "/budget") { lines.push(cmdBudget(k)); continue; }
    if (msg === "/status") { lines.push(cmdStatus(k)); continue; }
    if (msg.startsWith("/person ")) { lines.push(cmdPerson(k, msg.slice(8).trim())); continue; }
    if (msg.startsWith("/proactive")) {
      const r = await k.proactiveTick();
      lines.push(`proactive tick: ${r.candidates} evaluated, ${r.reaches} reached (default disabled → 0 calls)`);
      continue;
    }
    if (msg.startsWith("/simulate")) { lines.push(cmdSimulate(k)); continue; }
    lines.push(await cmdChat(k, msg, { circleId: null }));
  }
  rl.close();
  return lines.join("\n");
}

function cmdSession(k: GodKernel, args: string[]): string {
  const [action, ...rest] = args;
  if (action === "start") {
    const kind = rest[0] || "evening_social";
    const participantIds = k.persons.list(1000).slice(0, 3).map((p) => p.id);
    const s = k.sessionStart({ kind: kind as never, participantIds });
    return `session ${s.id} started (${s.kind}) with ${s.participantIds.length} people`;
  }
  if (action === "end" && rest[0]) {
    const s = k.sessionEnd(rest[0]);
    return s ? `session ${s.id} ended (${s.messageCount} messages)` : "unknown session";
  }
  if (action === "context" && rest[0]) {
    const c = k.sessionContext(rest[0]);
    const lines = c.messages.map((m) => `  [${m.role}] ${m.personId ?? "user"}: ${m.text}`);
    return [`session context (${c.messages.length} msgs in rolling window, ${c.participants.length} cards):`, ...lines].join("\n");
  }
  const rows = (k.db.prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT 20").all() as Array<Record<string, unknown>>).map((r) => [String(r.id), String(r.kind), String(r.status), String(r.started_at), String((r.context_json as string).includes("messageCount") ? JSON.parse(String(r.context_json)).messageCount ?? 0 : 0)]);
  return table(["id", "kind", "status", "started", "msgs"], rows);
}

function cmdLandmarks(k: GodKernel, personId: string): string {
  return k.memory.landmarksFor(personId).map((m) => `• ${m.content}`).join("\n") || "no landmarks";
}

/** Read a God payload from a file, a quoted arg, stdin, or --file. */
function readGodArg(args: string[], inline: string | undefined): string {
  const fileFlag = args.indexOf("--file");
  if (fileFlag >= 0 && args[fileFlag + 1]) {
    return readFileSync(args[fileFlag + 1]!, "utf8");
  }
  if (inline) return inline;
  const positional = args.find((a) => !a.startsWith("--"));
  if (positional) return positional;
  if (!process.stdin.isTTY) return readFileSync(0, "utf8");
  throw new Error("no payload: pass inline JSON, --file <path>, or pipe JSON on stdin");
}

function printUsage(): void {
  console.log(`society — local synthetic society CLI

usage: society <command> [args]

  start [--db <path>]                boot society (seeds 5-person demo on first run)
  status                             society + model + cache state
  people                             list persons
  person <name-or-id>                identity card + relationships + landmarks + timeline
  roles                              role registry (zero agents created by roles)
  circles                            circles + members
  events                             recent events
  chat "<message>" [--circle <id>]   talk to the society
  chat                                interactive REPL
  budget                             budget governor state
  usage                              telemetry: spend per person/circle/provider
  simulate                           cost simulator (5 / 50 / 500 / 5000 people)
  proactive [--circle <id>]          run one explicit proactive tick
  session start|end <id>|context <id>  long-session abstraction
  landmarks <name-or-id>             shared-history stores
  identity <name-or-id>              debug: compact identity card
  debug <name-or-id>                 debug: bounded actor context for one person
  pause / resume                     pause/resume the society
  kill / unkill                      fail-closed kill switch (blocks ALL inference)
  god health                         god-v2 bridge + cost-safety state
  god submit <json> [--bridge]       tiny event in -> GodInput out (or deterministic answer)
  god context <event|job>            inspect the bounded slice Society built
  god result <json>                  structured God deltas -> persistent Society state
  god usage                          cost-per-social-value metrics for God
  god benchmarks [id]                run dry benchmark scenarios ($0.00)
  god compare <id>                   route comparison for one normalized event
  god migrate <json>                 import allowlisted durable legacy facts
  close                              close the db cleanly

env: SOCIETY_DB=<path> (default ./society.db), SOCIETY_USER=<name>, SOCIETY_INTENSITY=quiet|low|normal|social|very_social|do_not_disturb`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? "help";
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const hasFlag = (name: string) => argv.includes(name);

  const dbPath = flag("--db") ?? process.env.SOCIETY_DB ?? "./society.db";
  const bridgeRequested = hasFlag("--bridge") || process.env.SOCIETY_GOD_BRIDGE === "1" || hasFlag("--live") || process.env.SOCIETY_GOD_MODE === "live";
  const mkKernel = (): GodKernel => {
    const config = buildKernelConfig(
      {
        dbPath,
        user: {
          socialIntensity: process.env.SOCIETY_INTENSITY ?? "normal",
        },
      },
      bridgeRequested ? { sceneModelClass: "social.standard" } : undefined,
    );
    return new GodKernel({
      config,
      overrides: {
        clock: new SystemClock(),
        ...(process.env.SOCIETY_USER ? { user: { name: process.env.SOCIETY_USER } } : {}),
      },
    });
  };

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    printUsage();
    return 0;
  }

  if (cmd === "god" && argv[1] === "benchmarks") {
    const only = argv[2]?.startsWith("--") ? undefined : argv[2];
    const outcomes = await runBenchmarks(only);
    if (only && outcomes.length === 0) {
      console.error(`unknown benchmark: ${only}`);
      return 1;
    }
    const rows = outcomes.map((outcome) => [
      outcome.id,
      BENCHMARKS.find((definition) => definition.id === outcome.id)?.title ?? outcome.id,
      outcome.events,
      outcome.modelCalls,
      outcome.personsStored,
      outcome.maxContextTokens,
      `$${outcome.estimatedCost.toFixed(8)}`,
    ]);
    console.log(table(["id", "scenario", "events", "calls", "persons", "max ctx", "cost"], rows));
    console.log(`
limits: ${GOD_LIMITS.maxCallsPerEvent} call/event · recursion ${GOD_LIMITS.recursionDepth} · background ${GOD_LIMITS.backgroundCalls} · retries ${GOD_LIMITS.maxRetries} · maxSpeakers ${GOD_LIMITS.maxSpeakers}`);
    return 0;
  }

  const k = mkKernel();
  k.ensureSeeded();

  try {
    switch (cmd) {
      case "start": {
        console.log(cmdStatus(k));
        console.log(`seeded society at ${dbPath}`);
        break;
      }
      case "status": console.log(cmdStatus(k)); break;
      case "people": console.log(cmdPeople(k)); break;
      case "person": console.log(cmdPerson(k, argv[1] ?? "")); break;
      case "roles": {
        console.log(table(["id", "category", "name"], k.roles.list().map((r) => [r.id, r.category, r.name])));
        break;
      }
      case "circles": console.log(cmdCircles(k)); break;
      case "events": console.log(cmdEvents(k)); break;
      case "budget": console.log(cmdBudget(k)); break;
      case "usage": {
        const u = k.usage();
        const pp = Object.entries(u.spendPerPerson).map(([p, v]) => [k.persons.get(p)?.name ?? p, `$${v.toFixed(6)}`]);
        const pc = Object.entries(u.spendPerCircle).map(([c, v]) => [k.circles.get(c)?.name ?? c, `$${v.toFixed(6)}`]);
        const pr = Object.entries(u.spendPerProvider).map(([c, v]) => [c, `$${v.toFixed(6)}`]);
        console.log([
          `calls today: ${u.callsToday} · per event: ${u.callsPerEvent} · est spend: $${u.estimatedSpend}`,
          `tokens: ${u.tokens.input} in / ${u.tokens.output} out · cache: ${u.cache.hits}H/${u.cache.misses}M`,
          `blocked: ${u.blockedCalls} · escalations: ${u.providerEscalations} · trips: ${u.trips.map((t) => `${t.breaker}@${t.at}`).join(", ") || "none"}`,
          ``,
          "spend per person:", table(["person", "spend"], pp),
          "spend per circle:", table(["circle", "spend"], pc),
          "spend per provider:", table(["provider", "spend"], pr),
          "renderers:", table(["renderer", "enabled"], k.capableRenderers().map((r) => [r.name, r.enabled ? "yes" : "no"])),
        ].join("\n"));
        break;
      }
      case "simulate": console.log(cmdSimulate(k)); break;
      case "proactive": {
        const r = await k.proactiveTick(flag("--circle"));
        console.log(`proactive tick: ${r.candidates} candidates → ${r.reaches} reach · ${k.telemetry.totalCalls()} total calls`);
        break;
      }
      case "chat": {
        const circle = flag("--circle");
        const message = argv[1];
        if (!message) {
          console.log(await cmdInteractive(k));
        } else {
          console.log(await cmdChat(k, message, { circleId: circle }));
        }
        break;
      }
      case "god": {
        const bridgeEnabled = hasFlag("--bridge") || process.env.SOCIETY_GOD_BRIDGE === "1";
        const bridgeMode = hasFlag("--live") || process.env.SOCIETY_GOD_MODE === "live" ? "live" : "dry";
        const bridge = new GodBridge(
          k,
          new SystemClock(),
          flag("--model") === "chatgpt" ? "chatgpt" : "grok",
          bridgeEnabled,
          bridgeMode,
        );
        const sub = argv[1] ?? "health";
        if (sub === "health") {
          console.log(JSON.stringify(bridge.health(), null, 2));
        } else if (sub === "submit") {
          const raw = readGodArg(argv.slice(2), flag("--text"));
          const input = JSON.parse(raw) as GodEventInput;
          const outcome = await bridge.submit(input);
          if (hasFlag("--json")) {
            console.log(JSON.stringify(outcome, null, 2));
          } else if (outcome.status === "needs_god" && outcome.job) {
            console.log(JSON.stringify(outcome.job.input, null, 2));
          } else {
            console.log(`no external inference: ${outcome.reason}`);
            if (outcome.deterministic) console.log(JSON.stringify(outcome.deterministic, null, 2));
          }
        } else if (sub === "context") {
          const ref = argv[2] ?? flag("--event") ?? "";
          if (!ref) { console.error("usage: society god context <eventId|jobId>"); return 1; }
          console.log(JSON.stringify(bridge.context(ref), null, 2));
        } else if (sub === "result") {
          const raw = readGodArg(argv.slice(2), flag("--json-body"));
          const result = JSON.parse(raw) as GodResult;
          const applied = bridge.apply(result);
          if (hasFlag("--json")) {
            console.log(JSON.stringify({ status: applied.reason, usage: applied.usage }, null, 2));
          } else {
            console.log(`${applied.applied ? "persisted" : "rejected"}: ${applied.reason}`);
            console.log(
              `  $${applied.usage.estimatedCost.toFixed(8)} · ${applied.usage.inputTokens} in / ${applied.usage.outputTokens} out · ${applied.usage.resultStatus}`,
            );
            console.log(`  why god: ${applied.usage.reasonGrokRequired}`);
          }
        } else if (sub === "usage") {
          console.log(JSON.stringify(bridge.usage(), null, 2));
        } else if (sub === "benchmarks") {
          const only = argv[2]?.startsWith("--") ? undefined : argv[2];
          const outcomes = await runBenchmarks(only);
          if (only && outcomes.length === 0) {
            console.error(`unknown benchmark: ${only}`);
            return 1;
          }
          const rows = outcomes.map((outcome) => [
            outcome.id,
            BENCHMARKS.find((definition) => definition.id === outcome.id)?.title ?? outcome.id,
            outcome.events,
            outcome.modelCalls,
            outcome.personsStored,
            outcome.maxContextTokens,
            `$${outcome.estimatedCost.toFixed(8)}`,
          ]);
          console.log(table(["id", "scenario", "events", "calls", "persons", "max ctx", "cost"], rows));
          console.log(`
limits: ${GOD_LIMITS.maxCallsPerEvent} call/event · recursion ${GOD_LIMITS.recursionDepth} · background ${GOD_LIMITS.backgroundCalls} · retries ${GOD_LIMITS.maxRetries} · maxSpeakers ${GOD_LIMITS.maxSpeakers}`);
        } else if (sub === "compare") {
          console.log(JSON.stringify(compareRoutes(k, new SystemClock(), argv[2] ?? "A"), null, 2));
        } else if (sub === "migrate") {
          const raw = readGodArg(argv.slice(2), flag("--json-body"));
          const report = migrateLegacyFacts(k, JSON.parse(raw) as LegacyFacts);
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.error(`unknown god subcommand: ${sub}`);
          return 1;
        }
        break;
      }
      case "session": console.log(cmdSession(k, argv.slice(1))); break;
      case "landmarks": console.log(cmdLandmarks(k, argv[1] ?? "")); break;
      case "identity": {
        const p = findPerson(k, argv[1] ?? "");
        if (!p) { console.log("unknown person"); break; }
        const card = k.identityCard(p.id);
        console.log(card ? k.identityCards.toText(card) : "no card");
        break;
      }
      case "debug": {
        const p = findPerson(k, argv[1] ?? "");
        if (!p) { console.log("unknown person"); break; }
        const ctx = k.composeActorContext(p.id, "debug", [], null);
        console.log([
          `ACTOR CONTEXT for ${p.name} · ${p.id} · scene debug (bounded, deterministic)`,
          ``,
          "CARD:", "\n" + k.identityCards.toText(ctx.card),
          ``,
          `ROLES (${ctx.roles.length}):`, ...ctx.roles.map((r) => `  ${r.id} — ${r.name}`),
          ``,
          `RELATIONSHIPS (${ctx.relationships.length}):`, ...ctx.relationships.map((r) => `  ${r.personId} ${r.status} (${r.interactions} interactions)`),
          ``,
          `MEMORIES (${ctx.memories.length}, bounds enforced):`, ...ctx.memories.map((m) => `  [${m.type}] ${m.content}`),
        ].join("\n"));
        break;
      }
      case "pause": console.log(k.pause()); console.log(cmdStatus(k)); break;
      case "resume": console.log(k.resume()); console.log(cmdStatus(k)); break;
      case "kill": console.log(k.setKillSwitch(true)); break;
      case "unkill": console.log(k.setKillSwitch(false)); break;
      case "close": console.log("db closed"); break;
      default:
        printUsage();
        return 1;
    }
  } finally {
    k.close();
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);