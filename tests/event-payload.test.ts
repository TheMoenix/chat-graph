/**
 * Structured event payload tests (Spec 01 — Change 2)
 *
 * `ChatEvent.payload` carries channel input that has no place in `userMessage`:
 * the stable developer-defined id behind a tapped button, a selected row id,
 * shared coordinates. The engine never reads it — it passes it through to node
 * actions, validators and router functions, and never persists it.
 */

import { describe, it, expect } from '@jest/globals';
import {
  ChatGraph,
  ChatGraphBuilder,
  START,
  END,
  registry,
  ChatEvent,
} from '../src';
import { MemoryStorageAdapter } from '../src/persistence/memory-adapter';
import { z } from 'zod';

const State = z.object({
  choice: z.string().optional(),
  messages: z.array(z.string()).registerReducer(registry, {
    reducer: { fn: (p: string[], n: string[]) => p.concat(n) },
    default: () => [] as string[],
  }),
});

describe('ChatEvent.payload', () => {
  it('reaches actions, validators and routers', async () => {
    const seen: Record<string, unknown> = {};

    const graph = new ChatGraph<any, any>({
      id: 'payload-flow',
      nodes: [
        {
          id: 'ask',
          action: (_state: any, event: ChatEvent) => {
            seen['action'] = event.payload?.['x'];
            return { messages: ['Pick one'] };
          },
          validate: (_state: any, event: ChatEvent) => {
            seen['validate'] = event.payload?.['x'];
            return { isValid: true, state: {} };
          },
        },
        { id: 'chosen', action: { message: 'Done' }, autoAdvance: true },
      ] as any,
      edges: [
        { from: START, to: 'ask' },
        {
          from: 'ask',
          to: (_state: any, event: ChatEvent) => {
            seen['router'] = event.payload?.['x'];
            return 'chosen';
          },
        },
        { from: 'chosen', to: END },
      ] as any,
    });

    // turn 1 runs the action phase
    await graph.invoke({ userMessage: 'hi', payload: { x: 'from-action' } });
    expect(seen['action']).toBe('from-action');

    // turn 2 runs the validation phase, then routes
    await graph.invoke({ userMessage: 'a', payload: { x: 'from-validate' } });
    expect(seen['validate']).toBe('from-validate');
    expect(seen['router']).toBe('from-validate');
  });

  it('is undefined on a turn that supplies none, not the previous turn value', async () => {
    const seen: unknown[] = [];

    const graph = new ChatGraph<any, any>({
      id: 'payload-clears',
      nodes: [
        {
          id: 'a',
          action: (_state: any, event: ChatEvent) => {
            seen.push(event.payload?.['x']);
            return { messages: ['a'] };
          },
          validate: (_state: any, event: ChatEvent) => {
            seen.push(event.payload?.['x']);
            return { isValid: true, state: {} };
          },
        },
      ] as any,
      edges: [
        { from: START, to: 'a' },
        { from: 'a', to: END },
      ] as any,
    });

    await graph.invoke({ userMessage: 'hi', payload: { x: 'set' } });
    await graph.invoke({ userMessage: 'again' });

    expect(seen).toEqual(['set', undefined]);
  });

  it('branches on a stable id while the label is free to change', async () => {
    const routeOn = async (
      buttonId: string,
      label: string
    ): Promise<string> => {
      const graph = new ChatGraphBuilder({ schema: State })
        .addNode({
          id: 'menu',
          action: { message: 'Menu' },
          validate: (_state, event) => ({
            isValid: true,
            state: { choice: String(event.payload?.['buttonId'] ?? '') },
          }),
        })
        .addNode({ id: 'billing', action: { message: 'Billing' } })
        .addNode({ id: 'support', action: { message: 'Support' } })
        .addEdge(START, 'menu')
        .addEdge('menu', (state) =>
          state.choice === 'billing' ? 'billing' : 'support'
        )
        .addEdge('billing', END)
        .addEdge('support', END)
        .compile({ id: `menu-${buttonId}-${label}` });

      await graph.invoke({ userMessage: 'open' });
      await graph.invoke({ userMessage: label, payload: { buttonId } });

      return graph.emittedMessages[graph.emittedMessages.length - 1] ?? '';
    };

    // the same id routes identically no matter how the label is worded
    expect(await routeOn('billing', 'Billing')).toBe('Billing');
    expect(await routeOn('billing', 'Payments & invoices')).toBe('Billing');
    expect(await routeOn('support', 'Help')).toBe('Support');
  });

  it('is not persisted in the snapshot', async () => {
    const storage = new MemoryStorageAdapter();

    const graph = new ChatGraph<any, any>({
      id: 'payload-snapshot',
      storageAdapter: storage,
      nodes: [
        { id: 'a', action: { message: 'a' }, autoAdvance: true },
      ] as any,
      edges: [
        { from: START, to: 'a' },
        { from: 'a', to: END },
      ] as any,
    });

    await graph.invoke({
      userMessage: 'hi',
      payload: { secret: 'must-not-persist' },
    });

    const snapshot = await storage.loadSnapshot('payload-snapshot');
    expect(snapshot).not.toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain('must-not-persist');
  });

  it('leaves events without a payload working unchanged', async () => {
    const graph = new ChatGraph<any, any>({
      id: 'no-payload',
      nodes: [
        {
          id: 'a',
          action: (_state: any, event: ChatEvent) => ({
            messages: [`echo:${event.userMessage}`],
          }),
        },
      ] as any,
      edges: [
        { from: START, to: 'a' },
        { from: 'a', to: END },
      ] as any,
    });

    await graph.invoke({ userMessage: 'hello' });
    expect(graph.emittedMessages).toEqual(['echo:hello']);
  });
});
