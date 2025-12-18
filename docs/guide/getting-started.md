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
      targetField: 'name',
      rules: { regex: '\\w+', errorMessage: 'Please enter a valid name' },
    },
  })
  .addNode({
    id: 'done',
    noUserInput: true,
    action: { message: `Nice to meet you, {{name}}!` },
  })
  .addEdge(START, 'greet')
  .addEdge('greet', 'done')
  .addEdge('done', END)
  .compile({ id: 'onboarding' });

await graph.invoke({ user_message: 'John' });
console.log(graph.state.messages);
```
