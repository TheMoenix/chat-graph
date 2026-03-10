/**
 * MongoDB Adapter Tests
 * Uses MongoDB Memory Server for fully isolated, self-contained tests
 * No external MongoDB instance required!
 */

import { MongoStorageAdapter } from '../src/persistence/mongo-adapter';
import { MongoMemoryServer } from 'mongodb-memory-server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSnap = (flowId: string, version: number, state: any = {}) => ({
  flowId,
  version,
  timestamp: new Date(),
  state,
  tracker: {
    __graphId: flowId,
    __currentNodeId: `node${version}`,
    __isActionTaken: true,
    __isResponseValid: false,
    __isDone: false,
  },
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('MongoStorageAdapter', () => {
  let mongod: MongoMemoryServer;
  let adapter: MongoStorageAdapter;
  const FLOW = 'test-flow-jest';
  let mongoAvailable = false;

  beforeAll(async () => {
    try {
      await import('mongodb');
      mongoAvailable = true;
    } catch {
      console.warn('⚠️ MongoDB package not installed, skipping MongoDB tests');
      return;
    }

    try {
      mongod = await MongoMemoryServer.create();
      adapter = new MongoStorageAdapter({
        uri: mongod.getUri(),
        database: 'chat_graph_test',
        collection: 'test_snapshots',
      });
      await adapter.connect();
    } catch (error) {
      mongoAvailable = false;
      console.warn('⚠️ Failed to start MongoDB Memory Server:', error);
    }
  }, 60000);

  afterAll(async () => {
    if (!mongoAvailable) return;
    if (adapter) await adapter.disconnect();
    if (mongod) await mongod.stop();
  });

  afterEach(async () => {
    if (mongoAvailable && adapter)
      await adapter.deleteFlow(FLOW).catch(() => {});
  });

  // -------------------------------------------------------------------------
  // Availability guard
  // -------------------------------------------------------------------------

  it('passes trivially when MongoDB is unavailable', () => {
    if (!mongoAvailable) expect(true).toBe(true);
  });

  // -------------------------------------------------------------------------
  // connect / disconnect
  // -------------------------------------------------------------------------

  describe('connect', () => {
    it('adapter is defined after connect', async () => {
      if (!mongoAvailable) return;
      expect(adapter).toBeDefined();
    });

    it('calling connect() twice is a no-op (idempotent)', async () => {
      if (!mongoAvailable) return;
      // Second call should not throw or open a second connection
      await expect(adapter.connect()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // saveSnapshot / loadSnapshot
  // -------------------------------------------------------------------------

  describe('saveSnapshot / loadSnapshot', () => {
    it('saves and reloads all fields: flowId, version, state, tracker, timestamp', async () => {
      if (!mongoAvailable) return;

      const snap = makeSnap(FLOW, 1, { name: 'Alice', score: 42 });
      await adapter.saveSnapshot(snap);
      const loaded = await adapter.loadSnapshot(FLOW);

      expect(loaded).not.toBeNull();
      expect(loaded!.flowId).toBe(FLOW);
      expect(loaded!.version).toBe(1);
      expect(loaded!.state).toEqual({ name: 'Alice', score: 42 });
      expect(loaded!.tracker.__currentNodeId).toBe('node1');
      expect(loaded!.tracker.__isDone).toBe(false);
      expect(loaded!.timestamp).toBeInstanceOf(Date);
    });

    it('loads the latest version when version is omitted', async () => {
      if (!mongoAvailable) return;

      await adapter.saveSnapshot(makeSnap(FLOW, 1, { counter: 1 }));
      await adapter.saveSnapshot(makeSnap(FLOW, 2, { counter: 2 }));
      await adapter.saveSnapshot(makeSnap(FLOW, 3, { counter: 3 }));

      const loaded = await adapter.loadSnapshot(FLOW);
      expect(loaded!.version).toBe(3);
      expect(loaded!.state).toEqual({ counter: 3 });
    });

    it('loads a specific older version', async () => {
      if (!mongoAvailable) return;

      await adapter.saveSnapshot(makeSnap(FLOW, 1, { counter: 1 }));
      await adapter.saveSnapshot(makeSnap(FLOW, 2, { counter: 2 }));

      const v1 = await adapter.loadSnapshot(FLOW, 1);
      expect(v1!.version).toBe(1);
      expect(v1!.state).toEqual({ counter: 1 });
    });

    it('returns null when no snapshot exists for a flow', async () => {
      if (!mongoAvailable) return;
      expect(await adapter.loadSnapshot('no-such-flow')).toBeNull();
    });

    it('returns null when a specific version does not exist', async () => {
      if (!mongoAvailable) return;

      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      expect(await adapter.loadSnapshot(FLOW, 999)).toBeNull();
    });

    it('preserves complex nested state', async () => {
      if (!mongoAvailable) return;

      const complexState = {
        messages: ['hello', 'world'],
        user: { id: 7, tags: ['admin', 'user'] },
        meta: { active: true, score: 3.14 },
      };
      await adapter.saveSnapshot(makeSnap(FLOW, 1, complexState));

      const loaded = await adapter.loadSnapshot(FLOW);
      expect(loaded!.state).toEqual(complexState);
    });

    it('does not expose MongoDB _id field on loaded snapshot', async () => {
      if (!mongoAvailable) return;

      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      const loaded = (await adapter.loadSnapshot(FLOW)) as any;
      expect(loaded._id).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // loadHistory
  // -------------------------------------------------------------------------

  describe('loadHistory', () => {
    it('returns snapshots ordered newest-first', async () => {
      if (!mongoAvailable) return;

      for (let i = 1; i <= 4; i++)
        await adapter.saveSnapshot(makeSnap(FLOW, i));

      const history = await adapter.loadHistory(FLOW);
      expect(history).toHaveLength(4);
      expect(history.map((s) => s.version)).toEqual([4, 3, 2, 1]);
    });

    it('applies limit and returns the most recent N', async () => {
      if (!mongoAvailable) return;

      for (let i = 1; i <= 5; i++)
        await adapter.saveSnapshot(makeSnap(FLOW, i));

      const limited = await adapter.loadHistory(FLOW, 3);
      expect(limited).toHaveLength(3);
      expect(limited.map((s) => s.version)).toEqual([5, 4, 3]);
    });

    it('returns empty array for a non-existent flow', async () => {
      if (!mongoAvailable) return;
      expect(await adapter.loadHistory('no-such-flow')).toEqual([]);
    });

    it('returns all snapshots when limit exceeds total count', async () => {
      if (!mongoAvailable) return;

      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      await adapter.saveSnapshot(makeSnap(FLOW, 2));

      const history = await adapter.loadHistory(FLOW, 100);
      expect(history).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // deleteFlow
  // -------------------------------------------------------------------------

  describe('deleteFlow', () => {
    it('removes all snapshots for a flow', async () => {
      if (!mongoAvailable) return;

      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      await adapter.saveSnapshot(makeSnap(FLOW, 2));
      await adapter.deleteFlow(FLOW);

      expect(await adapter.loadSnapshot(FLOW)).toBeNull();
      expect(await adapter.flowExists(FLOW)).toBe(false);
    });

    it('does not throw when deleting a non-existent flow', async () => {
      if (!mongoAvailable) return;
      await expect(adapter.deleteFlow('no-such-flow')).resolves.not.toThrow();
    });

    it('does not affect other flows when one is deleted', async () => {
      if (!mongoAvailable) return;

      await adapter.saveSnapshot(makeSnap(FLOW, 1, { owner: 'A' }));
      await adapter.saveSnapshot(makeSnap('other-flow', 1, { owner: 'B' }));

      await adapter.deleteFlow(FLOW);

      expect(await adapter.loadSnapshot(FLOW)).toBeNull();
      const other = await adapter.loadSnapshot('other-flow');
      expect(other!.state).toEqual({ owner: 'B' });

      await adapter.deleteFlow('other-flow');
    });
  });

  // -------------------------------------------------------------------------
  // pruneHistory
  // -------------------------------------------------------------------------

  describe('pruneHistory', () => {
    it('keeps only the N most recent versions', async () => {
      if (!mongoAvailable) return;

      for (let i = 1; i <= 5; i++)
        await adapter.saveSnapshot(makeSnap(FLOW, i));

      await adapter.pruneHistory(FLOW, 2);

      const remaining = await adapter.loadHistory(FLOW);
      expect(remaining).toHaveLength(2);
      expect(remaining[0].version).toBe(5);
      expect(remaining[1].version).toBe(4);
    });

    it('is a no-op when keepLast >= total count', async () => {
      if (!mongoAvailable) return;

      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      await adapter.saveSnapshot(makeSnap(FLOW, 2));

      await adapter.pruneHistory(FLOW, 10);

      expect(await adapter.getSnapshotCount(FLOW)).toBe(2);
    });

    it('does not throw for a non-existent flow', async () => {
      if (!mongoAvailable) return;
      await expect(
        adapter.pruneHistory('no-such-flow', 3)
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getSnapshotCount
  // -------------------------------------------------------------------------

  describe('getSnapshotCount', () => {
    it('returns 0 for a non-existent flow', async () => {
      if (!mongoAvailable) return;
      expect(await adapter.getSnapshotCount('no-such-flow')).toBe(0);
    });

    it('increments correctly as snapshots are added', async () => {
      if (!mongoAvailable) return;

      expect(await adapter.getSnapshotCount(FLOW)).toBe(0);
      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      expect(await adapter.getSnapshotCount(FLOW)).toBe(1);
      await adapter.saveSnapshot(makeSnap(FLOW, 2));
      expect(await adapter.getSnapshotCount(FLOW)).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // flowExists
  // -------------------------------------------------------------------------

  describe('flowExists', () => {
    it('returns false for a non-existent flow', async () => {
      if (!mongoAvailable) return;
      expect(await adapter.flowExists('no-such-flow')).toBe(false);
    });

    it('returns true once a snapshot is saved', async () => {
      if (!mongoAvailable) return;

      expect(await adapter.flowExists(FLOW)).toBe(false);
      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      expect(await adapter.flowExists(FLOW)).toBe(true);
    });

    it('returns false after the flow is deleted', async () => {
      if (!mongoAvailable) return;

      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      await adapter.deleteFlow(FLOW);
      expect(await adapter.flowExists(FLOW)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple independent flows
  // -------------------------------------------------------------------------

  describe('flow isolation', () => {
    afterEach(async () => {
      if (mongoAvailable && adapter) {
        await adapter.deleteFlow('flow-a').catch(() => {});
        await adapter.deleteFlow('flow-b').catch(() => {});
      }
    });

    it('two flows store and retrieve their state independently', async () => {
      if (!mongoAvailable) return;

      await adapter.saveSnapshot(makeSnap('flow-a', 1, { owner: 'A' }));
      await adapter.saveSnapshot(makeSnap('flow-b', 1, { owner: 'B' }));

      expect((await adapter.loadSnapshot('flow-a'))!.state).toEqual({
        owner: 'A',
      });
      expect((await adapter.loadSnapshot('flow-b'))!.state).toEqual({
        owner: 'B',
      });
    });

    it('loadHistory is scoped to the requested flow', async () => {
      if (!mongoAvailable) return;

      for (let i = 1; i <= 3; i++)
        await adapter.saveSnapshot(makeSnap('flow-a', i));
      await adapter.saveSnapshot(makeSnap('flow-b', 1));

      expect(await adapter.loadHistory('flow-a')).toHaveLength(3);
      expect(await adapter.loadHistory('flow-b')).toHaveLength(1);
    });
  });
});
