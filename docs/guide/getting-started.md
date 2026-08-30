# Getting Started

## Installation

```bash
npm install chat-graph
```

## Basic Usage (builder + Zod)

```typescript
import { ChatGraphBuilder, START, END, z, registry } from 'chat-graph';

// Define typed state
const State = z.object({
  name: z.string().default(''),
  messages: z.array(z.string()).registerReducer(registry, {
    reducer: { fn: (prev, next) => [...prev, ...next] },
    default: () => [],
  }),
});

// Build and compile
const graph = new ChatGraphBuilder({ schema: State })
  .addNode({
    id: 'greet',
    action: { message: "Hi! What's your name?" },
    validate: {
      answerKey: 'name',
      rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name' }],
    },
  })
  .addNode({
    id: 'done',
    autoAdvance: true,
    action: { message: 'Nice to meet you, {{name}}!' },
  })
  .addEdge(START, 'greet')
  .addEdge('greet', 'done')
  .addEdge('done', END)
  .compile({ id: 'onboarding' });
```

## Driving the conversation

Each call to `invoke()` is one **turn**. Send whatever `emittedMessages` returns — those are
the messages that turn produced:

```typescript
await graph.invoke({ userMessage: 'hello' });
graph.emittedMessages; // ["Hi! What's your name?"]

await graph.invoke({ userMessage: 'John' });
graph.emittedMessages; // ['Nice to meet you, John!']

graph.isDone; // true
```

::: warning Send `emittedMessages`, not `state.messages`
`state.messages` is the accumulated history and depends on your reducer. `emittedMessages`
is what this turn produced, which is what you send to the user. See [Turns](./turns).
:::

## Next steps

- [Turns](./turns) — the turn boundary, event payloads, and cycle safety
- [The Graph](./graph) — builder and JSON-style construction
- [State Management](./state-management) — schemas, reducers, defaults
- [Storage & Persistence](./storage-persistence) — snapshots and stateless hosts
