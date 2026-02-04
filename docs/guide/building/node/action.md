# Action

The first part of a node that runs. It produces state updates based on user input or other logic.
The resulting state must have `messages` which is what should be sent to the user.

## Two Forms

- Object: `{ message: string }` — no computation needed, just a static message.
- Function: `(state, event) => PartialState` — compute updates based on current state and event data.

## Examples

```typescript
// Object action (simple message)
{ id: 'ask', action: { message: 'Your name?' } }

// Function action (computed update)
{ id: 'reply', action: (s) => ({ messages: [`Hi, ${s.name}!`] }) }

// You can also update other state fields
{ id: 'inc', action: (s) => ({ count: (s.count ?? 0) + 1 }) }
```

## No User Input Is Expected

Set `autoAdvance: true` to skip the validation phase and continue automatically to the next node.
