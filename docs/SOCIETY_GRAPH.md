# Society Graph: People, Circles, Relationships

The social graph is the **durable connective tissue** of the society. It persists across restarts, survives model changes, and gates every interaction.

---

## Person Nodes

Each person is a node with:
- Stable `id` (UUID)
- Display `name`
- Biography, identity, personality, interests
- Current state (mood, availability, social intensity)
- Assigned roles (array of role IDs)
- Circle memberships (via `circle_members` table)

**Queries:**
```typescript
kernel.persons.list(limit, offset) → PersonState[]
kernel.persons.get(id) → PersonState | null
kernel.persons.count() → number
```

---

## Circle Communities

Circles are **named groups** with ordered membership.

**Structure:**
```typescript
{
  id: "circle_...",
  name: "Inner Circle",
  kind: "inner",              // inner | family | interest | neighborhood | ...
  memberPersonIds: [p1, p2, p3, p4, p5],  // order matters for selection
  metadata: {}
}
```

**Queries:**
```typescript
kernel.circles.list() → Circle[]
kernel.circles.get(id) → Circle | null
kernel.circles.memberPersonIds(circleId) → string[]
kernel.circles.join(circleId, personId) → void
kernel.circles.leave(circleId, personId) → void
```

**Circle kinds:**
- `inner` — closest bonds, high selection priority
- `family` — kinship bonds
- `interest` — shared hobby (gaming, music, hiking)
- `neighborhood` — geographic proximity
- `work` — professional context

---

## Relationship Edges

Relationships are **bidirectional, dimensioned, private-by-default** edges between two persons.

**Dimensions (0.0–1.0):**
| Dim | Meaning |
|-----|---------|
| familiarity | How well they know each other |
| trust | Reliability expectation |
| affection | Warmth/liking |
| attraction | Romantic/physical pull |
| respect | Admiration for competence/character |
| comfort | Ease of being together |
| shared_history | Landmark count (derived) |

**Status Ladder (mutually exclusive):**
```
stranger (0) → acquaintance (1) → friend (2) → close_friend (3)
    → best_friend (4) → romantic_interest (5) → partner (6) → spouse (7)
```

**Inertia:** `relationshipLearningRate = 0.15` — a single scene moves dimensions by at most 15% of the proposed delta. One interaction ≠ spouse.

**Queries:**
```typescript
kernel.relationship.relationshipsFor(personId) → Relationship[]
kernel.relationship.getSummary(personId, otherId) → RelationshipSummary | null
kernel.relationship.relate(a, b, dimsDelta) → void  // applies with inertia
```

---

## Privacy Scopes

Knowledge does **not** flow freely. Every memory and relationship has a scope:

| Scope | Who Can Read |
|-------|--------------|
| `private` | The person only |
| `person_user_shared` | The person + the user (operator) |
| `circle` | Members of the specified circle |
| `public` | Anyone in the society |

**Scene context compilation** respects scopes: only memories/relationships visible to the *viewer* (the person being materialized) enter their Actor context.

---

## SocialGraph (Unified Reads)

`SocialGraph` provides cross-domain reads for selection and context:

```typescript
// Reachability
graph.knows(a, b) → boolean
graph.shortestPath(a, b) → string[] | null

// Circle overlap
graph.sharedCircles(a, b) → Circle[]

// Selection support
graph.circleMembersWithRoles(circleId) → { personId, roleIds }[]
graph.strongestTies(personId, limit) → { otherId, score }[]
```

---

## Seeded Society (Demo)

Running `pnpm society start` seeds:

| Persons | Roles | Circles | Relationships | Landmarks |
|---------|-------|---------|---------------|-----------|
| 5 | 29 | 11 | 10 unique pairs | 5 (10 rows) |

**Persons:**
- **Emma Reyes** — anchor, close/best-friend potential
- **Julian Park** — romantic/partner-capable
- **Priya Nair** — intellectual friend
- **Leo Magnusson** — adventure/travel friend
- **Sam Okafor** — wildcard social personality

**Circles:**
- Inner Circle (all 5)
- Family (Emma, Julian)
- Travel Crew (Leo, Sam, Priya)
- Adventure Crew (Leo, Emma)
- Night-Out Crew (Sam, Julian)
- Intellectual Circle (Priya, Emma)
- Startup Friends (Julian, Priya)
- Gym Crew (Emma, Sam)
- Music Friends (Leo, Julian)
- Gaming Friends (Sam, Priya)
- Neighborhood Circle (Emma, Leo)

---

## Graph Invariants

| Invariant | Enforced By |
|-----------|-------------|
| No self-relationships | `RelationshipService.relate` validates `a !== b` |
| Bidirectional symmetry | Single row stores both directions; `dims` shared |
| Status monotonicity | Status only advances (stranger → acquaintance → …) |
| Landmark pair dedupe | `MemoryService.landmarksFor(a, b)` stores once per pair |
| Circle membership sync | `CircleService.join/leave` updates `circle_members` + `SocialGraph` cache |
| Role assignment persistence | `person_roles` table survives restarts |

---

## Selection Uses the Graph

`ParticipantSelector` scores candidates using:

```
score = base_relevance
      + circle_membership_boost
      + relationship_closeness (familiarity + trust + affection)
      - recent_speaker_penalty
      + intensity_boost (user's socialIntensity)
      - do_not_disturb_hard_exclude
```

**Hard cap:** `hardMaxSpeakers = 3` — never more than 3 speakers in a scene, regardless of circle size.

---

## CLI Inspection

```bash
pnpm society people                    # list all persons
pnpm society person Emma               # identity card + relationships + landmarks + timeline
pnpm society circles                   # all circles with members
pnpm society circles | grep Inner      # find Inner Circle ID
pnpm society chat "Hi" --circle <id>   # talk to a specific circle
```