# Action

Define how a node updates state.

## Two Forms

- Object: `{ message: string }` — adds a message to state (uses reducer to merge).
- Function: `(state, event) => PartialState` — return any field updates.

## Examples

```typescript
// Object action (simple message)
{ id: 'ask', action: { message: 'Your name?' } }

// Function action (computed update)
{ id: 'reply', action: (s) => ({ messages: [`Hi, ${s.name}!`] }), noUserInput: true }

// Any field is allowed at runtime; Zod gives types for DX
{ id: 'inc', action: (s) => ({ count: (s.count ?? 0) + 1 }) }
```

## No User Input

Set `noUserInput: true` to skip the validation phase and continue automatically.
