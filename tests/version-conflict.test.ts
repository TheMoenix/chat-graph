/**
 * Optimistic concurrency tests (Spec 01 — Change 3)
 *
 * Two processes may handle turns for one conversation. Both load version N and
 * both try to write N+1; the loser must learn that someone else advanced the
 * conversation, as a typed error it can tell apart from the database being
 * down — not as a driver-specific crash, and never as a silent overwrite.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  ChatGraph,
  START,
  END,
  VersionConflictError,
  StateManager,
} from '../src';
import { MemoryStorageAdapter } from '../src/persistence/memory-adapter';

const nodes = [
  { id: 'a', action: { message: 'one' } },
  { id: 'b', action: { message: 'two' } },
];

const edges = [
  { from: START, to: 'a' },
  { from: 'a', to: 'b' },
  { from: 'b', to: END },
];

const snap = (flowId: string, version: number) => ({
  flowId,
  version,
  timestamp: new Date(),
  state: { messages: [] } as any,
  tracker: {
    __graphId: flowId,
    __currentNodeId: 'a',
    __isActionTaken: false,
    __isResponseValid: false,
    __isDone: false,
  },
});

describe('VersionConflictError', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    storage.clearAll();
  });

  const makeGraph = (id: string): ChatGraph<any, any> =>
    new ChatGraph<any, any>({
      id,
      storageAdapter: storage,
      nodes: nodes as any,
      edges: edges as any,
    });

  it('carries the flow and the version that was refused', () => {
    const error = new VersionConflictError('flow-1', 7);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(VersionConflictError);
    expect(error.name).toBe('VersionConflictError');
    expect(error.flowId).toBe('flow-1');
    expect(error.attemptedVersion).toBe(7);
    expect(error.message).toContain('flow-1');
  });

  it('rejects a duplicate version at the memory adapter', async () => {
    await storage.saveSnapshot(snap('dup', 1));

    await expect(storage.saveSnapshot(snap('dup', 1))).rejects.toThrow(
      VersionConflictError
    );
    expect(await storage.getSnapshotCount('dup')).toBe(1);
  });

  it('surfaces when two concurrent turns both advance one conversation', async () => {
    await makeGraph('race').invoke({ userMessage: 'seed' });
    const seeded = await storage.loadSnapshot('race');
    expect(seeded?.version).toBe(1);

    // Both graphs load version 1, both try to write version 2
    const results = await Promise.allSettled([
      makeGraph('race').invoke({ userMessage: 'x' }),
      makeGraph('race').invoke({ userMessage: 'y' }),
    ]);

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);

    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(VersionConflictError);
    expect((reason as VersionConflictError).flowId).toBe('race');
    expect((reason as VersionConflictError).attemptedVersion).toBe(2);

    // exactly one version 2 is stored, not two
    const history = await storage.loadHistory('race');
    expect(history.filter((s) => s.version === 2)).toHaveLength(1);
    expect(history.map((s) => s.version)).toEqual([2, 1]);
  });

  it('propagates out of a save without the engine retrying', async () => {
    await makeGraph('no-retry').invoke({ userMessage: 'seed' });

    const stale = makeGraph('no-retry');
    expect(await stale.restoreFromSnapshot()).toBe(true);

    // another process claims version 2 while `stale` still holds version 1
    await storage.saveSnapshot(snap('no-retry', 2));

    await expect(stale.saveSnapshot()).rejects.toBeInstanceOf(
      VersionConflictError
    );

    // the engine did not retry at a later version behind the error
    expect(await storage.getSnapshotCount('no-retry')).toBe(2);
  });

  it('reloads rather than conflicting when a turn starts after a competing write', async () => {
    await makeGraph('reload').invoke({ userMessage: 'seed' });
    await storage.saveSnapshot(snap('reload', 2));

    // invoke() loads at the top of the turn, so it builds on version 2
    await makeGraph('reload').invoke({ userMessage: 'x' });

    const history = await storage.loadHistory('reload');
    expect(history.map((s) => s.version)).toEqual([3, 2, 1]);
  });

  it('does not fire for sequential turns on one conversation', async () => {
    for (const userMessage of ['one', 'two', 'three', 'four']) {
      await makeGraph('sequential').invoke({ userMessage });
    }

    const history = await storage.loadHistory('sequential');
    const versions = history.map((s) => s.version).sort((x, y) => x - y);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('gives each loaded snapshot its own state and tracker', async () => {
    await makeGraph('isolation').invoke({ userMessage: 'seed' });

    const first = await storage.loadSnapshot('isolation');
    const second = await storage.loadSnapshot('isolation');

    expect(first).not.toBe(second);
    expect(first?.tracker).not.toBe(second?.tracker);
    expect(first?.state).not.toBe(second?.state);

    // mutating one copy must not reach storage
    (first as any).tracker.__currentNodeId = 'tampered';
    const reloaded = await storage.loadSnapshot('isolation');
    expect(reloaded?.tracker.__currentNodeId).not.toBe('tampered');
  });

  describe('StateManager', () => {
    it('derives the next version from the caller-supplied base', async () => {
      const manager = new StateManager(storage);
      const tracker = snap('sm', 1).tracker;

      expect(await manager.save('sm', {} as any, tracker, 0)).toBe(1);
      expect(await manager.save('sm', {} as any, tracker, 1)).toBe(2);

      await expect(
        manager.save('sm', {} as any, tracker, 1)
      ).rejects.toBeInstanceOf(VersionConflictError);
    });

    it('reads the current latest when no base version is supplied', async () => {
      const manager = new StateManager(storage);
      const tracker = snap('sm2', 1).tracker;

      await storage.saveSnapshot(snap('sm2', 5));
      expect(await manager.save('sm2', {} as any, tracker)).toBe(6);
    });

    it('starts a fresh flow at version 1 with no process state carried over', async () => {
      const tracker = snap('fresh', 1).tracker;

      expect(
        await new StateManager(storage).save('fresh', {} as any, tracker)
      ).toBe(1);
      await storage.deleteFlow('fresh');
      // a brand new manager, and a manager that already saved, agree
      expect(
        await new StateManager(storage).save('fresh', {} as any, tracker)
      ).toBe(1);
    });
  });
});
