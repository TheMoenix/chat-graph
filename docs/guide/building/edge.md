# Edge

Connect nodes in sequence or branch conditionally.
Use `START` and `END` for graph boundaries.

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
.addEdge('choose', (state) => (state.isAdmin ? 'admin_node' : 'user_node'))
```

## JSON-based Routing

Define conditional routing using JSON configuration for fully serializable graphs

- conditions:
  - field: state field to check
  - operator: comparison operator (see below)
  - value: value to compare against
  - goto: target node id if condition matches
- default: target node id if all conditions fail

```typescript
// JSON-based conditional routing
.addEdge('ask_age', {
  conditions: [
    { field: 'age', operator: 'lt', value: 18, goto: 'minor_node' },
    { field: 'age', operator: 'gte', value: 65, goto: 'senior_node' },
  ],
  default: 'adult_node'
})
```

### Available Operators

- **Equality**: `equals`, `not_equals`
- **Comparison**: `gt` (>), `gte` (≥), `lt` (<), `lte` (≤)
- **String/Array**: `contains`, `not_contains`
- **Regular Expression**: `regex`
- **Membership**: `in`, `not_in`

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
