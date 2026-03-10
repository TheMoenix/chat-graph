/**
 * Edge Tests
 *
 * Tests every edge & routing capability:
 * - Simple string edges
 * - Function router edges (sync & async)
 * - StaticRouter (JSON) with ALL 11 operators:
 *     equals, not_equals, gt, gte, lt, lte,
 *     contains (string & array), not_contains (string & array),
 *     regex, in, not_in
 * - StaticRouter default fallback
 * - Conditions evaluated in order (first match wins)
 * - Missing edge falls through to END
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  ChatGraph,
  ChatGraphBuilder,
  START,
  END,
  InferState,
  registry,
} from '../src';
import { MemoryStorageAdapter } from '../src/persistence/memory-adapter';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const makeSchema = () =>
  z.object({
    value: z.number().default(0),
    text: z.string().default(''),
    tags: z.array(z.string()).default([]),
    result: z.string().default(''),
    path: z.array(z.string()).registerReducer(registry, {
      reducer: { fn: (p, n) => p.concat(n) },
      default: () => [],
    }),
    messages: z.array(z.string()).registerReducer(registry, {
      reducer: { fn: (p, n) => p.concat(n) },
      default: () => [],
    }),
  });

type Schema = ReturnType<typeof makeSchema>;

// ---------------------------------------------------------------------------
// Simple string edges
// ---------------------------------------------------------------------------

describe('Simple String Edges', () => {
  it('routes START → single node → END', async () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'only',
        action: () => ({ path: ['only'] }),
        autoAdvance: true,
      })
      .addEdge(START, 'only')
      .addEdge('only', END)
      .compile({ id: 'edge-single' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.path).toEqual(['only']);
    expect(graph.isDone).toBe(true);
  });

  it('routes through a linear chain of five nodes', async () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'a', action: () => ({ path: ['a'] }), autoAdvance: true })
      .addNode({ id: 'b', action: () => ({ path: ['b'] }), autoAdvance: true })
      .addNode({ id: 'c', action: () => ({ path: ['c'] }), autoAdvance: true })
      .addNode({ id: 'd', action: () => ({ path: ['d'] }), autoAdvance: true })
      .addNode({ id: 'e', action: () => ({ path: ['e'] }), autoAdvance: true })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', 'd')
      .addEdge('d', 'e')
      .addEdge('e', END)
      .compile({ id: 'edge-chain-5' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.path).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('missing edge falls through to END', async () => {
    // 'orphan' has no outgoing edge — graph should reach END
    const State = makeSchema();
    const graph = new ChatGraph({
      id: 'edge-missing',
      schema: State,
      registry,
      nodes: [
        {
          id: 'orphan',
          action: () => ({ path: ['orphan'] }),
          autoAdvance: true,
        },
      ],
      edges: [{ from: START, to: 'orphan' }],
      // No edge from 'orphan'
    });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(true);
    expect(graph.state.path).toContain('orphan');
  });
});

// ---------------------------------------------------------------------------
// Function router edges (sync)
// ---------------------------------------------------------------------------

describe('Function Router Edges (Sync)', () => {
  it('routes to "left" when state.value < 5', async () => {
    const State = makeSchema();
    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'set', action: () => ({ value: 3 }), autoAdvance: true })
      .addNode({
        id: 'left',
        action: () => ({ result: 'left' }),
        autoAdvance: true,
      })
      .addNode({
        id: 'right',
        action: () => ({ result: 'right' }),
        autoAdvance: true,
      })
      .addEdge(START, 'set')
      .addEdge('set', (state: InferState<Schema>) =>
        state.value < 5 ? 'left' : 'right'
      )
      .addEdge('left', END)
      .addEdge('right', END)
      .compile({ id: 'fn-router-left' });

    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('left');
  });

  it('routes to "right" when state.value >= 5', async () => {
    const State = makeSchema();
    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'set', action: () => ({ value: 10 }), autoAdvance: true })
      .addNode({
        id: 'left',
        action: () => ({ result: 'left' }),
        autoAdvance: true,
      })
      .addNode({
        id: 'right',
        action: () => ({ result: 'right' }),
        autoAdvance: true,
      })
      .addEdge(START, 'set')
      .addEdge('set', (state: InferState<Schema>) =>
        state.value < 5 ? 'left' : 'right'
      )
      .addEdge('left', END)
      .addEdge('right', END)
      .compile({ id: 'fn-router-right' });

    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('right');
  });

  it('function router can return END directly', async () => {
    const State = makeSchema();
    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'decide', action: () => ({}), autoAdvance: true })
      .addNode({
        id: 'other',
        action: () => ({ result: 'other' }),
        autoAdvance: true,
      })
      .addEdge(START, 'decide')
      .addEdge('decide', () => END)
      .addEdge('other', END)
      .compile({ id: 'fn-router-to-end' });

    await g.invoke({ userMessage: '' });
    expect(g.isDone).toBe(true);
    expect(g.state.result).toBe(''); // 'other' was never executed
  });

  it('routes through three-way branch based on string value', async () => {
    const State = makeSchema();
    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'set', action: () => ({ text: 'b' }), autoAdvance: true })
      .addNode({
        id: 'nodeA',
        action: () => ({ result: 'A' }),
        autoAdvance: true,
      })
      .addNode({
        id: 'nodeB',
        action: () => ({ result: 'B' }),
        autoAdvance: true,
      })
      .addNode({
        id: 'nodeC',
        action: () => ({ result: 'C' }),
        autoAdvance: true,
      })
      .addEdge(START, 'set')
      .addEdge('set', (state: InferState<Schema>) => {
        if (state.text === 'a') return 'nodeA';
        if (state.text === 'b') return 'nodeB';
        return 'nodeC';
      })
      .addEdge('nodeA', END)
      .addEdge('nodeB', END)
      .addEdge('nodeC', END)
      .compile({ id: 'fn-router-3way' });

    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// Function router edges (async)
// ---------------------------------------------------------------------------

describe('Function Router Edges (Async)', () => {
  it('awaits an async router function', async () => {
    const State = makeSchema();
    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'set', action: () => ({ value: 42 }), autoAdvance: true })
      .addNode({
        id: 'big',
        action: () => ({ result: 'big' }),
        autoAdvance: true,
      })
      .addNode({
        id: 'small',
        action: () => ({ result: 'small' }),
        autoAdvance: true,
      })
      .addEdge(START, 'set')
      .addEdge('set', async (state: InferState<Schema>) => {
        await new Promise((r) => setTimeout(r, 5));
        return state.value > 10 ? 'big' : 'small';
      })
      .addEdge('big', END)
      .addEdge('small', END)
      .compile({ id: 'async-router' });

    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('big');
  });
});

// ---------------------------------------------------------------------------
// StaticRouter (JSON) — all 11 operators
// ---------------------------------------------------------------------------

describe('StaticRouter — equals / not_equals', () => {
  let storage: MemoryStorageAdapter;
  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    storage.clearAll();
  });

  const makeStringGraph = (
    fieldValue: string,
    operator: 'equals' | 'not_equals',
    compareValue: string,
    trueNode: string,
    falseNode: string,
    id: string
  ) => {
    const schema = makeSchema();
    return new ChatGraph({
      id,
      schema,
      registry,
      storageAdapter: storage,
      nodes: [
        { id: 'set', action: () => ({ text: fieldValue }), autoAdvance: true },
        { id: 'yes', action: () => ({ result: 'yes' }), autoAdvance: true },
        { id: 'no', action: () => ({ result: 'no' }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'set' },
        {
          from: 'set',
          to: {
            conditions: [
              { field: 'text', operator, value: compareValue, goto: trueNode },
            ],
            default: falseNode,
          },
        },
        { from: 'yes', to: END },
        { from: 'no', to: END },
      ],
    });
  };

  it('equals: routes to "yes" when field matches', async () => {
    const g = makeStringGraph(
      'hello',
      'equals',
      'hello',
      'yes',
      'no',
      'sr-eq-match'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('equals: routes to "no" when field does not match', async () => {
    const g = makeStringGraph(
      'world',
      'equals',
      'hello',
      'yes',
      'no',
      'sr-eq-no-match'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });

  it('not_equals: routes to "yes" when field differs', async () => {
    const g = makeStringGraph(
      'world',
      'not_equals',
      'hello',
      'yes',
      'no',
      'sr-neq-match'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('not_equals: routes to "no" when field is same', async () => {
    const g = makeStringGraph(
      'hello',
      'not_equals',
      'hello',
      'yes',
      'no',
      'sr-neq-no-match'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });
});

describe('StaticRouter — gt / gte / lt / lte (numeric)', () => {
  let storage: MemoryStorageAdapter;
  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    storage.clearAll();
  });

  const makeNumGraph = (
    fieldValue: number,
    operator: 'gt' | 'gte' | 'lt' | 'lte',
    compareValue: number,
    id: string
  ) => {
    const schema = makeSchema();
    return new ChatGraph({
      id,
      schema,
      registry,
      storageAdapter: storage,
      nodes: [
        { id: 'set', action: () => ({ value: fieldValue }), autoAdvance: true },
        { id: 'yes', action: () => ({ result: 'yes' }), autoAdvance: true },
        { id: 'no', action: () => ({ result: 'no' }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'set' },
        {
          from: 'set',
          to: {
            conditions: [
              { field: 'value', operator, value: compareValue, goto: 'yes' },
            ],
            default: 'no',
          },
        },
        { from: 'yes', to: END },
        { from: 'no', to: END },
      ],
    });
  };

  it('gt: 10 > 5 → yes', async () => {
    const g = makeNumGraph(10, 'gt', 5, 'sr-gt-yes');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('gt: 5 > 5 → no', async () => {
    const g = makeNumGraph(5, 'gt', 5, 'sr-gt-no');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });

  it('gte: 5 >= 5 → yes', async () => {
    const g = makeNumGraph(5, 'gte', 5, 'sr-gte-equal');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('gte: 4 >= 5 → no', async () => {
    const g = makeNumGraph(4, 'gte', 5, 'sr-gte-no');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });

  it('lt: 3 < 5 → yes', async () => {
    const g = makeNumGraph(3, 'lt', 5, 'sr-lt-yes');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('lt: 5 < 5 → no', async () => {
    const g = makeNumGraph(5, 'lt', 5, 'sr-lt-no');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });

  it('lte: 5 <= 5 → yes', async () => {
    const g = makeNumGraph(5, 'lte', 5, 'sr-lte-equal');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('lte: 6 <= 5 → no', async () => {
    const g = makeNumGraph(6, 'lte', 5, 'sr-lte-no');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });
});

describe('StaticRouter — contains / not_contains (string)', () => {
  let storage: MemoryStorageAdapter;
  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    storage.clearAll();
  });

  const makeContainsGraph = (
    fieldValue: string,
    operator: 'contains' | 'not_contains',
    needle: string,
    id: string
  ) => {
    const schema = makeSchema();
    return new ChatGraph({
      id,
      schema,
      registry,
      storageAdapter: storage,
      nodes: [
        { id: 'set', action: () => ({ text: fieldValue }), autoAdvance: true },
        { id: 'yes', action: () => ({ result: 'yes' }), autoAdvance: true },
        { id: 'no', action: () => ({ result: 'no' }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'set' },
        {
          from: 'set',
          to: {
            conditions: [
              { field: 'text', operator, value: needle, goto: 'yes' },
            ],
            default: 'no',
          },
        },
        { from: 'yes', to: END },
        { from: 'no', to: END },
      ],
    });
  };

  it('contains: "hello world" contains "world" → yes', async () => {
    const g = makeContainsGraph(
      'hello world',
      'contains',
      'world',
      'sr-contains-str-yes'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('contains: "hello world" does not contain "xyz" → no', async () => {
    const g = makeContainsGraph(
      'hello world',
      'contains',
      'xyz',
      'sr-contains-str-no'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });

  it('not_contains: "hello" does not contain "xyz" → yes', async () => {
    const g = makeContainsGraph(
      'hello',
      'not_contains',
      'xyz',
      'sr-not-contains-str-yes'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('not_contains: "hello world" contains "world" → no', async () => {
    const g = makeContainsGraph(
      'hello world',
      'not_contains',
      'world',
      'sr-not-contains-str-no'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });
});

describe('StaticRouter — contains / not_contains (array)', () => {
  let storage: MemoryStorageAdapter;
  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    storage.clearAll();
  });

  const makeArrayContainsGraph = (
    tags: string[],
    operator: 'contains' | 'not_contains',
    needle: string,
    id: string
  ) => {
    const schema = makeSchema();
    return new ChatGraph({
      id,
      schema,
      registry,
      storageAdapter: storage,
      nodes: [
        { id: 'set', action: () => ({ tags }), autoAdvance: true },
        { id: 'yes', action: () => ({ result: 'yes' }), autoAdvance: true },
        { id: 'no', action: () => ({ result: 'no' }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'set' },
        {
          from: 'set',
          to: {
            conditions: [
              { field: 'tags', operator, value: needle, goto: 'yes' },
            ],
            default: 'no',
          },
        },
        { from: 'yes', to: END },
        { from: 'no', to: END },
      ],
    });
  };

  it('contains (array): ["a","b"] contains "b" → yes', async () => {
    const g = makeArrayContainsGraph(
      ['a', 'b'],
      'contains',
      'b',
      'sr-arr-contains-yes'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('contains (array): ["a","b"] does not contain "c" → no', async () => {
    const g = makeArrayContainsGraph(
      ['a', 'b'],
      'contains',
      'c',
      'sr-arr-contains-no'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });

  it('not_contains (array): ["x"] does not contain "z" → yes', async () => {
    const g = makeArrayContainsGraph(
      ['x'],
      'not_contains',
      'z',
      'sr-arr-not-contains-yes'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('not_contains (array): ["x","y"] contains "x" → no', async () => {
    const g = makeArrayContainsGraph(
      ['x', 'y'],
      'not_contains',
      'x',
      'sr-arr-not-contains-no'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });
});

describe('StaticRouter — regex operator', () => {
  let storage: MemoryStorageAdapter;
  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    storage.clearAll();
  });

  const makeRegexGraph = (fieldValue: string, pattern: string, id: string) => {
    const schema = makeSchema();
    return new ChatGraph({
      id,
      schema,
      registry,
      storageAdapter: storage,
      nodes: [
        { id: 'set', action: () => ({ text: fieldValue }), autoAdvance: true },
        { id: 'yes', action: () => ({ result: 'yes' }), autoAdvance: true },
        { id: 'no', action: () => ({ result: 'no' }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'set' },
        {
          from: 'set',
          to: {
            conditions: [
              { field: 'text', operator: 'regex', value: pattern, goto: 'yes' },
            ],
            default: 'no',
          },
        },
        { from: 'yes', to: END },
        { from: 'no', to: END },
      ],
    });
  };

  it('regex: email pattern matches an email string → yes', async () => {
    const g = makeRegexGraph(
      'user@example.com',
      '\\S+@\\S+\\.\\S+',
      'sr-regex-email-yes'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('regex: email pattern does not match plain text → no', async () => {
    const g = makeRegexGraph(
      'not-an-email',
      '\\S+@\\S+\\.\\S+',
      'sr-regex-email-no'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });

  it('regex: numeric pattern matches digit-only string → yes', async () => {
    const g = makeRegexGraph('12345', '^\\d+$', 'sr-regex-digits-yes');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });
});

describe('StaticRouter — in / not_in operators', () => {
  let storage: MemoryStorageAdapter;
  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    storage.clearAll();
  });

  const makeInGraph = (
    fieldValue: string,
    operator: 'in' | 'not_in',
    list: string[],
    id: string
  ) => {
    const schema = makeSchema();
    return new ChatGraph({
      id,
      schema,
      registry,
      storageAdapter: storage,
      nodes: [
        { id: 'set', action: () => ({ text: fieldValue }), autoAdvance: true },
        { id: 'yes', action: () => ({ result: 'yes' }), autoAdvance: true },
        { id: 'no', action: () => ({ result: 'no' }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'set' },
        {
          from: 'set',
          to: {
            conditions: [{ field: 'text', operator, value: list, goto: 'yes' }],
            default: 'no',
          },
        },
        { from: 'yes', to: END },
        { from: 'no', to: END },
      ],
    });
  };

  it('in: "apple" is in ["apple","banana"] → yes', async () => {
    const g = makeInGraph('apple', 'in', ['apple', 'banana'], 'sr-in-yes');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('in: "cherry" is not in ["apple","banana"] → no', async () => {
    const g = makeInGraph('cherry', 'in', ['apple', 'banana'], 'sr-in-no');
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });

  it('not_in: "cherry" is not in ["apple","banana"] → yes', async () => {
    const g = makeInGraph(
      'cherry',
      'not_in',
      ['apple', 'banana'],
      'sr-not-in-yes'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('yes');
  });

  it('not_in: "apple" is in ["apple","banana"] → no', async () => {
    const g = makeInGraph(
      'apple',
      'not_in',
      ['apple', 'banana'],
      'sr-not-in-no'
    );
    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('no');
  });
});

// ---------------------------------------------------------------------------
// StaticRouter — default fallback & condition order
// ---------------------------------------------------------------------------

describe('StaticRouter — default fallback & condition ordering', () => {
  let storage: MemoryStorageAdapter;
  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    storage.clearAll();
  });

  it('uses the default when no condition matches', async () => {
    const schema = makeSchema();
    const g = new ChatGraph({
      id: 'sr-default',
      schema,
      registry,
      storageAdapter: storage,
      nodes: [
        { id: 'set', action: () => ({ text: 'zzz' }), autoAdvance: true },
        {
          id: 'matched',
          action: () => ({ result: 'matched' }),
          autoAdvance: true,
        },
        {
          id: 'fallback',
          action: () => ({ result: 'fallback' }),
          autoAdvance: true,
        },
      ],
      edges: [
        { from: START, to: 'set' },
        {
          from: 'set',
          to: {
            conditions: [
              {
                field: 'text',
                operator: 'equals',
                value: 'hello',
                goto: 'matched',
              },
            ],
            default: 'fallback',
          },
        },
        { from: 'matched', to: END },
        { from: 'fallback', to: END },
      ],
    });

    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('fallback');
  });

  it('evaluates conditions in order — first match wins', async () => {
    const schema = makeSchema();
    const g = new ChatGraph({
      id: 'sr-order',
      schema,
      registry,
      storageAdapter: storage,
      nodes: [
        { id: 'set', action: () => ({ value: 7 }), autoAdvance: true },
        { id: 'gt5', action: () => ({ result: 'gt5' }), autoAdvance: true },
        { id: 'gt3', action: () => ({ result: 'gt3' }), autoAdvance: true },
        { id: 'other', action: () => ({ result: 'other' }), autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'set' },
        {
          from: 'set',
          to: {
            conditions: [
              { field: 'value', operator: 'gt', value: 5, goto: 'gt5' }, // evaluated first
              { field: 'value', operator: 'gt', value: 3, goto: 'gt3' }, // would also match but second
            ],
            default: 'other',
          },
        },
        { from: 'gt5', to: END },
        { from: 'gt3', to: END },
        { from: 'other', to: END },
      ],
    });

    await g.invoke({ userMessage: '' });
    expect(g.state.result).toBe('gt5'); // first matching condition wins
  });

  it('default is END — graph terminates without running extra nodes', async () => {
    const schema = makeSchema();
    const g = new ChatGraph({
      id: 'sr-default-end',
      schema,
      registry,
      storageAdapter: storage,
      nodes: [
        { id: 'set', action: () => ({ text: 'nope' }), autoAdvance: true },
        {
          id: 'matched',
          action: () => ({ result: 'matched' }),
          autoAdvance: true,
        },
      ],
      edges: [
        { from: START, to: 'set' },
        {
          from: 'set',
          to: {
            conditions: [
              {
                field: 'text',
                operator: 'equals',
                value: 'yes',
                goto: 'matched',
              },
            ],
            default: END,
          },
        },
        { from: 'matched', to: END },
      ],
    });

    await g.invoke({ userMessage: '' });
    expect(g.isDone).toBe(true);
    expect(g.state.result).toBe(''); // 'matched' never ran
  });
});
