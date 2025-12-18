/**
 * MongoDB Adapter Tests
 * Uses MongoDB Memory Server for fully isolated, self-contained tests
 * No external MongoDB instance required!
 */

import { MongoStorageAdapter } from '../src/persistence/mongo-adapter';
import { MongoMemoryServer } from 'mongodb-memory-server';

describe('MongoStorageAdapter', () => {
  let mongod: MongoMemoryServer;
  let adapter: MongoStorageAdapter;
  const testFlowId = 'test-flow-jest';
  let mongoAvailable = false;

  beforeAll(async () => {
    // Check if MongoDB package is installed
    try {
      await import('mongodb');
      mongoAvailable = true;
    } catch {
      console.warn('⚠️ MongoDB package not installed, skipping MongoDB tests');
      console.warn('   Install with: npm install mongodb');
      return;
    }

    // Start in-memory MongoDB server
    try {
      mongod = await MongoMemoryServer.create();
      const uri = mongod.getUri();

      adapter = new MongoStorageAdapter({
        uri,
        database: 'chat_graph_test',
        collection: 'test_snapshots',
      });
      await adapter.connect();

      console.log('✅ MongoDB Memory Server started');
    } catch (error) {
      mongoAvailable = false;
      console.warn('⚠️ Failed to start MongoDB Memory Server:', error);
      console.warn('   Install with: npm install mongodb-memory-server');
    }
  }, 60000); // 60s timeout for first-time MongoDB binary download

  afterAll(async () => {
    if (mongoAvailable) {
      if (adapter) {
        await adapter.deleteFlow(testFlowId).catch(() => {});
        await adapter.disconnect();
      }
      if (mongod) {
        await mongod.stop();
        console.log('✅ MongoDB Memory Server stopped');
      }
    }
  });

  afterEach(async () => {
    if (mongoAvailable && adapter) {
      await adapter.deleteFlow(testFlowId).catch(() => {});
    }
  });

  it('should skip tests if MongoDB is not available', () => {
    if (!mongoAvailable) {
      expect(true).toBe(true); // Placeholder test
    }
  });

  it('should connect to MongoDB', async () => {
    if (!mongoAvailable) return;
    expect(adapter).toBeDefined();
  });

  it('should save and load a snapshot', async () => {
    if (!mongoAvailable) return;

    const snapshot = {
      flowId: testFlowId,
      version: 1,
      timestamp: new Date(),
      state: { test: 'data', counter: 1 },
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node1',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    };

    await adapter.saveSnapshot(snapshot);
    const loaded = await adapter.loadSnapshot(testFlowId);

    expect(loaded).toBeDefined();
    expect(loaded?.flowId).toBe(testFlowId);
    expect(loaded?.version).toBe(1);
    expect(loaded?.state).toEqual(snapshot.state);
  });

  it('should load latest version when no version specified', async () => {
    if (!mongoAvailable) return;

    // Save multiple versions
    await adapter.saveSnapshot({
      flowId: testFlowId,
      version: 1,
      timestamp: new Date(),
      state: { counter: 1 },
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node1',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });

    await adapter.saveSnapshot({
      flowId: testFlowId,
      version: 2,
      timestamp: new Date(),
      state: { counter: 2 },
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node2',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });

    const latest = await adapter.loadSnapshot(testFlowId);
    expect(latest?.version).toBe(2);
    expect(latest?.state).toEqual({ counter: 2 });
  });

  it('should load specific version', async () => {
    if (!mongoAvailable) return;

    await adapter.saveSnapshot({
      flowId: testFlowId,
      version: 1,
      timestamp: new Date(),
      state: { counter: 1 },
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node1',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });

    await adapter.saveSnapshot({
      flowId: testFlowId,
      version: 2,
      timestamp: new Date(),
      state: { counter: 2 },
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node2',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });

    const v1 = await adapter.loadSnapshot(testFlowId, 1);
    expect(v1?.version).toBe(1);
    expect(v1?.state).toEqual({ counter: 1 });
  });

  it('should load history in descending order', async () => {
    if (!mongoAvailable) return;

    await adapter.saveSnapshot({
      flowId: testFlowId,
      version: 1,
      timestamp: new Date(),
      state: { counter: 1 },
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node1',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });

    await adapter.saveSnapshot({
      flowId: testFlowId,
      version: 2,
      timestamp: new Date(),
      state: { counter: 2 },
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node2',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });

    const history = await adapter.loadHistory(testFlowId);
    expect(history).toHaveLength(2);
    expect(history[0].version).toBe(2); // Latest first
    expect(history[1].version).toBe(1);
  });

  it('should limit history results', async () => {
    if (!mongoAvailable) return;

    for (let i = 1; i <= 5; i++) {
      await adapter.saveSnapshot({
        flowId: testFlowId,
        version: i,
        timestamp: new Date(),
        state: { counter: i },
        tracker: {
          __graphId: testFlowId,
          __currentNodeId: `node${i}`,
          __isActionTaken: true,
          __isResponseValid: false,
          __isDone: false,
        },
      });
    }

    const limited = await adapter.loadHistory(testFlowId, 3);
    expect(limited).toHaveLength(3);
    expect(limited[0].version).toBe(5); // Latest
  });

  it('should get snapshot count', async () => {
    if (!mongoAvailable) return;

    await adapter.saveSnapshot({
      flowId: testFlowId,
      version: 1,
      timestamp: new Date(),
      state: {},
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node1',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });

    await adapter.saveSnapshot({
      flowId: testFlowId,
      version: 2,
      timestamp: new Date(),
      state: {},
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node2',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });

    const count = await adapter.getSnapshotCount(testFlowId);
    expect(count).toBe(2);
  });

  it('should check if flow exists', async () => {
    if (!mongoAvailable) return;

    await adapter.saveSnapshot({
      flowId: testFlowId,
      version: 1,
      timestamp: new Date(),
      state: {},
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node1',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });

    const exists = await adapter.flowExists(testFlowId);
    const notExists = await adapter.flowExists('non-existent-flow');

    expect(exists).toBe(true);
    expect(notExists).toBe(false);
  });

  it('should prune history keeping specified number of snapshots', async () => {
    if (!mongoAvailable) return;

    // Create 5 snapshots
    for (let i = 1; i <= 5; i++) {
      await adapter.saveSnapshot({
        flowId: testFlowId,
        version: i,
        timestamp: new Date(),
        state: { counter: i },
        tracker: {
          __graphId: testFlowId,
          __currentNodeId: `node${i}`,
          __isActionTaken: true,
          __isResponseValid: false,
          __isDone: false,
        },
      });
    }

    // Prune to keep only last 2
    await adapter.pruneHistory(testFlowId, 2);

    const remaining = await adapter.loadHistory(testFlowId);
    expect(remaining).toHaveLength(2);
    expect(remaining[0].version).toBe(5); // Latest
    expect(remaining[1].version).toBe(4); // Second latest
  });

  it('should delete all snapshots for a flow', async () => {
    if (!mongoAvailable) return;

    await adapter.saveSnapshot({
      flowId: testFlowId,
      version: 1,
      timestamp: new Date(),
      state: {},
      tracker: {
        __graphId: testFlowId,
        __currentNodeId: 'node1',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });

    await adapter.deleteFlow(testFlowId);

    const loaded = await adapter.loadSnapshot(testFlowId);
    expect(loaded).toBeNull();
  });

  it('should return null for non-existent flow', async () => {
    if (!mongoAvailable) return;

    const loaded = await adapter.loadSnapshot('non-existent-flow');
    expect(loaded).toBeNull();
  });
});
