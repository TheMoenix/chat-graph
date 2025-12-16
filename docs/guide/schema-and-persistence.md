# Schema-Based State Management & Persistence

This guide covers the new schema-based state management system with type safety and persistence features.

## Features

✅ **Strongly-typed state** with TypeScript inference  
✅ **Schema with reducers** (like LangGraph but simpler)  
✅ **Automatic state persistence** with versioning  
✅ **Flow resumption** across instance recreation  
✅ **Pluggable storage adapters** (Memory, MongoDB, custom)  
✅ **Type-safe at compile-time**, flexible at runtime

## Quick Start

### 1. Define a State Schema

```typescript
import { StateSchema } from 'chat-graph';

const MySchema = {
  // Simple fields
  name: String,
  age: Number,
  isActive: Boolean,

  // Fields with reducers (for advanced state merging)
  messages: {
    type: Array,
    reducer: (prev: string[], next: string[]) => [...prev, ...next],
    default: [], // Optional default value
  },

  count: {
    type: Number,
    reducer: (prev: number, next: number) => prev + next,
    default: 0,
  },
} as const satisfies StateSchema;
```

### 2. TypeScript Infers the State Type

```typescript
import { InferState } from 'chat-graph';

type MyState = InferState<typeof MySchema>;
// Result: {
//   name: string;
//   age: number;
//   isActive: boolean;
//   messages: string[];
//   count: number;
// }
```

### 3. Create a Graph with the Schema

```typescript
import { createGraph, START, END } from 'chat-graph';

const flow = createGraph<typeof MySchema>()
  .addNode({
    id: 'greet',
    action: { message: 'What is your name?' },
    validate: { targetField: 'name' },
  })
  .addNode({
    id: 'farewell',
    // TypeScript provides autocomplete for state fields!
    action: (state: MyState) => ({
      messages: [`Goodbye, ${state.name}!`],
    }),
    noUserInput: true,
  })
  .addEdge(START, 'greet')
  .addEdge('greet', 'farewell')
  .addEdge('farewell', END)
  .build({
    id: 'my-flow',
    schema: MySchema, // Attach the schema
  });
```

## Type Safety Benefits

### ✅ Compile-Time Errors for Invalid State

```typescript
.addNode({
  action: (state) => ({
    messages: ['Hello'],
    state: {
      name: 'Alice', // ✓ OK
      age: 25,       // ✓ OK

      // ✗ TypeScript ERROR: 'invalidField' not in schema
      invalidField: 'value',

      // ✗ TypeScript ERROR: age should be number, not string
      age: '25'
    }
  })
})
```

### ✅ Autocomplete for State Fields

Your IDE will provide autocomplete when accessing state:

- `state.name` ✓
- `state.age` ✓
- `state.messages` ✓

### ✅ Runtime is Flexible (No Forced Validation)

**Important:** Schema is for **developer experience** only. If a developer bypasses TypeScript (using `any`, etc.), the runtime will continue without errors. No runtime validation is enforced.

```typescript
// This will compile with warnings but won't crash at runtime
const badState = { unknownField: 'value' } as any;
```

## State Reducers

Reducers allow sophisticated state merging logic:

```typescript
const schema = {
  messages: {
    type: Array,
    reducer: (prev: string[], next: string[]) => [...prev, ...next],
  },
} as const satisfies StateSchema;

// When nodes return state updates:
// Current: { messages: ['Hello'] }
// Update:  { messages: ['World'] }
// Result:  { messages: ['Hello', 'World'] } ← Concatenated!
```

Common reducer patterns:

```typescript
// Array concatenation
messages: {
  type: Array,
  reducer: (prev, next) => [...(prev || []), ...next],
  default: []
}

// Numeric accumulation
count: {
  type: Number,
  reducer: (prev, next) => (prev || 0) + next,
  default: 0
}

// Object merging
metadata: {
  type: Object,
  reducer: (prev, next) => ({ ...prev, ...next }),
  default: {}
}

// Custom logic
status: {
  type: String,
  reducer: (prev, next) => {
    // Only allow certain transitions
    if (prev === 'pending' && next === 'approved') return next;
    return prev;
  }
}
```

## State Persistence

### Basic Persistence (In-Memory)

```typescript
import { MemoryStorageAdapter } from 'chat-graph';

const storage = new MemoryStorageAdapter();

const flow = createGraph()
  .addNode(...)
  .build({
    id: 'my-flow',
    flowId: 'session-123',           // Unique ID for this flow instance
    storageAdapter: storage,          // Storage backend
  });

// State is automatically saved after each step
await flow.invoke({ user_message: 'Alice' });
// ✓ State saved to storage
```

### Resume Flow After Recreation

```typescript
// First session
const flow1 = createGraph()
  .addNode(...)
  .build({
    id: 'my-flow',
    flowId: 'user-456',
    storageAdapter: storage,
  });

await flow1.invoke({ user_message: 'Alice' });
await flow1.invoke({ user_message: '25' });

// ... flow1 is destroyed (server restart, browser close, etc.) ...

// Later: Create new instance with SAME flowId
const flow2 = createGraph()
  .addNode(...)
  .build({
    id: 'my-flow',
    flowId: 'user-456', // SAME flowId!
    storageAdapter: storage,
  });

// flow2 automatically restores state and tracker!
console.log(flow2.state); // { name: 'Alice', age: 25 }

// Continue from where we left off
await flow2.invoke({ user_message: 'Continue...' });
```

### State Versioning & History

Every state update creates a new version:

```typescript
const history = await storage.loadHistory('session-123');
console.log(`Flow has ${history.length} versions`);

history.forEach((snapshot) => {
  console.log(`Version ${snapshot.version}:`, snapshot.state);
});

// Load specific version
const v1 = await storage.loadSnapshot('session-123', 1);
const v2 = await storage.loadSnapshot('session-123', 2);
```

### MongoDB Persistence

```bash
npm install mongodb
```

```typescript
import { MongoStorageAdapter } from 'chat-graph';

const storage = new MongoStorageAdapter({
  uri: 'mongodb://localhost:27017',
  database: 'myapp',
  collection: 'chat_flows',
});

const flow = createGraph()
  .addNode(...)
  .build({
    id: 'my-flow',
    flowId: 'user-789',
    storageAdapter: storage, // Persists to MongoDB
  });
```

### Custom Storage Adapter

Implement your own storage backend:

```typescript
import { StorageAdapter, StateSnapshot } from 'chat-graph';

class RedisStorageAdapter extends StorageAdapter {
  async saveSnapshot<S>(snapshot: StateSnapshot<S>): Promise<void> {
    // Save to Redis
  }

  async loadSnapshot<S>(
    flowId: string,
    version?: number
  ): Promise<StateSnapshot<S> | null> {
    // Load from Redis
  }

  async loadHistory<S>(flowId: string): Promise<StateSnapshot<S>[]> {
    // Load all versions
  }

  async deleteFlow(flowId: string): Promise<void> {
    // Delete all versions
  }
}
```

## What Gets Persisted?

Both **state** and **tracker** are saved:

```typescript
interface StateSnapshot {
  flowId: string; // Flow identifier
  version: number; // Auto-incremented version
  timestamp: Date; // When saved

  state: {
    // User state
    name: 'Alice';
    age: 25;
    // ...
  };

  tracker: {
    // Execution state
    __graphId: string;
    __currentNodeId: string;
    __isActionTaken: boolean;
    __isResponseValid: boolean;
    __isDone: boolean;
  };
}
```

This means the flow resumes at the exact node/phase where it left off!

## Multiple Concurrent Flows

Use different `flowId` values for different users/sessions:

```typescript
const storage = new MemoryStorageAdapter();

// User 1
const flow1 = createGraph()
  .addNode(...)
  .build({
    id: 'user-flow',
    flowId: 'user-001',
    storageAdapter: storage,
  });

// User 2
const flow2 = createGraph()
  .addNode(...)
  .build({
    id: 'user-flow',
    flowId: 'user-002',
    storageAdapter: storage,
  });

// Each flow has completely independent state
```

## Global State Manager

For convenience, use the global state manager:

```typescript
import { getGlobalStateManager } from 'chat-graph';

const stateManager = getGlobalStateManager();

// Access state manually
const state = await stateManager.load('session-123');
const history = await stateManager.getHistory('session-123');

// Save custom snapshot
await stateManager.save({
  flowId: 'custom',
  version: 1,
  timestamp: new Date(),
  state: { custom: 'data' },
  tracker: {
    /* ... */
  },
});
```

## Design Philosophy

### TypeScript for DX, Not Runtime Enforcement

The schema system is designed to:

- ✅ Provide excellent **developer experience** with autocomplete and type errors
- ✅ Catch mistakes **during development** with TypeScript
- ✅ Allow **flexibility** at runtime (no forced validation)

**Not designed to:**

- ❌ Block runtime execution if types don't match
- ❌ Throw errors for fields not in schema
- ❌ Force developers into strict validation

If you need runtime validation, implement it in your validation functions:

```typescript
.addNode({
  validate: async (state, event) => {
    // Your custom validation logic
    if (typeof event.user_message !== 'string') {
      return { isValid: false, errorMessage: 'Invalid input' };
    }

    return { isValid: true };
  }
})
```

## Examples

See:

- [`examples/schema-example.ts`](../examples/schema-example.ts) - Type-safe state with reducers
- [`examples/persistence-example.ts`](../examples/persistence-example.ts) - State persistence and versioning

## API Reference

### Types

- `StateSchema` - Schema definition type
- `InferState<Schema>` - Infer TypeScript type from schema
- `InferStateFromSchema<Schema>` - Alias for InferState
- `FieldDefinition` - Field with reducer and default
- `PrimitiveType` - String | Number | Boolean | Array | Object
- `StateSnapshot<Schema>` - Snapshot interface

### Functions

- `createInitialState(schema, overrides)` - Create initial state with defaults
- `mergeState(schema, current, updates)` - Merge state with reducers

### Classes

- `MemoryStorageAdapter` - In-memory storage (for testing/development)
- `MongoStorageAdapter` - MongoDB storage (requires `mongodb` package)
- `StateManager` - Manages state persistence

## Migration Guide

If you have existing graphs without schemas:

```typescript
// Old way (still works!)
const flow = createGraph()
  .addNode(...)
  .build({ id: 'my-flow' });

// New way (with schema and persistence)
const schema = {
  name: String,
  age: Number,
} as const satisfies StateSchema;

const flow = createGraph<typeof schema>()
  .addNode(...)
  .build({
    id: 'my-flow',
    schema: schema,
    flowId: 'optional-flow-id',
    storageAdapter: new MemoryStorageAdapter(),
  });
```

**Schema is optional** - existing code continues to work without changes!
