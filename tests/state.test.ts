/**
 * State Management Tests
 *
 * Tests every aspect of state handling:
 * - No schema (plain shallow merge)
 * - Schema without reducer (replace semantics)
 * - Schema with a single reducer
 * - Schema with multiple reducers of different types
 * - Mixed fields: some reduced, some replaced
 * - Custom reducer logic (max, deduplicate, etc.)
 * - initialState overrides
 * - Zod defaults applied when no override
 * - Fields not in update remain untouched
 * - Empty update {}
 * - Template interpolation reads up-to-date state
 * - mergeState / createInitialState directly
 */

import { describe, it, expect } from '@jest/globals';
import {
  ChatGraph,
  ChatGraphBuilder,
  START,
  END,
  InferState,
  registry,
} from '../src';
import {
  createInitialState,
  mergeState,
  StateRegistry,
} from '../src/schema/state-schema';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const freshRegistry = () => new StateRegistry();

// ---------------------------------------------------------------------------
// No schema (plain merge)
// ---------------------------------------------------------------------------

describe('No Schema — shallow merge behaviour', () => {
  it('merges updates from sequential nodes (last write wins per key)', async () => {
    const graph = new ChatGraph({
      id: 'ns-merge',
      nodes: [
        { id: 'n1', action: () => ({ a: 1, b: 'first' }), autoAdvance: true },
        {
          id: 'n2',
          action: () => ({ b: 'second', c: true }),
          autoAdvance: true,
        },
      ],
      edges: [
        { from: START, to: 'n1' },
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect((graph.state as any).a).toBe(1);
    expect((graph.state as any).b).toBe('second'); // overwritten by n2
    expect((graph.state as any).c).toBe(true);
  });

  it('preserves keys not touched by subsequent nodes', async () => {
    const graph = new ChatGraph({
      id: 'ns-preserve',
      nodes: [
        {
          id: 'n1',
          action: () => ({ x: 'x-value', y: 'y-value' }),
          autoAdvance: true,
        },
        { id: 'n2', action: () => ({ z: 'z-value' }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'n1' },
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect((graph.state as any).x).toBe('x-value');
    expect((graph.state as any).y).toBe('y-value');
    expect((graph.state as any).z).toBe('z-value');
  });

  it('empty update does not disturb existing state', async () => {
    const graph = new ChatGraph({
      id: 'ns-empty-update',
      nodes: [
        { id: 'n1', action: () => ({ key: 'value' }), autoAdvance: true },
        { id: 'n2', action: () => ({}), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'n1' },
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect((graph.state as any).key).toBe('value');
  });
});

// ---------------------------------------------------------------------------
// Schema without reducers (replace semantics)
// ---------------------------------------------------------------------------

describe('Schema Without Reducers — replace semantics', () => {
  it('simple string field is replaced by each node', async () => {
    const State = z.object({
      status: z.string().default('idle'),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'n1',
        action: () => ({ status: 'started' }),
        autoAdvance: true,
      })
      .addNode({
        id: 'n2',
        action: () => ({ status: 'done' }),
        autoAdvance: true,
      })
      .addEdge(START, 'n1')
      .addEdge('n1', 'n2')
      .addEdge('n2', END)
      .compile({ id: 'schema-replace-str' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.status).toBe('done');
  });

  it('optional number field is replaced (not accumulated)', async () => {
    const State = z.object({
      score: z.number().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'n1', action: () => ({ score: 5 }), autoAdvance: true })
      .addNode({ id: 'n2', action: () => ({ score: 99 }), autoAdvance: true })
      .addEdge(START, 'n1')
      .addEdge('n1', 'n2')
      .addEdge('n2', END)
      .compile({ id: 'schema-replace-num' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.score).toBe(99); // replaced, not added
  });

  it('fields not in update are left untouched', async () => {
    const State = z.object({
      name: z.string().default('original'),
      tag: z.string().default('tag'),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'n1',
        action: () => ({ name: 'changed' }),
        autoAdvance: true,
      })
      .addEdge(START, 'n1')
      .addEdge('n1', END)
      .compile({ id: 'schema-field-untouched' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.name).toBe('changed');
    expect(graph.state.tag).toBe('tag'); // untouched
  });
});

// ---------------------------------------------------------------------------
// Schema with a single reducer
// ---------------------------------------------------------------------------

describe('Schema With Single Reducer', () => {
  it('number accumulator: adds values across nodes', async () => {
    const State = z.object({
      total: z.number().registerReducer(registry, {
        reducer: { fn: (p, n) => p + n },
        default: () => 0,
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'a', action: () => ({ total: 10 }), autoAdvance: true })
      .addNode({ id: 'b', action: () => ({ total: 20 }), autoAdvance: true })
      .addNode({ id: 'c', action: () => ({ total: 5 }), autoAdvance: true })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', END)
      .compile({ id: 'reducer-sum' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.total).toBe(35); // 0 + 10 + 20 + 5
  });

  it('string concatenation reducer', async () => {
    const State = z.object({
      log: z.string().registerReducer(registry, {
        reducer: { fn: (p, n) => `${p}${n}` },
        default: () => '',
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'a', action: () => ({ log: 'A' }), autoAdvance: true })
      .addNode({ id: 'b', action: () => ({ log: 'B' }), autoAdvance: true })
      .addNode({ id: 'c', action: () => ({ log: 'C' }), autoAdvance: true })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', END)
      .compile({ id: 'reducer-string-concat' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.log).toBe('ABC');
  });

  it('array concat reducer preserves insertion order', async () => {
    const State = z.object({
      items: z.array(z.number()).registerReducer(registry, {
        reducer: { fn: (p, n) => [...p, ...n] },
        default: () => [],
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'a',
        action: () => ({ items: [1, 2] }),
        autoAdvance: true,
      })
      .addNode({ id: 'b', action: () => ({ items: [3] }), autoAdvance: true })
      .addNode({
        id: 'c',
        action: () => ({ items: [4, 5] }),
        autoAdvance: true,
      })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', END)
      .compile({ id: 'reducer-array' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.items).toEqual([1, 2, 3, 4, 5]);
  });

  it('max reducer keeps the highest value', async () => {
    const reg = freshRegistry();
    const State = z.object({
      maxVal: z.number().registerReducer(reg, {
        reducer: { fn: (p, n) => Math.max(p, n) },
        default: () => 0,
      }),
      messages: z.array(z.string()).registerReducer(reg, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry: reg })
      .addNode({ id: 'a', action: () => ({ maxVal: 7 }), autoAdvance: true })
      .addNode({ id: 'b', action: () => ({ maxVal: 3 }), autoAdvance: true })
      .addNode({ id: 'c', action: () => ({ maxVal: 15 }), autoAdvance: true })
      .addNode({ id: 'd', action: () => ({ maxVal: 9 }), autoAdvance: true })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', 'd')
      .addEdge('d', END)
      .compile({ id: 'reducer-max' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.maxVal).toBe(15);
  });

  it('deduplication reducer keeps only unique strings', async () => {
    const reg = freshRegistry();
    const State = z.object({
      unique: z.array(z.string()).registerReducer(reg, {
        reducer: { fn: (p, n) => Array.from(new Set([...p, ...n])) },
        default: () => [],
      }),
      messages: z.array(z.string()).registerReducer(reg, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry: reg })
      .addNode({
        id: 'a',
        action: () => ({ unique: ['x', 'y'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'b',
        action: () => ({ unique: ['y', 'z'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'c',
        action: () => ({ unique: ['x', 'z', 'w'] }),
        autoAdvance: true,
      })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', END)
      .compile({ id: 'reducer-dedup' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.unique.sort()).toEqual(['w', 'x', 'y', 'z']);
  });
});

// ---------------------------------------------------------------------------
// Mixed fields (some reduced, some replaced)
// ---------------------------------------------------------------------------

describe('Mixed Fields — reduced & replaced', () => {
  it('counter accumulates while status is replaced', async () => {
    const State = z.object({
      status: z.string().optional(),
      counter: z.number().registerReducer(registry, {
        reducer: { fn: (p, n) => p + n },
        default: () => 0,
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'n1',
        action: () => ({ status: 'started', counter: 1, messages: ['n1'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'n2',
        action: () => ({ status: 'processing', counter: 4, messages: ['n2'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'n3',
        action: () => ({ status: 'done', counter: 5, messages: ['n3'] }),
        autoAdvance: true,
      })
      .addEdge(START, 'n1')
      .addEdge('n1', 'n2')
      .addEdge('n2', 'n3')
      .addEdge('n3', END)
      .compile({ id: 'mixed-reduce-replace' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.status).toBe('done'); // replaced
    expect(graph.state.counter).toBe(10); // 1 + 4 + 5
    expect(graph.state.messages).toEqual(['n1', 'n2', 'n3']); // reduced
  });

  it('empty update from one node does not reset reduced fields', async () => {
    const State = z.object({
      total: z.number().registerReducer(registry, {
        reducer: { fn: (p, n) => p + n },
        default: () => 0,
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'n1', action: () => ({ total: 10 }), autoAdvance: true })
      .addNode({ id: 'n2', action: () => ({}), autoAdvance: true }) // empty update
      .addNode({ id: 'n3', action: () => ({ total: 5 }), autoAdvance: true })
      .addEdge(START, 'n1')
      .addEdge('n1', 'n2')
      .addEdge('n2', 'n3')
      .addEdge('n3', END)
      .compile({ id: 'mixed-empty-middle' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.total).toBe(15); // 0+10+0+5
  });
});

// ---------------------------------------------------------------------------
// initialState overrides
// ---------------------------------------------------------------------------

describe('initialState Overrides', () => {
  it('preloads replaced field with initialState value', async () => {
    const State = z.object({
      name: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraph({
      id: 'init-replace',
      schema: State,
      registry,
      initialState: { name: 'Bob' },
      nodes: [{ id: 'noop', action: () => ({}), autoAdvance: true }],
      edges: [
        { from: START, to: 'noop' },
        { from: 'noop', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.name).toBe('Bob');
  });

  it('preloaded reduced field starts from the initialState value', async () => {
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

    const graph = new ChatGraph({
      id: 'init-reduced',
      schema: State,
      registry,
      initialState: { counter: 100 },
      nodes: [{ id: 'add', action: () => ({ counter: 5 }), autoAdvance: true }],
      edges: [
        { from: START, to: 'add' },
        { from: 'add', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.counter).toBe(105);
  });

  it('Zod schema defaults apply to fields absent from initialState', async () => {
    const State = z.object({
      name: z.string().default('DefaultName'),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraph({
      id: 'init-zod-default',
      schema: State,
      registry,
      // no initialState
      nodes: [{ id: 'noop', action: () => ({}), autoAdvance: true }],
      edges: [
        { from: START, to: 'noop' },
        { from: 'noop', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.name).toBe('DefaultName');
  });
});

// ---------------------------------------------------------------------------
// createInitialState and mergeState utility tests
// ---------------------------------------------------------------------------

describe('createInitialState utility', () => {
  it('returns overrides when no schema provided', () => {
    const state = createInitialState(undefined, undefined, { x: 1 });
    expect((state as any).x).toBe(1);
  });

  it('applies registry defaults for un-overridden fields', () => {
    const reg = freshRegistry();
    const State = z.object({
      count: z.number().registerReducer(reg, { default: () => 42 }),
      messages: z.array(z.string()).registerReducer(reg, { default: () => [] }),
    });

    const state = createInitialState(State, reg);
    expect(state.count).toBe(42);
    expect(state.messages).toEqual([]);
  });

  it('overrides take precedence over defaults', () => {
    const reg = freshRegistry();
    const State = z.object({
      count: z.number().registerReducer(reg, { default: () => 42 }),
      messages: z.array(z.string()).registerReducer(reg, { default: () => [] }),
    });

    const state = createInitialState(State, reg, { count: 99 });
    expect(state.count).toBe(99);
  });
});

describe('mergeState utility', () => {
  it('shallow merges when no schema provided', () => {
    const current = { a: 1, b: 2 } as any;
    const update = { b: 99, c: 3 } as any;
    const merged = mergeState(undefined, undefined, current, update);
    expect(merged).toEqual({ a: 1, b: 99, c: 3 });
  });

  it('applies reducer function when schema has one', () => {
    const reg = freshRegistry();
    const State = z.object({
      total: z.number().registerReducer(reg, {
        reducer: { fn: (p, n) => p + n },
        default: () => 0,
      }),
      messages: z.array(z.string()).registerReducer(reg, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const current = createInitialState(State, reg);
    const merged = mergeState(State, reg, current, { total: 7 } as any);
    expect(merged.total).toBe(7); // 0 + 7
  });

  it('replaces non-reduced field', () => {
    const reg = freshRegistry();
    const State = z.object({
      label: z.string().default('old'),
      messages: z.array(z.string()).registerReducer(reg, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const current = createInitialState(State, reg);
    const merged = mergeState(State, reg, current, { label: 'new' } as any);
    expect(merged.label).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// Template interpolation reads up-to-date state
// ---------------------------------------------------------------------------

describe('Template Interpolation With Reducers', () => {
  it('message template uses the state produced by the prior node', async () => {
    const State = z.object({
      username: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'setName',
        action: () => ({ username: 'Carol' }),
        autoAdvance: true,
      })
      .addNode({
        id: 'greet',
        action: { message: 'Welcome, {{username}}!' },
        autoAdvance: true,
      })
      .addEdge(START, 'setName')
      .addEdge('setName', 'greet')
      .addEdge('greet', END)
      .compile({ id: 'state-interp' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toContain('Welcome, Carol!');
  });

  it('counter is reflected in the message after reducer applied', async () => {
    const State = z.object({
      count: z.number().registerReducer(registry, {
        reducer: { fn: (p, n) => p + n },
        default: () => 0,
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'inc', action: () => ({ count: 3 }), autoAdvance: true })
      .addNode({
        id: 'report',
        action: (state: InferState<typeof State>) => ({
          messages: [`Count is ${state.count}`],
        }),
        autoAdvance: true,
      })
      .addEdge(START, 'inc')
      .addEdge('inc', 'report')
      .addEdge('report', END)
      .compile({ id: 'state-count-msg' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toContain('Count is 3');
  });
});
