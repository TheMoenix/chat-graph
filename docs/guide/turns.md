# Turns

A **turn** is one call to `graph.invoke(event)`. Understanding the turn boundary is the key
to driving a graph from a real channel — a web chat, WhatsApp, a support widget.

One turn may execute several nodes, because `autoAdvance` nodes chain without waiting for
input. It ends when the graph reaches a node that waits for the user, or reaches `END`.

## What a turn produced

Read `emittedMessages` to get exactly the messages this turn produced, in order:

```typescript
await graph.invoke({ userMessage: 'Ali' });

for (const message of graph.emittedMessages) {
  await channel.send(message); // send only what this turn produced
}
```

`emittedMessages` is cleared at the start of every `invoke()` and is never persisted, so a
restored snapshot starts empty and a replayed turn does not re-send old text.

::: tip Use `emittedMessages`, not `state.messages`
`state.messages` is the conversation's accumulated history, shaped by whatever reducer you
registered. It cannot answer "what should I send now":

- Concatenate (`(prev, next) => [...prev, ...next]`) and it grows forever, so you would
  re-send the whole conversation every turn.
- Replace (`(prev, next) => next`) and a turn that crosses `autoAdvance` nodes keeps only
  the last node's output, silently dropping the rest.

No reducer can be correct, because a reducer cannot tell "first node of a new turn" from
"second node of the same turn". `emittedMessages` is tracked by the engine outside the
merge, so it is right under either configuration.
:::

```typescript
// A turn crossing two autoAdvance nodes
await graph.invoke({ userMessage: 'Ali' });

graph.emittedMessages;
// ['Thanks Ali.', 'Second line, same turn.', 'Your city?']  ← send these

graph.state.messages;
// depends entirely on your reducer — history, not output
```

## Events

`invoke()` takes a `ChatEvent`:

```typescript
type ChatEvent = {
  userMessage: string;
  payload?: Record<string, unknown>;
};
```

### `payload`

Real channels deliver more than text. A tapped button carries a stable developer-defined id
alongside its human-readable label; a list selection carries a row id; a shared location
carries coordinates. Put that in `payload`:

```typescript
await graph.invoke({
  userMessage: 'Billing', // what the user saw
  payload: { buttonId: 'billing' }, // what your code should branch on
});
```

The engine never reads `payload` — it passes it through untouched to node actions,
validators and router functions:

```typescript
.addNode({
  id: 'menu',
  action: { message: 'What do you need?' },
  validate: (state, event) => ({
    isValid: true,
    state: { choice: String(event.payload?.buttonId ?? '') },
  }),
})
.addEdge('menu', (state) => (state.choice === 'billing' ? 'billing' : 'support'))
```

Branching on `buttonId` instead of the label keeps routing stable when the label is
reworded or translated.

Like `emittedMessages`, `payload` belongs to a single turn and is **not** persisted. A
validator that needs a payload value later must write it into state — which is what
validators are for.

## Cycles and the per-turn bound

Cycles are supported and useful. A flow can park on a node and repeat itself until
something external changes:

```
IN "hi"           -> ["Connecting you...", "Someone will be with you shortly."]
IN "any update?"  -> ["Someone will be with you shortly."]
IN "hello?"       -> ["Someone will be with you shortly."]
```

That works because the node **waits** for input, ending the turn each time.

A cycle in which every node is `autoAdvance` never waits, so it would run until the process
runs out of memory. The engine bounds the number of nodes one turn may execute and throws
instead:

```typescript
import { TurnLimitExceededError } from 'chat-graph';

try {
  await graph.invoke({ userMessage: 'hi' });
} catch (error) {
  if (error instanceof TurnLimitExceededError) {
    console.error(error.path); // ['a', 'b', 'a', 'b', ...] — names the cycle
  }
}
```

The bound defaults to **50** and resets every turn, so a waiting cycle runs indefinitely.
Raise it only if you have a genuinely long `autoAdvance` chain:

```typescript
.compile({ id: 'onboarding', maxNodesPerTurn: 100 })
```

`TurnLimitExceededError` carries `flowId`, `limit`, and `path` — the node ids executed
during the failed turn.
