/**
 * Persistence Tests
 *
 * Exhaustive tests for the persistence layer:
 *
 * MemoryStorageAdapter:
 * - saveSnapshot, loadSnapshot (latest & specific version)
 * - loadHistory (ordered, with limit)
 * - pruneHistory
 * - deleteFlow
 * - clearAll (shared storage)
 * - getSnapshotCount
 * - flowExists
 * - getAllFlowIds
 * - shared storage across instances
 * - multiple flows isolated
 *
 * StateManager:
 * - save / load / getHistory / delete / clear
 * - version counter increments
 *
 * Graph persistence integration:
 * - restoreFromSnapshot (with & without stateManager)
 * - getSnapshotHistory with and without limit
 * - saveSnapshot manually
 * - deleteSnapshots
 * - getStateManager
 * - auto-save across user-input turns
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { MemoryStorageAdapter } from '../src/persistence/memory-adapter';
import { StateSnapshot } from '../src/persistence/storage-adapter';
import { StateManager } from '../src/state-manager';
import { ChatGraph, ChatGraphBuilder, START, END, registry } from '../src';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const snap = (
  flowId: string,
  version: number,
  state: any = {}
): StateSnapshot => ({
  flowId,
  version,
  state,
  timestamp: new Date(),
  tracker: {
    __currentNodeId: 'test',
    __isActionTaken: true,
    __isResponseValid: true,
    __graphId: flowId,
    __isDone: false,
  },
});

const makeSchema = () =>
  z.object({
    name: z.string().optional(),
    counter: z.number().registerReducer(registry, {
      reducer: { fn: (p, n) => p + n },
      default: () => 0,
    }),
    messages: z.array(z.string()).registerReducer(registry, {
      reducer: { fn: (p, n) => p.concat(n) },
      default: () => [],
    }),
  });

// ---------------------------------------------------------------------------
// MemoryStorageAdapter
// ---------------------------------------------------------------------------

describe('MemoryStorageAdapter — basic CRUD', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
    adapter.clearAll();
  });

  it('returns null when flow does not exist', async () => {
    const result = await adapter.loadSnapshot('no-such-flow');
    expect(result).toBeNull();
  });

  it('saves and loads the latest snapshot', async () => {
    await adapter.saveSnapshot(snap('flow-a', 1, { x: 'hello' }));
    const loaded = await adapter.loadSnapshot('flow-a');
    expect(loaded?.version).toBe(1);
    expect(loaded?.state).toEqual({ x: 'hello' });
  });

  it('loads the latest snapshot when multiple versions exist', async () => {
    await adapter.saveSnapshot(snap('flow-b', 1, { v: 1 }));
    await adapter.saveSnapshot(snap('flow-b', 2, { v: 2 }));
    await adapter.saveSnapshot(snap('flow-b', 3, { v: 3 }));
    const loaded = await adapter.loadSnapshot('flow-b');
    expect(loaded?.version).toBe(3);
    expect(loaded?.state).toEqual({ v: 3 });
  });

  it('loads a specific version', async () => {
    await adapter.saveSnapshot(snap('flow-c', 1, { v: 1 }));
    await adapter.saveSnapshot(snap('flow-c', 2, { v: 2 }));
    await adapter.saveSnapshot(snap('flow-c', 3, { v: 3 }));

    const v1 = await adapter.loadSnapshot('flow-c', 1);
    expect(v1?.state).toEqual({ v: 1 });

    const v2 = await adapter.loadSnapshot('flow-c', 2);
    expect(v2?.state).toEqual({ v: 2 });
  });

  it('returns null for a non-existent version', async () => {
    await adapter.saveSnapshot(snap('flow-d', 1));
    const result = await adapter.loadSnapshot('flow-d', 999);
    expect(result).toBeNull();
  });

  it('deletes a flow and its snapshots', async () => {
    await adapter.saveSnapshot(snap('flow-e', 1));
    await adapter.saveSnapshot(snap('flow-e', 2));
    await adapter.deleteFlow('flow-e');
    const result = await adapter.loadSnapshot('flow-e');
    expect(result).toBeNull();
  });

  it('clearAll removes everything', async () => {
    await adapter.saveSnapshot(snap('flow-x', 1));
    await adapter.saveSnapshot(snap('flow-y', 1));
    adapter.clearAll();

    const x = await adapter.loadSnapshot('flow-x');
    const y = await adapter.loadSnapshot('flow-y');
    expect(x).toBeNull();
    expect(y).toBeNull();
  });
});

describe('MemoryStorageAdapter — loadHistory', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
    adapter.clearAll();
  });

  it('returns snapshots ordered newest-first', async () => {
    await adapter.saveSnapshot(snap('hist-a', 1));
    await adapter.saveSnapshot(snap('hist-a', 2));
    await adapter.saveSnapshot(snap('hist-a', 3));

    const history = await adapter.loadHistory('hist-a');
    expect(history.map((s) => s.version)).toEqual([3, 2, 1]);
  });

  it('returns empty array for unknown flow', async () => {
    const history = await adapter.loadHistory('unknown-flow');
    expect(history).toEqual([]);
  });

  it('applies limit correctly', async () => {
    for (let i = 1; i <= 5; i++) {
      await adapter.saveSnapshot(snap('hist-b', i));
    }
    const limited = await adapter.loadHistory('hist-b', 2);
    expect(limited).toHaveLength(2);
    expect(limited[0].version).toBe(5);
    expect(limited[1].version).toBe(4);
  });

  it('returns all snapshots when limit > count', async () => {
    await adapter.saveSnapshot(snap('hist-c', 1));
    await adapter.saveSnapshot(snap('hist-c', 2));
    const history = await adapter.loadHistory('hist-c', 999);
    expect(history).toHaveLength(2);
  });
});

describe('MemoryStorageAdapter — pruneHistory', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
    adapter.clearAll();
  });

  it('prune keeps only the N most recent versions', async () => {
    for (let i = 1; i <= 6; i++) {
      await adapter.saveSnapshot(snap('prune-a', i, { v: i }));
    }
    await adapter.pruneHistory('prune-a', 3);

    const count = await adapter.getSnapshotCount('prune-a');
    expect(count).toBe(3);

    // Versions 4, 5, 6 should remain
    const history = await adapter.loadHistory('prune-a');
    const versions = history.map((s) => s.version).sort((a, b) => a - b);
    expect(versions).toEqual([4, 5, 6]);
  });

  it('prune with keepLast >= total does nothing', async () => {
    await adapter.saveSnapshot(snap('prune-b', 1));
    await adapter.saveSnapshot(snap('prune-b', 2));
    await adapter.pruneHistory('prune-b', 10);

    const count = await adapter.getSnapshotCount('prune-b');
    expect(count).toBe(2);
  });
});

describe('MemoryStorageAdapter — getSnapshotCount / flowExists / getAllFlowIds', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
    adapter.clearAll();
  });

  it('getSnapshotCount returns 0 for new flow', async () => {
    expect(await adapter.getSnapshotCount('empty')).toBe(0);
  });

  it('getSnapshotCount returns correct count', async () => {
    await adapter.saveSnapshot(snap('cnt-a', 1));
    await adapter.saveSnapshot(snap('cnt-a', 2));
    await adapter.saveSnapshot(snap('cnt-a', 3));
    expect(await adapter.getSnapshotCount('cnt-a')).toBe(3);
  });

  it('flowExists returns false for unknown flow', async () => {
    expect(await adapter.flowExists('ghost')).toBe(false);
  });

  it('flowExists returns true after saving', async () => {
    await adapter.saveSnapshot(snap('real-flow', 1));
    expect(await adapter.flowExists('real-flow')).toBe(true);
  });

  it('flowExists returns false after deleteFlow', async () => {
    await adapter.saveSnapshot(snap('temp', 1));
    await adapter.deleteFlow('temp');
    expect(await adapter.flowExists('temp')).toBe(false);
  });

  it('getAllFlowIds returns all distinct flow IDs', async () => {
    await adapter.saveSnapshot(snap('f1', 1));
    await adapter.saveSnapshot(snap('f2', 1));
    await adapter.saveSnapshot(snap('f3', 1));
    const ids = adapter.getAllFlowIds();
    expect(ids).toContain('f1');
    expect(ids).toContain('f2');
    expect(ids).toContain('f3');
  });
});

describe('MemoryStorageAdapter — shared storage across instances', () => {
  it("two instances see each other's data", async () => {
    const a1 = new MemoryStorageAdapter();
    const a2 = new MemoryStorageAdapter();
    a1.clearAll();

    await a1.saveSnapshot(snap('shared', 1, { from: 'a1' }));
    const loaded = await a2.loadSnapshot('shared');
    expect(loaded?.state).toEqual({ from: 'a1' });
  });

  it('multiple flows stored by different instances are independent', async () => {
    const a1 = new MemoryStorageAdapter();
    const a2 = new MemoryStorageAdapter();
    a1.clearAll();

    await a1.saveSnapshot(snap('flow1', 1, { val: 'one' }));
    await a2.saveSnapshot(snap('flow2', 1, { val: 'two' }));

    const f1 = await a2.loadSnapshot('flow1');
    const f2 = await a1.loadSnapshot('flow2');
    expect(f1?.state).toEqual({ val: 'one' });
    expect(f2?.state).toEqual({ val: 'two' });
  });
});

// ---------------------------------------------------------------------------
// StateManager
// ---------------------------------------------------------------------------

describe('StateManager', () => {
  let mgr: StateManager;

  beforeEach(() => {
    const adapter = new MemoryStorageAdapter();
    adapter.clearAll();
    mgr = new StateManager(adapter);
  });

  const fakeTracker = (id: string) => ({
    __currentNodeId: 'node1',
    __isActionTaken: false,
    __isResponseValid: false,
    __graphId: id,
    __isDone: false,
  });

  it('save returns an incrementing version number', async () => {
    const v1 = await mgr.save(
      'm1',
      { messages: ['a'] } as any,
      fakeTracker('m1')
    );
    const v2 = await mgr.save(
      'm1',
      { messages: ['b'] } as any,
      fakeTracker('m1')
    );
    expect(v1).toBe(1);
    expect(v2).toBe(2);
  });

  it('load returns null for unknown flow', async () => {
    const result = await mgr.load('unknown');
    expect(result).toBeNull();
  });

  it('load returns the latest snapshot', async () => {
    await mgr.save('m2', { name: 'v1' } as any, fakeTracker('m2'));
    await mgr.save('m2', { name: 'v2' } as any, fakeTracker('m2'));
    const snapshot = await mgr.load('m2');
    expect((snapshot?.state as any).name).toBe('v2');
  });

  it('load with version returns the specific version', async () => {
    await mgr.save('m3', { name: 'first' } as any, fakeTracker('m3'));
    await mgr.save('m3', { name: 'second' } as any, fakeTracker('m3'));

    const snap1 = await mgr.load('m3', 1);
    expect((snap1?.state as any).name).toBe('first');
  });

  it('getHistory returns all versions newest-first', async () => {
    for (let i = 0; i < 4; i++) {
      await mgr.save('m4', { i } as any, fakeTracker('m4'));
    }
    const history = await mgr.getHistory('m4');
    expect(history).toHaveLength(4);
    expect(history[0].version).toBe(4);
  });

  it('getHistory with limit', async () => {
    for (let i = 0; i < 5; i++) {
      await mgr.save('m5', { i } as any, fakeTracker('m5'));
    }
    const limited = await mgr.getHistory('m5', 2);
    expect(limited).toHaveLength(2);
  });

  it('delete removes all snapshots for the flow', async () => {
    await mgr.save('m6', {} as any, fakeTracker('m6'));
    await mgr.save('m6', {} as any, fakeTracker('m6'));
    await mgr.delete('m6');
    const result = await mgr.load('m6');
    expect(result).toBeNull();
  });

  it('clear resets version counters and all stored data', async () => {
    await mgr.save('m7', {} as any, fakeTracker('m7'));
    await mgr.clear();
    const result = await mgr.load('m7');
    expect(result).toBeNull();
  });

  it('version counter for different flows is independent', async () => {
    const va = await mgr.save('fa', {} as any, fakeTracker('fa'));
    const vb1 = await mgr.save('fb', {} as any, fakeTracker('fb'));
    const vb2 = await mgr.save('fb', {} as any, fakeTracker('fb'));
    const va2 = await mgr.save('fa', {} as any, fakeTracker('fa'));

    expect(va).toBe(1);
    expect(vb1).toBe(1);
    expect(vb2).toBe(2);
    expect(va2).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Graph persistence integration
// ---------------------------------------------------------------------------

describe('Graph — restoreFromSnapshot', () => {
  it('returns false and warns when no stateManager configured', async () => {
    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'no-sm',
      schema: State,
      registry,
      nodes: [{ id: 'n', action: () => ({}), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    const result = await graph.restoreFromSnapshot();
    expect(result).toBe(false);
  });

  it('returns false when no snapshot exists', async () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'restore-no-snap',
      schema: State,
      registry,
      storageAdapter: storage,
      nodes: [{ id: 'n', action: () => ({}), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    const result = await graph.restoreFromSnapshot();
    expect(result).toBe(false);
  });

  it('restores state from the latest snapshot', async () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'restore-latest',
      schema: State,
      registry,
      storageAdapter: storage,
      autoSave: true,
      nodes: [
        {
          id: 'n',
          action: () => ({ name: 'RestoreMe', counter: 7 }),
          autoAdvance: true,
        },
      ],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });

    // Create a fresh graph with the same adapter and restore
    const graph2 = new ChatGraph({
      id: 'restore-latest',
      schema: State,
      registry,
      storageAdapter: storage,
      nodes: [{ id: 'n', action: () => ({}), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    const ok = await graph2.restoreFromSnapshot();
    expect(ok).toBe(true);
    expect(graph2.state.name).toBe('RestoreMe');
    expect(graph2.state.counter).toBe(7);
  });
});

describe('Graph — getSnapshotHistory', () => {
  it('returns empty array when no stateManager', async () => {
    const State = makeSchema();
    const g = new ChatGraph({
      id: 'hist-no-sm',
      schema: State,
      registry,
      nodes: [{ id: 'n', action: () => ({}), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    const history = await g.getSnapshotHistory();
    expect(history).toEqual([]);
  });

  it('returns all saved snapshots', async () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = makeSchema();
    const g = new ChatGraph({
      id: 'hist-all',
      schema: State,
      registry,
      storageAdapter: storage,
      autoSave: true,
      nodes: [
        { id: 'a', action: () => ({ counter: 1 }), autoAdvance: true },
        { id: 'b', action: () => ({ counter: 1 }), autoAdvance: true },
        { id: 'c', action: () => ({ counter: 1 }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: END },
      ],
    });

    await g.invoke({ userMessage: '' });
    const history = await g.getSnapshotHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('respects limit parameter', async () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = makeSchema();
    const g = new ChatGraph({
      id: 'hist-limit',
      schema: State,
      registry,
      storageAdapter: storage,
      autoSave: true,
      nodes: [
        { id: 'a', action: () => ({ counter: 1 }), autoAdvance: true },
        { id: 'b', action: () => ({ counter: 1 }), autoAdvance: true },
        { id: 'c', action: () => ({ counter: 1 }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: END },
      ],
    });

    await g.invoke({ userMessage: '' });
    const limited = await g.getSnapshotHistory(1);
    expect(limited).toHaveLength(1);
  });
});

describe('Graph — saveSnapshot / deleteSnapshots / getStateManager', () => {
  it('saveSnapshot returns null when no stateManager', async () => {
    const State = makeSchema();
    const g = new ChatGraph({
      id: 'manual-save-no-sm',
      schema: State,
      registry,
      nodes: [{ id: 'n', action: () => ({}), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    const ver = await g.saveSnapshot();
    expect(ver).toBeNull();
  });

  it('saveSnapshot returns a version number when stateManager present', async () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = makeSchema();
    const g = new ChatGraph({
      id: 'manual-save-sm',
      schema: State,
      registry,
      storageAdapter: storage,
      autoSave: false,
      nodes: [{ id: 'n', action: () => ({ name: 'snap' }), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    await g.invoke({ userMessage: '' });
    const ver = await g.saveSnapshot();
    expect(typeof ver).toBe('number');
    expect(ver).toBeGreaterThan(0);
  });

  it('deleteSnapshots removes all history', async () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = makeSchema();
    const g = new ChatGraph({
      id: 'delete-snaps',
      schema: State,
      registry,
      storageAdapter: storage,
      autoSave: true,
      nodes: [{ id: 'n', action: () => ({}), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    await g.invoke({ userMessage: '' });
    await g.deleteSnapshots();

    const history = await g.getSnapshotHistory();
    expect(history).toHaveLength(0);
  });

  it('getStateManager returns undefined when not configured', () => {
    const State = makeSchema();
    const g = new ChatGraph({
      id: 'get-sm-none',
      schema: State,
      registry,
      nodes: [],
      edges: [],
    });

    expect(g.getStateManager()).toBeUndefined();
  });

  it('getStateManager returns the StateManager instance when configured', () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = makeSchema();
    const g = new ChatGraph({
      id: 'get-sm-exists',
      schema: State,
      registry,
      storageAdapter: storage,
      nodes: [],
      edges: [],
    });

    expect(g.getStateManager()).toBeDefined();
  });
});

describe('Graph — auto-save across multi-turn user-input flow', () => {
  it('saves state at each step of a multi-turn conversation', async () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = z.object({
      name: z.string().optional(),
      age: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'askName',
        action: { message: 'Name?' },
        validate: {
          rules: [{ regex: '\\w+', errorMessage: 'Need a name' }],
          answerKey: 'name',
        },
      })
      .addNode({
        id: 'askAge',
        action: { message: 'Age?' },
        validate: {
          rules: [{ regex: '^\\d+$', errorMessage: 'Need a number' }],
          answerKey: 'age',
        },
      })
      .addEdge(START, 'askName')
      .addEdge('askName', 'askAge')
      .addEdge('askAge', END)
      .compile({
        id: 'autosave-multiturn',
        storageAdapter: storage,
        autoSave: true,
      } as any);

    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: 'Alice' });
    await g.invoke({ userMessage: '30' });

    expect(g.state.name).toBe('Alice');
    expect(g.state.age).toBe('30');
    expect(g.isDone).toBe(true);

    const history = await g.getSnapshotHistory();
    expect(history.length).toBeGreaterThan(0);
  });
});
