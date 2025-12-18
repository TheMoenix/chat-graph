# Edge

Connect nodes in sequence or branch conditionally.

## Basics

- **From**: a node id or `START`
- **To**: a node id, `END`, a function `(state) => nextId`, or a JSON-based router object

## Simple Edges

```typescript
// Linear flow
.addEdge(START, 'ask')
.addEdge('ask', 'reply')
.addEdge('reply', END)
```

## Function-based Routing

Use a function to determine the next node based on state:

```typescript
// Conditional routing with function
.addEdge('choose', (state) => (state.isAdmin ? 'admin' : 'user'))
```

## JSON-based Routing

Define conditional routing using JSON configuration for fully serializable graphs:

```typescript
// JSON-based conditional routing
.addEdge('ask_age', {
  conditions: [
    { field: 'age', operator: 'lt', value: 18, goto: 'minor' },
    { field: 'age', operator: 'gte', value: 65, goto: 'senior' },
  ],
  default: 'adult'
})
```

### Available Operators

- **Equality**: `equals`, `not_equals`
- **Comparison**: `gt` (>), `gte` (≥), `lt` (<), `lte` (≤)
- **String/Array**: `contains`, `not_contains`
- **Regular Expression**: `regex`
- **Membership**: `in`, `not_in`

### Type Safety

Both `field` and `goto` are type-safe:

- `field` must be a valid key in your schema
- `goto` must be a valid node ID or `END`

### Examples

**Numeric comparison:**

```typescript
{
  conditions: [
    { field: 'score', operator: 'gte', value: 90, goto: 'excellent' },
    { field: 'score', operator: 'gte', value: 70, goto: 'good' },
    { field: 'score', operator: 'gte', value: 50, goto: 'fair' },
  ],
  default: 'poor'
}
```

**String matching:**

```typescript
{
  conditions: [
    { field: 'message', operator: 'contains', value: 'hello', goto: 'greeting' },
    { field: 'message', operator: 'regex', value: '^help', goto: 'help' },
  ],
  default: 'other'
}
```

**Membership check:**

```typescript
{
  conditions: [
    { field: 'color', operator: 'in', value: ['red', 'blue', 'yellow'], goto: 'primary' },
  ],
  default: 'not_primary'
}
```

### Condition Evaluation

Conditions are evaluated in order, and the first matching condition determines the route. If no conditions match, the `default` route is used.

## Benefits of JSON Routing

- **Database Storage**: Store complete graph definitions in databases
- **Dynamic Graphs**: Load and modify graphs at runtime
- **No Code Deployment**: Update routing logic without redeploying code
- **Version Control**: Track routing changes in JSON format
- **Visual Editors**: Build graph UIs with JSON configuration

Use `START` and `END` for graph boundaries.
