# Zod-Based State Management (LangGraph Style)

## Overview

The library now supports LangGraph-style state management using Zod schemas! This provides type-safe state definitions with reducer functions for complex state merging logic.

## Quick Start

```typescript
import { StateGraph, createRegistry, START, END, z } from 'chat-graph';

// 1. Create a registry for reducer configurations
const registry = createRegistry();

// 2. Define your state schema with Zod
const State = z.object({
  foo: z.string(),
  bar: z.array(z.string()).registerReducer(registry, {
    reducer: {
      fn: (x, y) => x.concat(y),
    },
    default: () => [] as string[],
  }),
});

// 3. Create a StateGraph with your schema
const workflow = new StateGraph(State, registry)
  .addNode('nodeA', (state) => {
    return { foo: 'a', bar: ['a'] };
  })
  .addNode('nodeB', (state) => {
    return { foo: 'b', bar: ['b'] };
  })
  .addEdge(START, 'nodeA')
  .addEdge('nodeA', 'nodeB')
  .addEdge('nodeB', END);

// 4. Compile and run
const graph = workflow.compile({ id: 'my-workflow' });
const result = await graph.invoke({ user_message: '' });

console.log(graph.state);
// {
//   foo: "b",
//   bar: ["a", "b"]  // Arrays concatenated via reducer!
// }
```

## Key Concepts

### StateRegistry

The `StateRegistry` is where you register reducer functions and default values for your state fields:

```typescript
const registry = createRegistry();
```

### Reducer Functions

Reducers define how field values are merged when multiple nodes update the same field:

```typescript
const State = z.object({
  messages: z.array(z.string()).registerReducer(registry, {
    reducer: {
      fn: (prevValue, newValue) => prevValue.concat(newValue),
    },
    default: () => [] as string[],
  }),
});
```

**How reducers work:**

- When a node returns `{ messages: ["new"] }`, the reducer is called with the previous value
- `fn(prevValue, newValue)` merges them together
- Without a reducer, the new value would replace the old value

### Default Values

You can specify default values for fields using Zod's `.default()` or via the registry:

```typescript
const State = z.object({
  // Using Zod's built-in default
  count: z.number().default(0),

  // Using registry default (required for fields with reducers)
  items: z.array(z.string()).registerReducer(registry, {
    default: () => [],
    reducer: {
      fn: (prev, next) => [...prev, ...next],
    },
  }),
});
```

### StateGraph Class

The `StateGraph` class provides a LangGraph-style API:

```typescript
const workflow = new StateGraph(schema, registry)
  .addNode(id, actionFunction)
  .addEdge(from, to)
  .compile(config);
```

**Node functions:**

- Receive the current state as a parameter (fully typed!)
- Return a partial state object with updates
- All type inference is automatic thanks to Zod

## Complete Example

```typescript
import { StateGraph, createRegistry, START, END, z } from 'chat-graph';

// Create registry
const registry = createRegistry();

// Define typed state
const ConversationState = z.object({
  userName: z.string().default(''),
  messageCount: z.number().default(0),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .registerReducer(registry, {
      reducer: {
        fn: (prev, next) => [...prev, ...next],
      },
      default: () => [],
    }),
});

// Build workflow
const workflow = new StateGraph(ConversationState, registry)
  .addNode('greet', (state) => {
    return {
      messages: [
        {
          role: 'assistant' as const,
          content: `Hello! I'm here to help.`,
        },
      ],
      messageCount: state.messageCount + 1,
    };
  })
  .addNode('respond', (state) => {
    return {
      messages: [
        {
          role: 'assistant' as const,
          content: `You have sent ${state.messageCount} messages.`,
        },
      ],
      messageCount: state.messageCount + 1,
    };
  })
  .addEdge(START, 'greet')
  .addEdge('greet', 'respond')
  .addEdge('respond', END);

// Compile and run
const graph = workflow.compile({
  id: 'conversation',
  initialState: {
    userName: 'Alice',
  },
});

const result = await graph.invoke({ user_message: '' });

console.log(graph.state);
// {
//   userName: 'Alice',
//   messageCount: 2,
//   messages: [
//     { role: 'assistant', content: "Hello! I'm here to help." },
//     { role: 'assistant', content: 'You have sent 2 messages.' }
//   ]
// }
```

## Type Safety

All state operations are fully type-safe:

```typescript
const State = z.object({
  count: z.number(),
  items: z.array(z.string()),
});

const workflow = new StateGraph(State, registry).addNode('example', (state) => {
  // ✅ TypeScript knows state is { count: number; items: string[] }
  const count = state.count; // number
  const items = state.items; // string[]

  return {
    count: count + 1,
    // ❌ TypeScript error: Type 'number' is not assignable to type 'string'
    // items: [123],

    // ✅ Correct
    items: ['new item'],
  };
});
```

## Persistence

StateGraph supports the same persistence features as ChatGraph:

```typescript
const graph = workflow.compile({
  id: 'my-workflow',
  flowId: 'user-123-session',
  storageAdapter: new MongoStorageAdapter(options),
  autoSave: true,
});

// State is automatically saved after each node execution
await graph.invoke({ user_message: '' });

// Restore from a previous snapshot
await graph.restoreFromSnapshot();
```

## Migration from Old Schema System

**Old way:**

```typescript
const schema = {
  name: String,
  messages: {
    type: Array,
    reducer: (prev, next) => [...prev, ...next],
  },
};
```

**New way (Zod):**

```typescript
const registry = createRegistry();

const State = z.object({
  name: z.string(),
  messages: z.array(z.any()).registerReducer(registry, {
    reducer: {
      fn: (prev, next) => [...prev, ...next],
    },
    default: () => [],
  }),
});
```

## API Reference

### `createRegistry()`

Creates a new StateRegistry instance for storing field configurations.

### `StateRegistry`

- `.registerField(schema, config)` - Register a field configuration
- `.getConfig(schema)` - Get configuration for a schema
- `.hasReducer(schema)` - Check if schema has a reducer
- `.getDefault(schema)` - Get default value for a schema

### `StateGraph<Schema>`

- `constructor(schema: Schema, registry?: StateRegistry)` - Create a new StateGraph
- `.addNode(id, action)` - Add a node with an action function
- `.addEdge(from, to)` - Add an edge between nodes
- `.compile(config)` - Compile into a ChatGraph instance

### Zod Extension

- `.registerReducer(registry, config)` - Register reducer and default for any Zod schema

## Benefits

✅ **Type Safety** - Full TypeScript inference from Zod schemas  
✅ **Runtime Validation** - Zod validates state structure  
✅ **Reducer Functions** - Complex state merging logic  
✅ **Default Values** - Automatic initialization  
✅ **LangGraph Compatible** - Familiar API for LangGraph users  
✅ **Composable** - Reuse Zod schemas across your application

## See Also

- [Zod Documentation](https://zod.dev)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [Full Example](../examples/zod-state-example.ts)
