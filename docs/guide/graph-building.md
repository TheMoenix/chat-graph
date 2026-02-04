# Building Graphs

Two simple ways to define a graph: chaining builder API, or plain JSON-style config.

## Chaining (Builder)

```typescript
import { ChatGraphBuilder, START, END, z, registry } from 'chat-graph';

const State = z.object({
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

await graph.invoke({ user_message: 'Alice' });
```

## JSON-Style (Config)

```typescript
import { ChatGraph, START, END, z, registry } from 'chat-graph';

const State = z.object({
  messages: z.array(z.string()).registerReducer(registry, {
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

await graph.invoke({ user_message: 'Alice' });
```
