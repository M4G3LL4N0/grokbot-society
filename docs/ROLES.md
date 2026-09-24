# Composable Role Architecture

Roles are the **reusable behavior layer** between Persons and Actors. They enable a single Person to act differently in different contexts without creating separate agents.

---

## Role Definition

```typescript
interface RoleDefinition {
  id: string;                    // stable key: "friend", "mentor", "wildcard"
  category: RoleCategory;        // relationship | social | intellectual | creative | activity | wildcard
  name: string;                  // display name
  tendencies: string[];          // behavioral dispositions
  capabilities: string[];        // what this role enables
  relationshipExpectations: string[];
  contextRequirements: string[]; // when this role is relevant
  constraints: string[];         // what this role forbids
  permissions: string[];         // special permissions (rare)
}
```

---

## Seeded Roles (29)

| Category | Roles |
|----------|-------|
| **relationship** | stranger, acquaintance, friend, close_friend, best_friend, romantic_interest, partner, spouse, sibling, parent_like, cousin |
| **social** | mentor, travel_companion, road_trip_friend, gym_friend, hiking_friend, nightlife_friend, food_friend, music_friend, gaming_friend |
| **intellectual** | intellectual_friend, debate_friend, creative_friend, founder_friend, storyteller, listener, comic_relief |
| **activity** | social_connector |
| **wildcard** | wildcard |

---

## Assignment vs. Instantiation

```typescript
// Assigning a role — ZERO inference, pure config
kernel.assignRole(personId, "friend");
kernel.assignRole(personId, "travel_companion");

// At scene time, the Actor composes ONLY assigned roles relevant to the scene
const actor = kernel.composeActorContext(personId, eventId, participantIds, circleId);
// actor.roles = [friend, travel_companion] (filtered by contextRequirements)
```

**Invariant:** `assignRole` never creates an agent, never calls a model.

---

## Role Composition in Scenes

When a scene is directed:

1. **Selector** scores participants (intensity, circle, relationship, recency)
2. **Compiler** builds per-person context:
   - BASELINE (identity card)
   - ROLE sections (only assigned + context-relevant roles)
   - RELATIONSHIP sections (only with other participants)
   - MEMORY sections (scoped by privacy)
3. **Actor** materializes with composed roles for this scene only

**Result:** The same Person in "Inner Circle" gets `[friend, close_friend, storyteller]` but in "Travel Crew" gets `[friend, travel_companion, road_trip_friend]`. Zero inference at composition time.

---

## Role Categories Explained

### Relationship Roles
Progress along the status ladder. Mutually exclusive per pair (you can't be both `stranger` and `spouse` to the same person).

### Social Roles
Context-dependent. A person can be `gym_friend` AND `food_friend` simultaneously.

### Intellectual Roles
Activate in topic-relevant scenes. `debate_friend` only appears when the actor message suggests debate.

### Wildcard Role
`wildcard` — matches any context, always included if assigned. Use for "always-on" personality traits.

---

## Adding Custom Roles

```typescript
const customRole: RoleDefinition = {
  id: "photography_buddy",
  category: "activity",
  name: "Photography Buddy",
  tendencies: ["observant", "patient", "encouraging"],
  capabilities: ["photo walks", "gear talk", "critique"],
  relationshipExpectations: ["shared interest"],
  contextRequirements: ["photography topic", "outdoor setting"],
  constraints: ["no unsolicited advice"],
  permissions: []
};

// Register at runtime
kernel.roles.register(customRole);

// Assign
kernel.assignRole(personId, "photography_buddy");
```

Roles are pure data — they can be added, modified, or removed without touching any model.

---

## Role → Capability Mapping (Future)

In v0.2+, roles may map to **capability classes** for routing:

```typescript
// Example future mapping
roleCapabilities = {
  "founder_friend": "social.standard",
  "intellectual_friend": "social.nano",
  "wildcard": "social.mock"
}
```

This would allow a "founder friend" scene to route to a higher-tier model while keeping identity canonical.

---

## Anti-Patterns to Avoid

| ❌ Don't | ✅ Do |
|----------|-------|
| Create a new role for every person | Reuse the 29 seeded roles; extend only when needed |
| Treat roles as agents | Roles are data; Actors are the ephemeral runtime objects |
| Assign roles at scene time | Assign roles durably; scene context filters relevance |
| Put model config in roles | Roles are provider-neutral; routing is separate |