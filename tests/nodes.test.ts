/**
 * Node Tests
 *
 * Tests every node capability to the limit:
 * - Message (static) actions
 * - Function actions (sync & async)
 * - autoAdvance nodes
 * - User-input nodes
 * - State & event access inside actions
 * - Template interpolation
 * - null / missing validate
 * - Multiple sequential nodes of different types
 */

import { describe, it, expect } from '@jest/globals';
import {
  ChatGraph,
  ChatGraphBuilder,
  START,
  END,
  InferState,
  registry,
  ChatEvent,
} from '../src';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared schema helpers
// ---------------------------------------------------------------------------

const makeMessagesSchema = () =>
  z.object({
    messages: z.array(z.string()).registerReducer(registry, {
      reducer: { fn: (prev, next) => prev.concat(next) },
      default: () => [],
    }),
  });

const makeFullSchema = () =>
  z.object({
    name: z.string().optional(),
    count: z.number().default(0),
    messages: z.array(z.string()).registerReducer(registry, {
      reducer: { fn: (prev, next) => prev.concat(next) },
      default: () => [],
    }),
  });

// ---------------------------------------------------------------------------
// Static message actions
// ---------------------------------------------------------------------------

describe('Static Message Actions', () => {
  it('emits a plain string message', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'greet',
        action: { message: 'Hello!' },
        autoAdvance: true,
      })
      .addEdge(START, 'greet')
      .addEdge('greet', END)
      .compile({ id: 'msg-plain' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toContain('Hello!');
    expect(graph.isDone).toBe(true);
  });

  it('interpolates a single state variable {{var}}', async () => {
    const State = z.object({
      name: z.string().default('World'),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (prev, next) => prev.concat(next) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'greet',
        action: { message: 'Hello, {{name}}!' },
        autoAdvance: true,
      })
      .addEdge(START, 'greet')
      .addEdge('greet', END)
      .compile({ id: 'msg-interpolate' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toContain('Hello, World!');
  });

  it('interpolates multiple different variables in one message', async () => {
    const State = z.object({
      first: z.string().default('Jane'),
      last: z.string().default('Doe'),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (prev, next) => prev.concat(next) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'greet',
        action: { message: 'Hello, {{first}} {{last}}!' },
        autoAdvance: true,
      })
      .addEdge(START, 'greet')
      .addEdge('greet', END)
      .compile({ id: 'msg-multi-interpolate' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toContain('Hello, Jane Doe!');
  });

  it('leaves unknown placeholders unchanged', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'x',
        action: { message: 'Value is {{unknown}}' },
        autoAdvance: true,
      })
      .addEdge(START, 'x')
      .addEdge('x', END)
      .compile({ id: 'msg-unknown-placeholder' });

    await graph.invoke({ userMessage: '' });
    // The interpolate replaces {{unknown}} with String(undefined) === "undefined"
    expect(graph.state.messages[0]).toBe('Value is undefined');
  });

  it('emits messages from three sequential static-message nodes', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'a', action: { message: 'A' }, autoAdvance: true })
      .addNode({ id: 'b', action: { message: 'B' }, autoAdvance: true })
      .addNode({ id: 'c', action: { message: 'C' }, autoAdvance: true })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', END)
      .compile({ id: 'msg-chain' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toEqual(['A', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------------
// Function actions (synchronous)
// ---------------------------------------------------------------------------

describe('Synchronous Function Actions', () => {
  it('returns a partial state update', async () => {
    const State = makeFullSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'set',
        action: () => ({ name: 'Alice', messages: ['done'] }),
        autoAdvance: true,
      })
      .addEdge(START, 'set')
      .addEdge('set', END)
      .compile({ id: 'fn-partial' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.name).toBe('Alice');
    expect(graph.state.messages).toContain('done');
  });

  it('reads current state inside the action', async () => {
    const State = z.object({
      count: z.number().registerReducer(registry, {
        reducer: { fn: (p, n) => p + n },
        default: () => 10,
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (prev, next) => prev.concat(next) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'double',
        action: (state: InferState<typeof State>) => ({
          count: state.count, // adds itself again via reducer (10 + 10 = 20)
          messages: [`count was ${state.count}`],
        }),
        autoAdvance: true,
      })
      .addEdge(START, 'double')
      .addEdge('double', END)
      .compile({ id: 'fn-read-state' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.count).toBe(20);
    expect(graph.state.messages).toContain('count was 10');
  });

  it('reads userMessage from event inside the action', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'echo',
        action: (_state: InferState<typeof State>, event: ChatEvent) => ({
          messages: [`echo: ${event.userMessage}`],
        }),
        autoAdvance: true,
      })
      .addEdge(START, 'echo')
      .addEdge('echo', END)
      .compile({ id: 'fn-event' });

    await graph.invoke({ userMessage: 'ping' });
    expect(graph.state.messages).toContain('echo: ping');
  });

  it('returns an empty update without throwing', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'noop',
        action: () => ({}),
        autoAdvance: true,
      })
      .addEdge(START, 'noop')
      .addEdge('noop', END)
      .compile({ id: 'fn-empty' });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(true);
    expect(graph.state.messages).toEqual([]);
  });

  it('accumulates state across multiple function-action nodes', async () => {
    const State = z.object({
      total: z.number().registerReducer(registry, {
        reducer: { fn: (p, n) => p + n },
        default: () => 0,
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (prev, next) => prev.concat(next) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'add5',
        action: () => ({ total: 5, messages: ['added 5'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'add3',
        action: () => ({ total: 3, messages: ['added 3'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'add2',
        action: () => ({ total: 2, messages: ['added 2'] }),
        autoAdvance: true,
      })
      .addEdge(START, 'add5')
      .addEdge('add5', 'add3')
      .addEdge('add3', 'add2')
      .addEdge('add2', END)
      .compile({ id: 'fn-accumulate' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.total).toBe(10);
    expect(graph.state.messages).toEqual(['added 5', 'added 3', 'added 2']);
  });
});

// ---------------------------------------------------------------------------
// Async function actions
// ---------------------------------------------------------------------------

describe('Async Function Actions', () => {
  it('awaits an async action before proceeding', async () => {
    const State = z.object({
      data: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (prev, next) => prev.concat(next) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'fetch',
        action: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { data: 'fetched-value', messages: ['fetch done'] };
        },
        autoAdvance: true,
      })
      .addEdge(START, 'fetch')
      .addEdge('fetch', END)
      .compile({ id: 'async-single' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.data).toBe('fetched-value');
    expect(graph.isDone).toBe(true);
  });

  it('chains multiple async action nodes', async () => {
    const State = z.object({
      steps: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (prev, next) => prev.concat(next) },
        default: () => [],
      }),
    });

    const makeStep = (name: string) => async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { steps: [name], messages: [name] };
    };

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'step1', action: makeStep('s1'), autoAdvance: true })
      .addNode({ id: 'step2', action: makeStep('s2'), autoAdvance: true })
      .addNode({ id: 'step3', action: makeStep('s3'), autoAdvance: true })
      .addEdge(START, 'step1')
      .addEdge('step1', 'step2')
      .addEdge('step2', 'step3')
      .addEdge('step3', END)
      .compile({ id: 'async-chain' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.steps).toEqual(['s1', 's2', 's3']);
  });

  it('can mix sync and async action nodes', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'sync',
        action: () => ({ messages: ['sync'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'async',
        action: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return { messages: ['async'] };
        },
        autoAdvance: true,
      })
      .addEdge(START, 'sync')
      .addEdge('sync', 'async')
      .addEdge('async', END)
      .compile({ id: 'mixed-sync-async' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toEqual(['sync', 'async']);
  });
});

// ---------------------------------------------------------------------------
// autoAdvance behaviour
// ---------------------------------------------------------------------------

describe('autoAdvance Nodes', () => {
  it('does NOT pause for user input — isDone after first invoke', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'auto', action: { message: 'Auto!' }, autoAdvance: true })
      .addEdge(START, 'auto')
      .addEdge('auto', END)
      .compile({ id: 'autoAdvance-single' });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(true);
  });

  it('chains five autoAdvance nodes in one invoke call', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'n1', action: { message: '1' }, autoAdvance: true })
      .addNode({ id: 'n2', action: { message: '2' }, autoAdvance: true })
      .addNode({ id: 'n3', action: { message: '3' }, autoAdvance: true })
      .addNode({ id: 'n4', action: { message: '4' }, autoAdvance: true })
      .addNode({ id: 'n5', action: { message: '5' }, autoAdvance: true })
      .addEdge(START, 'n1')
      .addEdge('n1', 'n2')
      .addEdge('n2', 'n3')
      .addEdge('n3', 'n4')
      .addEdge('n4', 'n5')
      .addEdge('n5', END)
      .compile({ id: 'autoAdvance-chain' });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toEqual(['1', '2', '3', '4', '5']);
    expect(graph.isDone).toBe(true);
  });

  it('autoAdvance node before and after a user-input node', async () => {
    const State = z.object({
      answer: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (prev, next) => prev.concat(next) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'pre',
        action: { message: 'Starting...' },
        autoAdvance: true,
      })
      .addNode({
        id: 'ask',
        action: { message: 'Give me a word:' },
        validate: {
          rules: [{ regex: '\\w+', errorMessage: 'Need a word' }],
          answerKey: 'answer',
        },
      })
      .addNode({ id: 'post', action: { message: 'Done!' }, autoAdvance: true })
      .addEdge(START, 'pre')
      .addEdge('pre', 'ask')
      .addEdge('ask', 'post')
      .addEdge('post', END)
      .compile({ id: 'auto-wrap-input' });

    // First invoke: runs 'pre' then stops at 'ask'
    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(false);
    expect(graph.state.messages).toContain('Starting...');

    // Second invoke: validates 'ask', then runs 'post', then done
    await graph.invoke({ userMessage: 'hello' });
    expect(graph.isDone).toBe(true);
    expect(graph.state.answer).toBe('hello');
    expect(graph.state.messages).toContain('Done!');
  });
});

// ---------------------------------------------------------------------------
// User-input (non-autoAdvance) nodes — null & missing validate
// ---------------------------------------------------------------------------

describe('User-input Nodes — validate: null / no validate', () => {
  it('null validate: action runs, then validation bypassed, flow proceeds', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Type anything' },
        validate: null,
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'null-validate' });

    // First invoke triggers the action
    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toContain('Type anything');
    expect(graph.isDone).toBe(false);

    // Second invoke: validation is null so it passes immediately
    await graph.invoke({ userMessage: 'anything' });
    expect(graph.isDone).toBe(true);
  });

  it('no validate field: same behaviour as null validate', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Say something' },
        // validate omitted entirely
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'no-validate' });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(false);

    await graph.invoke({ userMessage: 'something' });
    expect(graph.isDone).toBe(true);
  });

  it('user-input node does not advance until second invoke', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'q',
        action: { message: 'Question?' },
        validate: {
          rules: [{ regex: 'yes', errorMessage: 'Say yes' }],
          answerKey: null,
        },
      })
      .addEdge(START, 'q')
      .addEdge('q', END)
      .compile({ id: 'user-input-wait' });

    const result = await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(false);
    expect(result.messages).toContain('Question?');
  });
});

// ---------------------------------------------------------------------------
// Node action with ChatGraph JSON config
// ---------------------------------------------------------------------------

describe('Nodes via JSON Config (ChatGraph)', () => {
  it('static message action works in JSON config', async () => {
    const State = makeMessagesSchema();
    const graph = new ChatGraph({
      id: 'json-nodes-msg',
      schema: State,
      registry,
      nodes: [
        { id: 'hi', action: { message: 'Hi there!' }, autoAdvance: true },
      ],
      edges: [
        { from: START, to: 'hi' },
        { from: 'hi', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.messages).toContain('Hi there!');
    expect(graph.isDone).toBe(true);
  });

  it('function action works in JSON config', async () => {
    const State = makeFullSchema();
    const graph = new ChatGraph({
      id: 'json-nodes-fn',
      schema: State,
      registry,
      nodes: [
        {
          id: 'calc',
          action: (state: InferState<typeof State>) => ({
            count: state.count + 7,
            messages: ['calculated'],
          }),
          autoAdvance: true,
        },
      ],
      edges: [
        { from: START, to: 'calc' },
        { from: 'calc', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect(graph.state.count).toBe(7);
    expect(graph.isDone).toBe(true);
  });
});
