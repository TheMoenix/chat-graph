# The Graph

Two simple ways to define a graph: chaining builder API, or plain JSON-style config.

## Chaining (Builder)

```typescript
import { ChatGraphBuilder, START, END, z, registry } from 'chat-graph';

const State = z.object({
  name: z.string().default(''),
  messages: z.array(z.string()).registerReducer(registry, {
    default: () => [],
    reducer: { fn: (p, n) => [...p, ...n] },
  }),
});

const graph = new ChatGraphBuilder({ schema: State })
  .addNode({
    id: 'ask',
    action: { message: 'Your name?' },
    validate: { answerKey: 'name' },
  })
  .addNode({
    id: 'reply',
    action: { message: 'Hi, {{name}}!' },
    autoAdvance: true,
  })
  .addEdge(START, 'ask')
  .addEdge('ask', 'reply')
  .addEdge('reply', END)
  .compile({ id: 'builder-demo' });

await graph.invoke({ userMessage: 'Alice' });
graph.emittedMessages; // messages this turn produced
```

## JSON-Style (Config)

`ChatGraph` takes the same nodes and edges directly, which is what you want when the graph
is stored as data and rebuilt on each turn.

::: warning Pass `registry` too
`ChatGraphBuilder` supplies the registry for you. When constructing `ChatGraph` directly you
must pass it alongside `schema` — without it your reducers are silently ignored and state
falls back to array concatenation with a shallow merge.
:::

```typescript
import { ChatGraph, START, END, z, registry } from 'chat-graph';

const State = z.object({
  name: z.string().default(''),
  messages: z.array(z.string()).registerReducer(registry, {
    default: () => [],
    reducer: { fn: (p, n) => [...p, ...n] },
  }),
});

const graph = new ChatGraph({
  id: 'json-demo',
  schema: State,
  registry, // required here — the builder does this for you
  nodes: [
    {
      id: 'ask',
      action: { message: 'Your name?' },
      validate: { answerKey: 'name' },
    },
    {
      id: 'reply',
      action: { message: 'Hi, {{name}}!' },
      autoAdvance: true,
    },
  ],
  edges: [
    { from: START, to: 'ask' },
    { from: 'ask', to: 'reply' },
    { from: 'reply', to: END },
  ],
});

await graph.invoke({ userMessage: 'Alice' });
```

## Compile Options

`compile()` (and the `ChatGraph` constructor) accept:

| Option            | Default         | Purpose                                                    |
| ----------------- | --------------- | ---------------------------------------------------------- |
| `id`              | —               | Flow identifier; the key snapshots are stored under        |
| `storageAdapter`  | none            | Enables persistence — see [Storage](./storage-persistence) |
| `autoSave`        | `true`          | Save a snapshot after each phase (needs `storageAdapter`)  |
| `initialState`    | schema defaults | Seed state for a new conversation                          |
| `maxNodesPerTurn` | `50`            | Bound on nodes per turn — see [Turns](./turns)             |
