/**
 * Per-turn output tests (Spec 01 — Change 1)
 *
 * `emittedMessages` answers "what did this turn produce", a question
 * `state.messages` cannot answer under either merge configuration:
 * - schemaless, arrays concatenate, so state.messages accumulates forever
 * - a `(prev, next) => next` reducer drops all but the last node of a turn
 *
 * Both must report identical per-turn output.
 */

import { describe, it, expect } from '@jest/globals';
import { ChatGraph, START, END, registry } from '../src';
import { MemoryStorageAdapter } from '../src/persistence/memory-adapter';
import { z } from 'zod';

const State = z.object({
  name: z.string().optional(),
  city: z.string().optional(),
  messages: z.array(z.string()).registerReducer(registry, {
    reducer: { fn: (_prev: string[], next: string[]) => next },
    default: () => [] as string[],
  }),
});

const nodes = [
  {
    id: 'ask_name',
    action: { message: 'Hi! Your name?' },
    validate: { rules: [], answerKey: 'name' },
  },
  { id: 'info1', action: { message: 'Thanks {{name}}.' }, autoAdvance: true },
  {
    id: 'info2',
    action: { message: 'Second line, SAME invoke.' },
    autoAdvance: true,
  },
  {
    id: 'ask_city',
    action: { message: 'Your city?' },
    validate: { rules: [], answerKey: 'city' },
  },
];

const edges = [
  { from: START, to: 'ask_name' },
  { from: 'ask_name', to: 'info1' },
  { from: 'info1', to: 'info2' },
  { from: 'info2', to: 'ask_city' },
  { from: 'ask_city', to: END },
];

/** Runs the three-turn conversation on a fresh graph per turn, as a stateless host would. */
const runTurns = async (
  id: string,
  config: Record<string, unknown>
): Promise<string[][]> => {
  const storage = new MemoryStorageAdapter();
  const emitted: string[][] = [];

  for (const userMessage of ['hello', 'Ali', 'Riyadh']) {
    const graph = new ChatGraph<any, any>({
      id,
      storageAdapter: storage,
      nodes: nodes as any,
      edges: edges as any,
      ...config,
    });
    await graph.invoke({ userMessage });
    emitted.push(graph.emittedMessages);
  }

  return emitted;
};

const EXPECTED = [
  ['Hi! Your name?'],
  ['Thanks Ali.', 'Second line, SAME invoke.', 'Your city?'],
  [],
];

describe('emittedMessages', () => {
  it('reports per-turn output without a schema (state.messages accumulates)', async () => {
    expect(await runTurns('flowA', {})).toEqual(EXPECTED);
  });

  it('reports per-turn output with a replace reducer (state.messages is overwritten)', async () => {
    expect(await runTurns('flowB', { schema: State, registry })).toEqual(
      EXPECTED
    );
  });

  it('crosses autoAdvance nodes that a replace reducer would drop from state', async () => {
    const storage = new MemoryStorageAdapter();
    const make = (): ChatGraph<any, any> =>
      new ChatGraph<any, any>({
        id: 'flowC',
        storageAdapter: storage,
        schema: State,
        registry,
        nodes: nodes as any,
        edges: edges as any,
      });

    await make().invoke({ userMessage: 'hello' });

    const second = make();
    await second.invoke({ userMessage: 'Ali' });

    // state keeps only the last node's output, emitted keeps the whole turn
    expect(second.state.messages).toEqual(['Your city?']);
    expect(second.emittedMessages).toEqual([
      'Thanks Ali.',
      'Second line, SAME invoke.',
      'Your city?',
    ]);
  });

  it('includes validation error messages', async () => {
    const graph = new ChatGraph<any, any>({
      id: 'flowD',
      nodes: [
        {
          id: 'ask_age',
          action: { message: 'Age?' },
          validate: {
            rules: [{ regex: '^\\d+$', errorMessage: 'Numbers only.' }],
            answerKey: 'age',
          },
        },
      ] as any,
      edges: [
        { from: START, to: 'ask_age' },
        { from: 'ask_age', to: END },
      ] as any,
    });

    await graph.invoke({ userMessage: 'hi' });
    expect(graph.emittedMessages).toEqual(['Age?']);

    await graph.invoke({ userMessage: 'not a number' });
    expect(graph.emittedMessages).toEqual(['Numbers only.']);
  });

  it('is empty before the first turn', () => {
    const graph = new ChatGraph<any, any>({
      id: 'flowE',
      nodes: nodes as any,
      edges: edges as any,
    });

    expect(graph.emittedMessages).toEqual([]);
  });

  it('is not restored from a snapshot', async () => {
    const storage = new MemoryStorageAdapter();
    const make = (): ChatGraph<any, any> =>
      new ChatGraph<any, any>({
        id: 'flowF',
        storageAdapter: storage,
        nodes: nodes as any,
        edges: edges as any,
      });

    const first = make();
    await first.invoke({ userMessage: 'hello' });
    expect(first.emittedMessages).toEqual(['Hi! Your name?']);

    const restored = make();
    expect(await restored.restoreFromSnapshot()).toBe(true);
    expect(restored.emittedMessages).toEqual([]);
    // the restored state still carries the accumulated history
    expect(restored.state.messages).toEqual(['Hi! Your name?']);
  });

  it('does not leak across turns on the same instance', async () => {
    const graph = new ChatGraph<any, any>({
      id: 'flowG',
      nodes: nodes as any,
      edges: edges as any,
    });

    await graph.invoke({ userMessage: 'hello' });
    await graph.invoke({ userMessage: 'Ali' });

    expect(graph.emittedMessages).toEqual([
      'Thanks Ali.',
      'Second line, SAME invoke.',
      'Your city?',
    ]);
  });

  it('returns a copy that callers cannot mutate', async () => {
    const graph = new ChatGraph<any, any>({
      id: 'flowH',
      nodes: nodes as any,
      edges: edges as any,
    });

    await graph.invoke({ userMessage: 'hello' });
    graph.emittedMessages.push('injected');

    expect(graph.emittedMessages).toEqual(['Hi! Your name?']);
  });
});
