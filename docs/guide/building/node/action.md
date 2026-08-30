# Action

The first part of a node that runs. It produces state updates based on user input or other logic.

An action that returns `messages` adds to the conversation. What you send to the user is
`graph.emittedMessages` — the messages produced by the current turn — not `state.messages`,
which is the accumulated history and depends on your reducer. See [Turns](../../turns).

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

// Actions receive the event too, including any structured payload
{ id: 'echo', action: (s, e) => ({ messages: [`You picked ${e.payload?.buttonId}`] }) }
```

Static messages interpolate state with `{{key}}`:

```typescript
{ id: 'greet', action: { message: 'Hi, {{name}}!' } }
```

## No User Input Is Expected

Set `autoAdvance: true` to skip the validation phase and continue automatically to the next node.
