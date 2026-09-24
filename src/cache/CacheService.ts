import { createHash } from "node:crypto";
import type { SocietyDB } from "../god/db.ts";
import { json, parseJson } from "../god/db.ts";
import type { Clock } from "../god/clock.ts";

/**
 * CacheService: shared intelligence cache with content hashes and
 * dependency-aware invalidation. Keys are sha256 over the canonical request
 * shape (event/provider budget-independent), so identical scenes reuse results.
 */
export class CacheService {
  private getStmt: ReturnType<SocietyDB["prepare"]>;
  private setStmt: ReturnType<SocietyDB["prepare"]>;
  private touchStmt: ReturnType<SocietyDB["prepare"]>;
  private delByDepStmt: ReturnType<SocietyDB["prepare"]>;
  private countStmt: ReturnType<SocietyDB["prepare"]>;
  private hitsInMemory = 0;
  private missesInMemory = 0;

  constructor(
    private readonly db: SocietyDB,
    private readonly clock: Clock,
    private readonly enabled: boolean,
    private readonly maxEntries: number,
  ) {
    this.getStmt = db.prepare("SELECT result_json, deps_json, hits FROM intelligence_cache WHERE key = ?");
    this.setStmt = db.prepare(
      "INSERT INTO intelligence_cache (key, result_json, deps_json, created_at, hits) VALUES (?,?,?,?,0)",
    );
    this.touchStmt = db.prepare("UPDATE intelligence_cache SET hits = hits + 1 WHERE key = ?");
    this.delByDepStmt = db.prepare("DELETE FROM intelligence_cache WHERE deps_json LIKE ?");
    this.countStmt = db.prepare("SELECT COUNT(*) AS n FROM intelligence_cache");
  }

  /** Canonical content hash for a request. */
  static contentHash(parts: Array<string | object>): string {
    const hash = createHash("sha256");
    for (const part of parts) {
      hash.update(typeof part === "string" ? part : json(part));
      hash.update("|");
    }
    return hash.digest("hex");
  }

  get<T>(key: string): T | null {
    if (!this.enabled) {
      this.missesInMemory += 1;
      return null;
    }
    const row = this.getStmt.get(key) as { result_json: string } | undefined;
    if (!row) {
      this.missesInMemory += 1;
      // enforce bound lazily
      if (this.size() >= this.maxEntries) {
        this.db.exec("DELETE FROM intelligence_cache WHERE key IN (SELECT key FROM intelligence_cache ORDER BY hits ASC, created_at ASC LIMIT 100)");
      }
      return null;
    }
    this.touchStmt.run(key);
    this.hitsInMemory += 1;
    return parseJson(row.result_json, null as T);
  }

  set<T>(key: string, value: T, deps: string[] = []): void {
    if (!this.enabled) return;
    if (this.size() >= this.maxEntries) {
      this.db.exec("DELETE FROM intelligence_cache WHERE key IN (SELECT key FROM intelligence_cache ORDER BY hits ASC, created_at ASC LIMIT 100)");
    }
    this.setStmt.run(key, json(value), json(deps), this.clock.now());
  }

  invalidateByDependency(dep: string): void {
    this.delByDepStmt.run(`%"${dep}"%`);
  }

  size(): number {
    return (this.countStmt.get() as { n: number }).n;
  }

  stats(): { hits: number; misses: number; entries: number } {
    return {
      hits: this.hitsInMemory,
      misses: this.missesInMemory,
      entries: this.size(),
    };
  }

  resetStats(): void {
    this.hitsInMemory = 0;
    this.missesInMemory = 0;
  }
}