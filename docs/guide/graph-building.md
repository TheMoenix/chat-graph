# Building Graphs

Two simple ways to define a graph: chaining builder API, or plain JSON-style config.

## Chaining (Builder)

```typescript
import { ChatGraphBuilder, START, END, z, registry } from 'chat-graph';

const State = z.object({
  messages: z
    .array(z.string())
    .registerReducer(registry, {
      default: () => [],
      reducer: { fn: (p, n) => [...p, ...n] },
    }),
});

const graph = new ChatGraphBuilder({ schema: State })
  .addNode({
    id: 'ask',
    action: { message: 'Your name?' },
    validate: { targetField: 'name' },
  })
  .addNode({
    id: 'reply',
    action: (s) => ({ messages: [`Hi, ${s.name}!`] }),
    noUserInput: true,
  })
  .addEdge(START, 'ask')
  .addEdge('ask', 'reply')
  .addEdge('reply', END)
  .compile({ id: 'builder-demo' });

await graph.invoke({ user_message: 'Alice' });
```

## JSON-Style (Config)

```typescript
import { ChatGraph, START, END, z, registry } from 'chat-graph';

const State = z.object({
  messages: z
    .array(z.string())
    .registerReducer(registry, {
      default: () => [],
      reducer: { fn: (p, n) => [...p, ...n] },
    }),
});

const graph = new ChatGraph({
  id: 'json-demo',
  schema: State,
  nodes: [
    {
      id: 'ask',
      action: { message: 'Your name?' },
      validate: { targetField: 'name' },
    },
    {
      id: 'reply',
      action: (s) => ({ messages: [`Hi, ${s.name}!`] }),
      noUserInput: true,
    },
  ],
  edges: [
    { from: START, to: 'ask' },
    { from: 'ask', to: 'reply' },
    { from: 'reply', to: END },
  ],
});

await graph.invoke({ user_message: 'Alice' });
```

## Conditional Routing

```typescript
// Edge targets can be functions returning the next node id
.addEdge('pick', (state) => (state.count > 0 ? 'A' : 'B'))
```

See the sub-guides for details:

- Action: how nodes produce state updates
- Validate: simple rules or functions
- Edge: connect nodes or use functions for branching
