# chat-graph

A code-first chat flow engine to handle chatbot conversations using a graph structure with action and validation phases.

## Installation

```bash
npm install chat-graph
```

## Quick Start

```typescript
import { createGraph } from 'chat-graph';
import { START, END } from 'chat-graph';

const graph = createGraph()
  .addNode({
    id: 'greet',
    action: { message: "Hi! What's your name?" },
    validate: {
      rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name' }],
      targetField: 'name',
    },
  })
  .addNode({
    id: 'farewell',
    action: (state) => ({
      messages: [`Nice to meet you, ${state.name}!`],
    }),
  })
  .addEdge(START, 'greet')
  .addEdge('greet', 'farewell')
  .addEdge('farewell', END)
  .build();

// Execute the flow
const state = { __currentNodeId: START, __flowId: 'onboarding' };
const event = { user_message: 'John' };

const result = await graph.invoke(state, event);
console.log(result.messages); // ["Nice to meet you, John!"]
```

## Documentation

For full documentation, visit [https://themoenix.github.io/chat-graph/](https://themoenix.github.io/chat-graph/).

## License

MIT © TheMoenix
