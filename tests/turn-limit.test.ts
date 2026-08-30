/**
 * Per-turn work bound tests (Spec 01 — Change 4)
 *
 * Cyclic routing is a supported feature, so the guard bounds work per turn
 * rather than forbidding cycles: a cycle through a node that waits for input
 * must keep running forever, while a cycle of `autoAdvance` nodes — which
 * never yields — must fail fast with an error that names the cycle instead of
 * exhausting the heap and taking the process down with it.
 */

import { describe, it, expect } from '@jest/globals';
import {
  ChatGraph,
  ChatGraphBuilder,
  TurnLimitExceededError,
  START,
  END,
  registry,
} from '../src';
import { z } from 'zod';

const cycleNodes = [
  { id: 'a', action: { message: 'one' }, autoAdvance: true },
  { id: 'b', action: { message: 'two' }, autoAdvance: true },
];

const cycleEdges = [
  { from: START, to: 'a' },
  { from: 'a', to: 'b' },
  { from: 'b', to: 'a' },
];

const makeGraph = (config: Record<string, unknown> = {}): ChatGraph<any, any> =>
  new ChatGraph<any, any>({
    id: 'cycle',
    nodes: cycleNodes as any,
    edges: cycleEdges as any,
    ...config,
  });

describe('TurnLimitExceededError', () => {
  it('stops a cycle of autoAdvance nodes instead of exhausting the heap', async () => {
    await expect(
      makeGraph().invoke({ userMessage: 'hi' })
    ).rejects.toBeInstanceOf(TurnLimitExceededError);
  });

  it('names the cycle in its path and message', async () => {
    let caught: TurnLimitExceededError | undefined;

    try {
      await makeGraph().invoke({ userMessage: 'hi' });
    } catch (error) {
      caught = error as TurnLimitExceededError;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.name).toBe('TurnLimitExceededError');
    expect(caught?.flowId).toBe('cycle');
    expect(caught?.limit).toBe(50);
    expect(caught?.path).toContain('a');
    expect(caught?.path).toContain('b');
    expect(caught?.path).toHaveLength(51);
    expect(caught?.message).toContain('cycle');
  });

  it('catches the smallest case, an autoAdvance self-loop', async () => {
    const graph = new ChatGraph<any, any>({
      id: 'self-loop',
      nodes: [
        { id: 'a', action: { message: 'one' }, autoAdvance: true },
      ] as any,
      edges: [
        { from: START, to: 'a' },
        { from: 'a', to: 'a' },
      ] as any,
    });

    await expect(graph.invoke({ userMessage: 'hi' })).rejects.toBeInstanceOf(
      TurnLimitExceededError
    );
  });

  it('defaults to 50 and honours a configured bound', async () => {
    let caught: TurnLimitExceededError | undefined;

    try {
      await makeGraph({ maxNodesPerTurn: 6 }).invoke({ userMessage: 'hi' });
    } catch (error) {
      caught = error as TurnLimitExceededError;
    }

    expect(caught?.limit).toBe(6);
    expect(caught?.path).toEqual(['a', 'b', 'a', 'b', 'a', 'b', 'a']);
  });

  it('lets a legitimate chain of 10 autoAdvance nodes complete', async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      action: { message: `step ${i}` },
      autoAdvance: true,
    }));

    const edges = [
      { from: START, to: 'n0' },
      ...nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: `n${i + 1}` })),
      { from: 'n9', to: END },
    ];

    const graph = new ChatGraph<any, any>({
      id: 'chain',
      nodes: nodes as any,
      edges: edges as any,
    });

    await graph.invoke({ userMessage: 'go' });

    expect(graph.isDone).toBe(true);
    expect(graph.emittedMessages).toHaveLength(10);
  });

  it('lets a waiting cycle run indefinitely, because the count resets each turn', async () => {
    const graph = new ChatGraph<any, any>({
      id: 'waiting-loop',
      nodes: [
        {
          id: 'wait',
          action: { message: 'Someone will be with you shortly.' },
          validate: { rules: [] },
        },
      ] as any,
      edges: [
        { from: START, to: 'wait' },
        { from: 'wait', to: 'wait' },
      ] as any,
    });

    for (let turn = 0; turn < 100; turn++) {
      await graph.invoke({ userMessage: 'any update?' });
      expect(graph.emittedMessages).toEqual([
        'Someone will be with you shortly.',
      ]);
    }

    expect(graph.isDone).toBe(false);
  });

  it('is configurable through the builder', async () => {
    const State = z.object({
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p: string[], n: string[]) => p.concat(n) },
        default: () => [] as string[],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State })
      .addNode({ id: 'a', action: { message: 'one' }, autoAdvance: true })
      .addEdge(START, 'a')
      .addEdge('a', 'a')
      .compile({ id: 'builder-loop', maxNodesPerTurn: 3 });

    let caught: TurnLimitExceededError | undefined;
    try {
      await graph.invoke({ userMessage: 'hi' });
    } catch (error) {
      caught = error as TurnLimitExceededError;
    }

    expect(caught).toBeInstanceOf(TurnLimitExceededError);
    expect(caught?.limit).toBe(3);
    expect(caught?.flowId).toBe('builder-loop');
  });
});
