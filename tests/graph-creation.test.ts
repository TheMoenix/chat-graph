/**
 * Graph Creation Tests
 *
 * Tests both creation patterns and all compile-time / runtime options:
 * - ChatGraphBuilder (builder pattern)
 * - ChatGraph (direct JSON / object config)
 * - Both patterns should produce equivalent results
 * - isDone lifecycle (false → true)
 * - state getter returns a copy
 * - autoSave defaults (true, false)
 * - initialState
 * - Empty graph (START → END only)
 * - Single-node graph
 * - Large node count
 * - Reuse of graph ID in separate instances
 * - GraphBuilder: addNode returns builder for chaining
 * - GraphBuilder: addEdge returns builder for chaining
 */

import { describe, it, expect } from '@jest/globals';
import {
  ChatGraph,
  ChatGraphBuilder,
  START,
  END,
  registry,
  InferState,
} from '../src';
import { MemoryStorageAdapter } from '../src/persistence/memory-adapter';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared schema
// ---------------------------------------------------------------------------

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
// ChatGraphBuilder
// ---------------------------------------------------------------------------

describe('ChatGraphBuilder', () => {
  it('creates and runs a minimal graph', async () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'only', action: { message: 'hello' }, autoAdvance: true })
      .addEdge(START, 'only')
      .addEdge('only', END)
      .compile({ id: 'builder-minimal' });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(true);
  });

  it('addNode / addEdge chain returns builder (fluent API)', () => {
    const State = makeSchema();
    const builder = new ChatGraphBuilder({ schema: State, registry });
    const returned = builder
      .addNode({ id: 'n', action: () => ({}), autoAdvance: true })
      .addEdge(START, 'n')
      .addEdge('n', END);
    // compile() should succeed
    expect(() => returned.compile({ id: 'builder-fluent' })).not.toThrow();
  });

  it('isDone is false before invoke', () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'n', action: () => ({}), autoAdvance: true })
      .addEdge(START, 'n')
      .addEdge('n', END)
      .compile({ id: 'builder-isdone-init' });

    expect(graph.isDone).toBe(false);
  });

  it('isDone becomes true after graph reaches END', async () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'n', action: () => ({}), autoAdvance: true })
      .addEdge(START, 'n')
      .addEdge('n', END)
      .compile({ id: 'builder-isdone-true' });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(true);
  });

  it('state getter returns a snapshot (mutating result does not affect internal state)', async () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'n',
        action: () => ({ name: 'Alice' }),
        autoAdvance: true,
      })
      .addEdge(START, 'n')
      .addEdge('n', END)
      .compile({ id: 'builder-state-copy' });

    await graph.invoke({ userMessage: '' });
    const snap1 = graph.state;
    (snap1 as any).name = 'Mutated';

    const snap2 = graph.state;
    expect(snap2.name).toBe('Alice'); // internal state unchanged
  });

  it('multiple addNode calls are accumulated', async () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'a', action: () => ({ counter: 1 }), autoAdvance: true })
      .addNode({ id: 'b', action: () => ({ counter: 2 }), autoAdvance: true })
      .addNode({ id: 'c', action: () => ({ counter: 3 }), autoAdvance: true })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', END)
      .compile({ id: 'builder-multi-node' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.counter).toBe(6); // 1+2+3
  });

  it('works without an explicit registry (uses global default)', async () => {
    const State = z.object({
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    // Pass no registry — constructor falls back to global
    const graph = new ChatGraphBuilder({ schema: State })
      .addNode({ id: 'n', action: { message: 'hi' }, autoAdvance: true })
      .addEdge(START, 'n')
      .addEdge('n', END)
      .compile({ id: 'builder-no-registry' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toContain('hi');
  });
});

// ---------------------------------------------------------------------------
// ChatGraph (JSON config)
// ---------------------------------------------------------------------------

describe('ChatGraph (JSON Config)', () => {
  it('creates and runs a minimal graph', async () => {
    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'json-minimal',
      schema: State,
      registry,
      nodes: [{ id: 'only', action: { message: 'hello' }, autoAdvance: true }],
      edges: [
        { from: START, to: 'only' },
        { from: 'only', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(true);
  });

  it('isDone is false before invoke', () => {
    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'json-isdone-init',
      schema: State,
      registry,
      nodes: [{ id: 'n', action: () => ({}), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    expect(graph.isDone).toBe(false);
  });

  it('state getter returns a snapshot (not a live reference)', async () => {
    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'json-state-copy',
      schema: State,
      registry,
      nodes: [{ id: 'n', action: () => ({ name: 'Bob' }), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    const snap = graph.state;
    (snap as any).name = 'Mutated';
    expect(graph.state.name).toBe('Bob');
  });

  it('uses initialState to pre-populate fields', async () => {
    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'json-initial-state',
      schema: State,
      registry,
      initialState: { name: 'Preset', counter: 50 },
      nodes: [{ id: 'noop', action: () => ({}), autoAdvance: true }],
      edges: [
        { from: START, to: 'noop' },
        { from: 'noop', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.name).toBe('Preset');
    expect(graph.state.counter).toBe(50);
  });

  it('single-node graph with no validate finishes in two invokes', async () => {
    // a non-autoAdvance node requires action invoke + validation invoke
    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'json-single-node',
      schema: State,
      registry,
      nodes: [{ id: 'ask', action: { message: 'Hi' }, validate: null }],
      edges: [
        { from: START, to: 'ask' },
        { from: 'ask', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(false);

    await graph.invoke({ userMessage: 'anything' });
    expect(graph.isDone).toBe(true);
  });

  it('two instances with the same ID are independent (no shared state)', async () => {
    const State = makeSchema();
    const g1 = new ChatGraph({
      id: 'shared-id',
      schema: State,
      registry,
      nodes: [{ id: 'n', action: () => ({ counter: 1 }), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    const g2 = new ChatGraph({
      id: 'shared-id',
      schema: State,
      registry,
      nodes: [{ id: 'n', action: () => ({ counter: 99 }), autoAdvance: true }],
      edges: [
        { from: START, to: 'n' },
        { from: 'n', to: END },
      ],
    });

    await g1.invoke({ userMessage: '' });
    await g2.invoke({ userMessage: '' });

    expect(g1.state.counter).toBe(1);
    expect(g2.state.counter).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Builder vs JSON — equivalent output
// ---------------------------------------------------------------------------

describe('Builder vs JSON — equivalent behaviour', () => {
  const runGraph = async (
    graph: ChatGraph<any> | ReturnType<ChatGraphBuilder<any, any>['compile']>
  ) => {
    await (graph as ChatGraph<any>).invoke({ userMessage: '' });
    return (graph as ChatGraph<any>).state;
  };

  it('both patterns produce the same state after execution', async () => {
    const State = makeSchema();

    const jsonGraph = new ChatGraph({
      id: 'equiv-json',
      schema: State,
      registry,
      nodes: [
        {
          id: 'a',
          action: () => ({ name: 'X', counter: 5 }),
          autoAdvance: true,
        },
        { id: 'b', action: () => ({ counter: 3 }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: END },
      ],
    });

    const builderGraph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'a',
        action: () => ({ name: 'X', counter: 5 }),
        autoAdvance: true,
      })
      .addNode({ id: 'b', action: () => ({ counter: 3 }), autoAdvance: true })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', END)
      .compile({ id: 'equiv-builder' });

    const [js, bs] = await Promise.all([
      runGraph(jsonGraph),
      runGraph(builderGraph),
    ]);

    expect(js.name).toBe(bs.name);
    expect(js.counter).toBe(bs.counter);
    expect(js.messages).toEqual(bs.messages);
  });
});

// ---------------------------------------------------------------------------
// autoSave option
// ---------------------------------------------------------------------------

describe('autoSave option', () => {
  it('autoSave: true with storageAdapter saves snapshots automatically', async () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'autosave-on',
      schema: State,
      registry,
      storageAdapter: storage,
      autoSave: true,
      nodes: [
        { id: 'a', action: () => ({ name: 'saved' }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'a' },
        { from: 'a', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    const count = await storage.getSnapshotCount('autosave-on');
    expect(count).toBeGreaterThan(0);
  });

  it('autoSave: false — no snapshots written', async () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'autosave-off',
      schema: State,
      registry,
      storageAdapter: storage,
      autoSave: false,
      nodes: [
        { id: 'a', action: () => ({ name: 'nosave' }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'a' },
        { from: 'a', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    const count = await storage.getSnapshotCount('autosave-off');
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Large number of nodes
// ---------------------------------------------------------------------------

describe('Graph with many nodes', () => {
  it('executes 20 sequential autoAdvance nodes correctly', async () => {
    const State = z.object({
      counter: z.number().registerReducer(registry, {
        reducer: { fn: (p, n) => p + n },
        default: () => 0,
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const N = 20;
    const nodes = Array.from({ length: N }, (_, i) => ({
      id: `n${i}`,
      action: () => ({ counter: 1 }),
      autoAdvance: true as const,
    }));

    const edges = [
      { from: START, to: 'n0' },
      ...Array.from({ length: N - 1 }, (_, i) => ({
        from: `n${i}`,
        to: `n${i + 1}`,
      })),
      { from: `n${N - 1}`, to: END },
    ];

    const graph = new ChatGraph({
      id: 'large-graph',
      schema: State,
      registry,
      nodes,
      edges,
    });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.counter).toBe(N);
    expect(graph.isDone).toBe(true);
  });
});
