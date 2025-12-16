/**
 * Tests for Zod-based state management and persistence
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  createGraph,
  StateGraph,
  START,
  END,
  StateSchema,
  InferState,
  MemoryStorageAdapter,
  StateManager,
  createInitialState,
  mergeState,
  registry,
  z,
} from '../src';

describe('Zod State Schema', () => {
  it('should infer types from Zod schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      isActive: z.boolean(),
    });

    type ExpectedState = {
      name: string;
      age: number;
      isActive: boolean;
    };

    // TypeScript compile-time test
    const state: InferState<typeof schema> = {
      name: 'Alice',
      age: 25,
      isActive: true,
    };

    expect(state).toBeDefined();
  });

  it('should create initial state with Zod defaults', () => {
    const registry = createRegistry();
    const schema = z.object({
      name: z.string().default(''),
      count: z.number().default(0),
      messages: z.array(z.string()).default([]),
    });

    const state = createInitialState(schema, registry);

    expect(state).toEqual({
      name: '',
      count: 0,
      messages: [],
    });
  });

  it('should merge state with simple shallow merge', () => {
    const registry = createRegistry();
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const currentState: InferState<typeof schema> = {
      name: 'Alice',
      age: 25,
    };

    const updates = { age: 26 };

    const newState = mergeState(schema, registry, currentState, updates);

    expect(newState).toEqual({
      name: 'Alice',
      age: 26,
    });
  });

  it('should use reducer functions when merging state', () => {
    const registry = createRegistry();
    const schema = z.object({
      count: z.number().registerReducer(registry, {
        reducer: {
          fn: (prev: number, next: number) => prev + next,
        },
        default: () => 0,
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: {
          fn: (prev: string[], next: string[]) => [...prev, ...next],
        },
        default: () => [],
      }),
    });

    const currentState = {
      count: 5,
      messages: ['hello'],
    };

    const updates = {
      count: 3,
      messages: ['world'],
    };

    const newState = mergeState(schema, registry, currentState, updates);

    expect(newState).toEqual({
      count: 8, // 5 + 3
      messages: ['hello', 'world'], // concatenated
    });
  });

  it('should handle fields not in schema gracefully', () => {
    const registry = createRegistry();
    const schema = z.object({
      name: z.string(),
    });

    const currentState = { name: 'Alice' };
    const updates = { name: 'Bob', unknownField: 'value' } as any;

    const result = mergeState(schema, registry, currentState, updates) as any;
    expect(result.name).toBe('Bob');
    expect(result.unknownField).toBe('value'); // Merged even though not in schema
  });

  it('should apply updates without schema (fallback mode)', () => {
    const currentState = { name: 'Alice' };
    const updates = { name: 'Bob', age: 25 };

    // No schema provided - simple shallow merge
    const result = mergeState(undefined, undefined, currentState, updates);

    expect(result).toEqual({ name: 'Bob', age: 25 });
  });
});

describe('Memory Storage Adapter', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
  });

  it('should save and load snapshots', async () => {
    const snapshot = {
      flowId: 'test-flow',
      version: 1,
      timestamp: new Date(),
      state: { name: 'Alice', age: 25 },
      tracker: {
        __graphId: 'test',
        __currentNodeId: 'node1',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    };

    await adapter.saveSnapshot(snapshot);
    const loaded = await adapter.loadSnapshot('test-flow');

    expect(loaded).toMatchObject({
      flowId: 'test-flow',
      version: 1,
      state: { name: 'Alice', age: 25 },
    });
  });

  it('should load specific version', async () => {
    await adapter.saveSnapshot({
      flowId: 'test',
      version: 1,
      timestamp: new Date(),
      state: { count: 1 },
      tracker: {} as any,
    });

    await adapter.saveSnapshot({
      flowId: 'test',
      version: 2,
      timestamp: new Date(),
      state: { count: 2 },
      tracker: {} as any,
    });

    const v1 = await adapter.loadSnapshot('test', 1);
    const v2 = await adapter.loadSnapshot('test', 2);
    const latest = await adapter.loadSnapshot('test');

    expect(v1?.state).toEqual({ count: 1 });
    expect(v2?.state).toEqual({ count: 2 });
    expect(latest?.state).toEqual({ count: 2 });
  });

  it('should return null for non-existent flow', async () => {
    const result = await adapter.loadSnapshot('non-existent');
    expect(result).toBeNull();
  });

  it('should load history with limit', async () => {
    for (let i = 1; i <= 5; i++) {
      await adapter.saveSnapshot({
        flowId: 'test',
        version: i,
        timestamp: new Date(),
        state: { count: i },
        tracker: {} as any,
      });
    }

    const history = await adapter.loadHistory('test', 3);
    expect(history).toHaveLength(3);
    expect(history[0].version).toBe(5); // Newest first
    expect(history[2].version).toBe(3);
  });

  it('should delete flow snapshots', async () => {
    await adapter.saveSnapshot({
      flowId: 'test',
      version: 1,
      timestamp: new Date(),
      state: {},
      tracker: {} as any,
    });

    expect(await adapter.flowExists('test')).toBe(true);
    await adapter.deleteFlow('test');
    expect(await adapter.flowExists('test')).toBe(false);
  });

  it('should prune old snapshots', async () => {
    for (let i = 1; i <= 10; i++) {
      await adapter.saveSnapshot({
        flowId: 'test',
        version: i,
        timestamp: new Date(),
        state: { count: i },
        tracker: {} as any,
      });
    }

    await adapter.pruneHistory('test', 3);
    const count = await adapter.getSnapshotCount('test');
    expect(count).toBe(3);

    const history = await adapter.loadHistory('test');
    expect(history[0].version).toBe(10); // Most recent kept
    expect(history[2].version).toBe(8);
  });
});

describe('State Manager', () => {
  let manager: StateManager;
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
    manager = new StateManager(adapter);
  });

  it('should save and load state with auto-incrementing versions', async () => {
    const state = { name: 'Alice' };
    const tracker = {
      __graphId: 'test',
      __currentNodeId: 'node1',
      __isActionTaken: false,
      __isResponseValid: false,
      __isDone: false,
    } as any;

    const v1 = await manager.save('flow1', state, tracker);
    expect(v1).toBe(1);

    const v2 = await manager.save('flow1', { name: 'Bob' }, tracker);
    expect(v2).toBe(2);

    const latest = await manager.load('flow1');
    expect(latest?.version).toBe(2);
    expect(latest?.state).toEqual({ name: 'Bob' });
  });

  it('should manage multiple flows independently', async () => {
    const tracker = {} as any;

    await manager.save('flow1', { data: 'A' }, tracker);
    await manager.save('flow2', { data: 'B' }, tracker);

    const flow1 = await manager.load('flow1');
    const flow2 = await manager.load('flow2');

    expect(flow1?.state).toEqual({ data: 'A' });
    expect(flow2?.state).toEqual({ data: 'B' });
  });

  it('should check if flow exists', async () => {
    expect(await manager.exists('test')).toBe(false);

    await manager.save('test', {}, {} as any);
    expect(await manager.exists('test')).toBe(true);
  });

  it('should get snapshot count', async () => {
    const tracker = {} as any;

    expect(await manager.getSnapshotCount('test')).toBe(0);

    await manager.save('test', {}, tracker);
    await manager.save('test', {}, tracker);
    await manager.save('test', {}, tracker);

    expect(await manager.getSnapshotCount('test')).toBe(3);
  });

  it('should delete all snapshots for a flow', async () => {
    await manager.save('test', {}, {} as any);
    await manager.save('test', {}, {} as any);

    expect(await manager.exists('test')).toBe(true);
    await manager.delete('test');
    expect(await manager.exists('test')).toBe(false);
  });

  it('should get history', async () => {
    const tracker = {} as any;

    await manager.save('test', { v: 1 }, tracker);
    await manager.save('test', { v: 2 }, tracker);
    await manager.save('test', { v: 3 }, tracker);

    const history = await manager.getHistory('test');
    expect(history).toHaveLength(3);
    expect(history[0].state).toEqual({ v: 3 }); // Newest first
  });
});

describe('StateGraph with Zod Schema', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
  });

  it('should execute workflow with Zod schema and reducers', async () => {
    const registry = createRegistry();
    const State = z.object({
      currentStep: z.string().default(''),
      count: z.number().default(0),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: {
          fn: (prev, next) => prev.concat(next),
        },
        default: () => [],
      }),
    });

    const workflow = new StateGraph(State, registry)
      .addNode('nodeA', (state) => ({
        currentStep: 'A',
        messages: ['Message A'],
        count: state.count + 1,
      }))
      .addNode('nodeB', (state) => ({
        currentStep: 'B',
        messages: ['Message B'],
        count: state.count + 1,
      }))
      .addEdge(START, 'nodeA')
      .addEdge('nodeA', 'nodeB')
      .addEdge('nodeB', END);

    const graph = workflow.compile({
      id: 'test-workflow',
      flowId: 'test-123',
      storageAdapter: adapter,
    });

    await graph.invoke({ user_message: '' });

    const state = graph.state;
    expect(state.currentStep).toBe('B');
    expect(state.count).toBe(2);
    expect(state.messages).toEqual(['Message A', 'Message B']);
  });

  it('should restore state from snapshot', async () => {
    const registry = createRegistry();
    const State = z.object({
      userName: z.string().default(''),
      step: z.string().default('start'),
    });

    const workflow = new StateGraph(State, registry)
      .addNode('getName', () => ({
        userName: 'Alice',
        step: 'getName',
      }))
      .addEdge(START, 'getName')
      .addEdge('getName', END);

    const graph1 = workflow.compile({
      id: 'onboarding',
      flowId: 'user-456',
      storageAdapter: adapter,
    });

    await graph1.invoke({ user_message: '' });

    // Create new instance and restore
    const graph2 = workflow.compile({
      id: 'onboarding',
      flowId: 'user-456',
      storageAdapter: adapter,
    });

    const restored = await graph2.restoreFromSnapshot();
    expect(restored).toBe(true);
    expect(graph2.state.userName).toBe('Alice');
  });

  it('should handle complex nested schemas', async () => {
    const registry = createRegistry();
    const State = z.object({
      user: z.object({
        name: z.string(),
        email: z.string(),
      }),
      tags: z.array(z.string()).registerReducer(registry, {
        reducer: {
          fn: (prev, next) => [...prev, ...next],
        },
        default: () => [],
      }),
    });

    const workflow = new StateGraph(State, registry)
      .addNode('step1', () => ({
        user: { name: 'Alice', email: 'alice@example.com' },
        tags: ['tag1'],
      }))
      .addNode('step2', (state) => ({
        user: state.user,
        tags: ['tag2'],
      }))
      .addEdge(START, 'step1')
      .addEdge('step1', 'step2')
      .addEdge('step2', END);

    const graph = workflow.compile({ id: 'complex-test' });
    await graph.invoke({ user_message: '' });

    expect(graph.state.user.name).toBe('Alice');
    expect(graph.state.tags).toEqual(['tag1', 'tag2']);
  });
});

describe('ChatGraph without Schema (backward compatibility)', () => {
  it('should work without schema', async () => {
    const flow = createGraph()
      .addNode({
        id: 'test',
        action: () => ({
          messages: ['Hello'],
          state: { anyField: 'anyValue' },
        }),
        noUserInput: true,
      })
      .addEdge(START, 'test')
      .addEdge('test', END)
      .build({ id: 'no-schema-flow' });

    const result = await flow.invoke({ user_message: '' });
    expect(result.messages).toContain('Hello');

    const state = flow.state;
    expect(state.anyField).toBe('anyValue');
  });
});
