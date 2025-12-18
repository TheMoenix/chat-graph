# Storage & Persistence

Persist state and resume flows across instances with simple storage adapters. Snapshots include state and execution tracker.

## Quick Start (Auto-Save)

```typescript
import {
  ChatGraphBuilder,
  MemoryStorageAdapter,
  z,
  registry,
  START,
  END,
} from 'chat-graph';

const State = z.object({
  messages: z
    .array(z.string())
    .registerReducer(registry, {
      default: () => [],
      reducer: { fn: (p, n) => [...p, ...n] },
    }),
});
const storage = new MemoryStorageAdapter();

const graph = new ChatGraphBuilder({ schema: State })
  .addNode({
    id: 'hello',
    action: () => ({ messages: ['hi'] }),
    noUserInput: true,
  })
  .addEdge(START, 'hello')
  .addEdge('hello', END)
  .compile({ id: 'session-1', storageAdapter: storage, autoSave: true });

await graph.invoke({ user_message: '' });
```

## Resume Later

```typescript
// Recreate with same id; state & tracker restore automatically
const again = new ChatGraphBuilder({ schema: State })
  .addNode({
    id: 'hello',
    action: () => ({ messages: ['hi'] }),
    noUserInput: true,
  })
  .addEdge(START, 'hello')
  .addEdge('hello', END)
  .compile({ id: 'session-1', storageAdapter: storage });

console.log(again.state); // Restored from snapshots
```

## History & Versions

```typescript
const manager = graph.getStateManager();
const history = await manager?.getHistory('session-1');
// Each snapshot has version, state, and tracker

await graph.restoreFromSnapshot(); // latest
await graph.restoreFromSnapshot(2); // specific version
```

## MongoDB Adapter

```bash
npm install mongodb
```

```typescript
import { MongoStorageAdapter } from 'chat-graph';

const mongo = new MongoStorageAdapter({
  uri: 'mongodb://localhost:27017',
  database: 'myapp',
  collection: 'chat_flows',
});
await mongo.connect();

const graph = new ChatGraphBuilder({ schema: State })
  .addNode({
    id: 'hello',
    action: () => ({ messages: ['hi'] }),
    noUserInput: true,
  })
  .compile({ id: 'session-2', storageAdapter: mongo, autoSave: true });
```

## Custom Adapter

```typescript
import { StorageAdapter, StateSnapshot } from 'chat-graph';

class RedisStorageAdapter extends StorageAdapter {
  async save<S>(snapshot: StateSnapshot<S>): Promise<void> {
    /* ... */
  }
  async load<S>(
    flowId: string,
    version?: number
  ): Promise<StateSnapshot<S> | null> {
    /* ... */ return null;
  }
  async history<S>(flowId: string): Promise<StateSnapshot<S>[]> {
    /* ... */ return [];
  }
  async delete(flowId: string): Promise<void> {
    /* ... */
  }
}
```

## What Is Saved?

- State: your Zod-typed data.
- Tracker: `__graphId`, `__currentNodeId`, and phase flags.

Resuming picks up exactly where the flow left off.
