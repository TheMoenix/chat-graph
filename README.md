# chat-graph

A code-first chat flow engine with a graph-based builder, Zod-based state schemas with reducers, and pluggable persistence (Memory, MongoDB).

## Installation

```bash
npm install chat-graph
```

## Quick Start

```typescript
import { ChatGraphBuilder, START, END, z, registry } from 'chat-graph';

// 1) Define typed state with Zod (reducers optional)
const State = z.object({
  name: z.string().default(''),
  messages: z.array(z.string()).registerReducer(registry, {
    reducer: { fn: (prev, next) => [...prev, ...next] },
    default: () => [],
  }),
});

// 2) Build the chat graph
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
    id: 'farewell',
    autoAdvance: true,
    action: (state) => ({ messages: [`Nice to meet you, ${state.name}!`] }),
  })
  .addEdge(START, 'greet')
  .addEdge('greet', 'farewell')
  .addEdge('farewell', END)
  .compile({ id: 'onboarding' });

// 3) Run — one invoke() is one turn
await graph.invoke({ userMessage: 'John' });
console.log(graph.emittedMessages); // ["Nice to meet you, John!"]
```

Send `emittedMessages` to the user: it holds exactly what the current turn produced.
`state.messages` is the accumulated history and depends on your reducer.

## Persistence (optional)

```typescript
import { MemoryStorageAdapter } from 'chat-graph';

const storage = new MemoryStorageAdapter();
const graph = new ChatGraphBuilder({ schema: State })
  // ...nodes/edges...
  .compile({ id: 'onboarding', storageAdapter: storage, autoSave: true });

await graph.invoke({ userMessage: 'Alice' });
// state is saved on each step; you can restore later
await graph.restoreFromSnapshot();
```

MongoDB adapter is available via optional peer dependency:

```bash
npm install mongodb
```

```typescript
import { MongoStorageAdapter } from 'chat-graph';

const mongo = new MongoStorageAdapter({
  uri: 'mongodb://localhost:27017',
  database: 'chat_graph',
  collection: 'snapshots',
});
await mongo.connect();

const graph = new ChatGraphBuilder({ schema: State })
  // ...nodes/edges...
  .compile({ id: 'onboarding', storageAdapter: mongo });
```

## Features

- **Two-phase nodes** — an action phase and a validation phase, so a node can ask and then
  check the answer
- **Typed state** — Zod schemas with optional per-field reducers
- **Serializable graphs** — build with the chaining API or plain JSON config
- **Per-turn output** — `emittedMessages` tells you what to send, every turn
- **Structured input** — `ChatEvent.payload` carries button ids, selections, coordinates
- **Stateless-host ready** — versioned snapshots with typed `VersionConflictError` on
  concurrent writes, and a per-turn bound that stops runaway `autoAdvance` cycles

## Documentation

For full documentation, visit [https://themoenix.github.io/chat-graph/](https://themoenix.github.io/chat-graph/).

## License

MIT © TheMoenix

## Acknowledgements

This project is inspired by LangGraph. The concepts and public interface draw inspiration from their work. This library is independent and can be used without LangChain or LangGraph.
