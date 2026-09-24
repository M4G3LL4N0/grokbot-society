import type { SocietyDB } from "../god/db.ts";
import { json, parseJson } from "../god/db.ts";
import { id } from "../god/id.ts";
import type { Clock } from "../god/clock.ts";
import type { Circle } from "../god/types.ts";

interface CircleRow {
  id: string;
  name: string;
  kind: string;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

function rowToCircle(row: CircleRow): Circle {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * CircleService manages cheap persistent graph/state objects — groups,
 * circles and communities. A 100-person circle at rest consumes zero
 * inference.
 */
export class CircleService {
  private insert: ReturnType<SocietyDB["prepare"]>;
  private selectById: ReturnType<SocietyDB["prepare"]>;
  private selectAll: ReturnType<SocietyDB["prepare"]>;
  private countStmt: ReturnType<SocietyDB["prepare"]>;
  private addMemberStmt: ReturnType<SocietyDB["prepare"]>;
  private removeMemberStmt: ReturnType<SocietyDB["prepare"]>;
  private membersStmt: ReturnType<SocietyDB["prepare"]>;
  private memberCirclesStmt: ReturnType<SocietyDB["prepare"]>;

  constructor(
    private readonly db: SocietyDB,
    private readonly clock: Clock,
    private readonly maxCircles: number,
  ) {
    this.insert = db.prepare(
      "INSERT INTO circles (id, name, kind, metadata_json, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    );
    this.selectById = db.prepare("SELECT * FROM circles WHERE id = ?");
    this.selectAll = db.prepare("SELECT * FROM circles ORDER BY created_at ASC");
    this.countStmt = db.prepare("SELECT COUNT(*) AS n FROM circles");
    this.addMemberStmt = db.prepare(
      "INSERT OR IGNORE INTO circle_members (circle_id, member_id, member_type, joined_at) VALUES (?,?,?,?)",
    );
    this.removeMemberStmt = db.prepare(
      "DELETE FROM circle_members WHERE circle_id = ? AND member_id = ?",
    );
    this.membersStmt = db.prepare(
      "SELECT member_id, member_type, joined_at FROM circle_members WHERE circle_id = ? ORDER BY joined_at ASC",
    );
    this.memberCirclesStmt = db.prepare(
      `SELECT c.* FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
       WHERE cm.member_id = ? ORDER BY c.name`,
    );
  }

  create(name: string, kind = "circle", metadata: Record<string, unknown> = {}): Circle {
    if (this.count() >= this.maxCircles) {
      throw new Error(`Circle population limit reached (${this.maxCircles}).`);
    }
    const now = this.clock.now();
    const circle: Circle = {
      id: id("c"),
      name,
      kind,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.insert.run(circle.id, circle.name, circle.kind, json(circle.metadata), now, now);
    return circle;
  }

  get(circleId: string): Circle | null {
    const row = this.selectById.get(circleId) as CircleRow | undefined;
    return row ? rowToCircle(row) : null;
  }

  list(): Circle[] {
    return (this.selectAll.all() as unknown as CircleRow[]).map(rowToCircle);
  }

  count(): number {
    return (this.countStmt.get() as { n: number }).n;
  }

  addMember(circleId: string, memberId: string, memberType: "person" | "user" = "person"): void {
    this.addMemberStmt.run(circleId, memberId, memberType, this.clock.now());
  }

  removeMember(circleId: string, memberId: string): void {
    this.removeMemberStmt.run(circleId, memberId);
  }

  members(circleId: string): Array<{ memberId: string; memberType: string; joinedAt: number }> {
    const rows = this.membersStmt.all(circleId) as Array<{
      member_id: string;
      member_type: string;
      joined_at: number;
    }>;
    return rows.map((r) => ({
      memberId: r.member_id,
      memberType: r.member_type,
      joinedAt: r.joined_at,
    }));
  }

  memberPersonIds(circleId: string): string[] {
    return this.members(circleId)
      .filter((m) => m.memberType === "person")
      .map((m) => m.memberId);
  }

  circlesFor(memberId: string): Circle[] {
    return (this.memberCirclesStmt.all(memberId) as unknown as CircleRow[]).map(rowToCircle);
  }
}