# Edge

Connect nodes in sequence or branch conditionally.

## Basics

- From: a node id or `START`
- To: a node id, `END`, or a function `(state) => nextId`

## Examples

```typescript
// Linear flow
.addEdge(START, 'ask')
.addEdge('ask', 'reply')
.addEdge('reply', END)

// Conditional
.addEdge('choose', (s) => (s.isAdmin ? 'admin' : 'user'))
```

Use `START` and `END` for graph boundaries.
