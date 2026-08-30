# Storage & Persistence

Persist state and resume flows across instances with simple storage adapters. Snapshots include state and execution tracker.

This is what lets several processes share one conversation: any process can rebuild the
graph, load the latest snapshot, handle a turn, and keep no conversation state of its own.

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
  messages: z.array(z.string()).registerReducer(registry, {
    default: () => [],
    reducer: { fn: (p, n) => [...p, ...n] },
  }),
});
const storage = new MemoryStorageAdapter();

const graph = new ChatGraphBuilder({ schema: State })
  .addNode({
    id: 'hello',
    action: () => ({ messages: ['hi'] }),
    autoAdvance: true,
  })
  .addEdge(START, 'hello')
  .addEdge('hello', END)
  .compile({ id: 'session-1', storageAdapter: storage, autoSave: true });

await graph.invoke({ userMessage: '' });
```

## Resume Later

Recreate the graph with the same `id`. State and tracker are **not** loaded at construction
— `invoke()` loads the latest snapshot at the start of every turn, so a fresh instance
simply continues where the conversation left off:

```typescript
const again = new ChatGraphBuilder({ schema: State })
  .addNode({
    id: 'hello',
    action: () => ({ messages: ['hi'] }),
    autoAdvance: true,
  })
  .addEdge(START, 'hello')
  .addEdge('hello', END)
  .compile({ id: 'session-1', storageAdapter: storage });

console.log(again.state); // still the initial state — nothing loaded yet

await again.invoke({ userMessage: 'next' }); // loads session-1, then runs the turn
console.log(again.state); // restored and advanced
```

To inspect stored state without running a turn, load it explicitly:

```typescript
await again.restoreFromSnapshot(); // latest
console.log(again.state);
```

## History & Versions

Every save writes a new numbered version rather than overwriting, so a conversation has a
full audit trail.

```typescript
const history = await graph.getSnapshotHistory(); // newest first
// Each snapshot has flowId, version, timestamp, state, and tracker

await graph.restoreFromSnapshot(); // latest
await graph.restoreFromSnapshot(2); // specific version

await graph.saveSnapshot(); // save manually (e.g. with autoSave: false)
await graph.deleteSnapshots(); // drop the conversation
```

## Concurrent Turns

Two processes may pick up the same conversation at once. Both load version _N_, both try to
write _N+1_, and the loser is rejected with a typed error instead of silently overwriting:

```typescript
import { VersionConflictError } from 'chat-graph';

try {
  await graph.invoke({ userMessage: text });
} catch (error) {
  if (error instanceof VersionConflictError) {
    // someone else advanced this conversation — reload and decide
    console.warn(error.flowId, error.attemptedVersion);
  } else {
    throw error; // a real storage failure
  }
}
```

The engine never retries: only your host knows whether re-processing that input is safe.
Being a distinct error type is the point — you can tell "someone else got there first" apart
from "the database is down".

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
    autoAdvance: true,
  })
  .compile({ id: 'session-2', storageAdapter: mongo, autoSave: true });
```

## Custom Adapter

Extend `StorageAdapter` and implement all seven methods:

```typescript
import {
  StorageAdapter,
  StateSnapshot,
  StateSchema,
  VersionConflictError,
} from 'chat-graph';

class RedisStorageAdapter extends StorageAdapter {
  async saveSnapshot<S extends StateSchema>(
    snapshot: StateSnapshot<S>
  ): Promise<void> {
    // MUST reject a (flowId, version) that already exists:
    // throw new VersionConflictError(snapshot.flowId, snapshot.version);
  }

  async loadSnapshot<S extends StateSchema>(
    flowId: string,
    version?: number // omitted means latest
  ): Promise<StateSnapshot<S> | null> {
    return null;
  }

  async loadHistory<S extends StateSchema>(
    flowId: string,
    limit?: number // newest first
  ): Promise<StateSnapshot<S>[]> {
    return [];
  }

  async deleteFlow(flowId: string): Promise<void> {}

  async pruneHistory(flowId: string, keepLast: number): Promise<void> {}

  async getSnapshotCount(flowId: string): Promise<number> {
    return 0;
  }

  async flowExists(flowId: string): Promise<boolean> {
    return false;
  }
}
```

Two rules a correct adapter must follow:

1. **Reject duplicate versions** with `VersionConflictError`, so concurrent turns are
   detected rather than silently merged.
2. **Do not hand back stored objects by reference.** The engine mutates `state` and
   `tracker` in place, so a snapshot returned by reference would be corrupted by the graph
   that loaded it. Serializing backends get this for free; an in-memory one must copy.

## What Is Saved?

- **State**: your Zod-typed data.
- **Tracker**: `__graphId`, `__currentNodeId`, and the phase flags that record how far
  through the current node the conversation is.

Deliberately **not** saved, because both belong to a single turn: `emittedMessages` and
`ChatEvent.payload`. A restored snapshot starts a turn with no emitted messages, so a replay
never re-sends old text. See [Turns](./turns).

With `autoSave: true` (the default) a snapshot is written after each node action and each
successful validation, so a conversation can resume mid-node.

::: tip Snapshot growth
One snapshot per node transition per conversation adds up. `pruneHistory` is available on
every adapter, and nothing calls it for you — expiry is your policy to set (a MongoDB TTL
index is one way).
:::
