# Getting Started

## Installation

```bash
npm install chat-graph
```

## Basic Usage

```typescript
import { createGraph, START, END } from 'chat-graph';

const graph = createGraph()
  .addNode({
    id: 'greet',
    action: { message: "Hi! What's your name?" },
    validate: {
      rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name' }],
      targetField: 'name',
    },
  })
  .addEdge(START, 'greet')
  .addEdge('greet', END)
  .build();
```
