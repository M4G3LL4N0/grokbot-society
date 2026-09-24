import type { SocietyDB } from "../god/db.ts";
import { json, parseJson } from "../god/db.ts";
import type { Clock } from "../god/clock.ts";
import type { RoleCategory, RoleDefinition } from "../god/types.ts";

interface RoleRow {
  id: string;
  category: RoleCategory;
  name: string;
  definition_json: string;
  created_at: number;
}

function rowToDef(row: RoleRow): RoleDefinition {
  const def = parseJson(row.definition_json, null as unknown as RoleDefinition);
  return { ...def, id: row.id, category: row.category, name: def.name ?? row.id };
}

/**
 * RoleService is the role registry. Roles are reusable behavior/capability
 * definitions — they NEVER spawn agents and assigning one costs zero inference.
 */
export class RoleService {
  private insert: ReturnType<SocietyDB["prepare"]>;
  private selectById: ReturnType<SocietyDB["prepare"]>;
  private selectByCategory: ReturnType<SocietyDB["prepare"]>;
  private selectAll: ReturnType<SocietyDB["prepare"]>;
  private assignStmt: ReturnType<SocietyDB["prepare"]>;
  private assignmentsStmt: ReturnType<SocietyDB["prepare"]>;
  private countStmt: ReturnType<SocietyDB["prepare"]>;
  private deleteStmt: ReturnType<SocietyDB["prepare"]>;

  constructor(
    private readonly db: SocietyDB,
    private readonly clock: Clock,
  ) {
    this.insert = db.prepare(
      "INSERT OR IGNORE INTO roles (id, category, name, definition_json, created_at) VALUES (?,?,?,?,?)",
    );
    this.selectById = db.prepare("SELECT * FROM roles WHERE id = ?");
    this.selectByCategory = db.prepare(
      "SELECT * FROM roles WHERE category = ? ORDER BY id",
    );
    this.selectAll = db.prepare("SELECT * FROM roles ORDER BY category, id");
    this.assignStmt = db.prepare(
      "INSERT OR IGNORE INTO person_roles (person_id, role_id, assigned_at) VALUES (?,?,?)",
    );
    this.assignmentsStmt = db.prepare(
      `SELECT r.* FROM person_roles pr
       JOIN roles r ON r.id = pr.role_id
       WHERE pr.person_id = ? ORDER BY r.id`,
    );
    this.countStmt = db.prepare("SELECT COUNT(*) AS n FROM roles");
    this.deleteStmt = db.prepare(
      "DELETE FROM person_roles WHERE person_id = ? AND role_id = ?",
    );
  }

  register(def: RoleDefinition): RoleDefinition {
    const now = this.clock.now();
    this.insert.run(
      def.id,
      def.category,
      def.name,
      json(def),
      now,
    );
    return def;
  }

  registerMany(defs: RoleDefinition[]): number {
    let n = 0;
    for (const def of defs) {
      this.register(def);
      n += 1;
    }
    return n;
  }

  get(roleId: string): RoleDefinition | null {
    const row = this.selectById.get(roleId) as RoleRow | undefined;
    return row ? rowToDef(row) : null;
  }

  list(category?: RoleCategory): RoleDefinition[] {
    const rows = (
      category
        ? this.selectByCategory.all(category)
        : this.selectAll.all()
    ) as unknown as RoleRow[];
    return rows.map(rowToDef);
  }

  count(): number {
    return (this.countStmt.get() as { n: number }).n;
  }

  /** Assign a role to a person. Pure state change — zero inference. */
  assign(personId: string, roleId: string): void {
    this.assignStmt.run(personId, roleId, this.clock.now());
  }

  unassign(personId: string, roleId: string): void {
    this.deleteStmt.run(personId, roleId);
  }

  /** Roles currently active for a person. */
  assignments(personId: string): RoleDefinition[] {
    const rows = this.assignmentsStmt.all(personId) as unknown as RoleRow[];
    return rows.map(rowToDef);
  }
}