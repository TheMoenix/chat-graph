/**
 * MemoryStorageAdapter Tests
 * Tests the in-memory storage adapter including shared storage behavior
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { MemoryStorageAdapter } from '../src/persistence/memory-adapter';
import { StateSnapshot } from '../src/persistence/storage-adapter';

// Helper to create test snapshots
const createSnapshot = (
  flowId: string,
  version: number,
  state: any = {}
): StateSnapshot => ({
  flowId,
  version,
  state,
  timestamp: new Date(),
  tracker: {
    __currentNodeId: 'test',
    __isActionTaken: true,
    __isResponseValid: true,
    __graphId: flowId,
    __isDone: false,
  },
});

describe('MemoryStorageAdapter', () => {
  let adapter: MemoryStorageAdapter;
  const testFlowId = 'test-flow-memory';

  beforeEach(() => {
    adapter = new MemoryStorageAdapter();
    adapter.clearAll(); // Clear shared storage before each test
  });

  describe('Basic Operations', () => {
    it('should save and load a snapshot', async () => {
      const snapshot = createSnapshot(testFlowId, 1, { message: 'Hello' });

      await adapter.saveSnapshot(snapshot);
      const loaded = await adapter.loadSnapshot(testFlowId);

      expect(loaded).toBeDefined();
      expect(loaded?.flowId).toBe(testFlowId);
      expect(loaded?.version).toBe(1);
      expect(loaded?.state).toEqual({ message: 'Hello' });
    });

    it('should return null for non-existent flow', async () => {
      const loaded = await adapter.loadSnapshot('non-existent-flow');
      expect(loaded).toBeNull();
    });

    it('should save multiple versions', async () => {
      await adapter.saveSnapshot(createSnapshot(testFlowId, 1, { count: 1 }));
      await adapter.saveSnapshot(createSnapshot(testFlowId, 2, { count: 2 }));
      await adapter.saveSnapshot(createSnapshot(testFlowId, 3, { count: 3 }));

      const latest = await adapter.loadSnapshot(testFlowId);
      expect(latest?.version).toBe(3);
      expect(latest?.state).toEqual({ count: 3 });
    });

    it('should load specific version', async () => {
      await adapter.saveSnapshot(createSnapshot(testFlowId, 1, { count: 1 }));
      await adapter.saveSnapshot(createSnapshot(testFlowId, 2, { count: 2 }));

      const v1 = await adapter.loadSnapshot(testFlowId, 1);
      expect(v1?.version).toBe(1);
      expect(v1?.state).toEqual({ count: 1 });

      const v2 = await adapter.loadSnapshot(testFlowId, 2);
      expect(v2?.version).toBe(2);
      expect(v2?.state).toEqual({ count: 2 });
    });

    it('should return null for non-existent version', async () => {
      await adapter.saveSnapshot(createSnapshot(testFlowId, 1, { count: 1 }));

      const notFound = await adapter.loadSnapshot(testFlowId, 999);
      expect(notFound).toBeNull();
    });
  });

  describe('History Management', () => {
    beforeEach(async () => {
      // Create test history
      for (let i = 1; i <= 5; i++) {
        await adapter.saveSnapshot(createSnapshot(testFlowId, i, { count: i }));
      }
    });

    it('should load full history', async () => {
      const history = await adapter.loadHistory(testFlowId);

      expect(history).toHaveLength(5);
      // Should be sorted newest first
      expect(history[0].version).toBe(5);
      expect(history[4].version).toBe(1);
    });

    it('should limit history results', async () => {
      const history = await adapter.loadHistory(testFlowId, 3);

      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(5);
      expect(history[1].version).toBe(4);
      expect(history[2].version).toBe(3);
    });

    it('should return empty array for non-existent flow', async () => {
      const history = await adapter.loadHistory('non-existent');
      expect(history).toEqual([]);
    });
  });

  describe('Delete Operations', () => {
    it('should delete a flow', async () => {
      await adapter.saveSnapshot(
        createSnapshot(testFlowId, 1, { message: 'test' })
      );

      const existsBefore = await adapter.flowExists(testFlowId);
      expect(existsBefore).toBe(true);

      await adapter.deleteFlow(testFlowId);

      const existsAfter = await adapter.flowExists(testFlowId);
      expect(existsAfter).toBe(false);

      const loaded = await adapter.loadSnapshot(testFlowId);
      expect(loaded).toBeNull();
    });

    it('should not throw when deleting non-existent flow', async () => {
      await expect(adapter.deleteFlow('non-existent')).resolves.not.toThrow();
    });
  });

  describe('Prune Operations', () => {
    beforeEach(async () => {
      // Create test history with 10 snapshots
      for (let i = 1; i <= 10; i++) {
        await adapter.saveSnapshot(createSnapshot(testFlowId, i, { count: i }));
      }
    });

    it('should prune old history', async () => {
      const countBefore = await adapter.getSnapshotCount(testFlowId);
      expect(countBefore).toBe(10);

      await adapter.pruneHistory(testFlowId, 3);

      const countAfter = await adapter.getSnapshotCount(testFlowId);
      expect(countAfter).toBe(3);

      const history = await adapter.loadHistory(testFlowId);
      expect(history).toHaveLength(3);
      // Should keep the newest 3
      expect(history[0].version).toBe(10);
      expect(history[1].version).toBe(9);
      expect(history[2].version).toBe(8);
    });

    it('should not prune when count is less than keepLast', async () => {
      await adapter.pruneHistory(testFlowId, 20);

      const count = await adapter.getSnapshotCount(testFlowId);
      expect(count).toBe(10); // Still has all 10
    });

    it('should handle pruning non-existent flow', async () => {
      await expect(
        adapter.pruneHistory('non-existent', 5)
      ).resolves.not.toThrow();
    });
  });

  describe('Utility Methods', () => {
    it('should count snapshots correctly', async () => {
      expect(await adapter.getSnapshotCount(testFlowId)).toBe(0);

      await adapter.saveSnapshot(createSnapshot(testFlowId, 1));

      expect(await adapter.getSnapshotCount(testFlowId)).toBe(1);

      await adapter.saveSnapshot(createSnapshot(testFlowId, 2));

      expect(await adapter.getSnapshotCount(testFlowId)).toBe(2);
    });

    it('should check flow existence', async () => {
      expect(await adapter.flowExists(testFlowId)).toBe(false);

      await adapter.saveSnapshot(createSnapshot(testFlowId, 1));

      expect(await adapter.flowExists(testFlowId)).toBe(true);
    });

    it('should get all flow IDs', async () => {
      expect(adapter.getAllFlowIds()).toEqual([]);

      await adapter.saveSnapshot(createSnapshot('flow1', 1));
      await adapter.saveSnapshot(createSnapshot('flow2', 1));

      const flowIds = adapter.getAllFlowIds();
      expect(flowIds).toHaveLength(2);
      expect(flowIds).toContain('flow1');
      expect(flowIds).toContain('flow2');
    });

    it('should clear all data', async () => {
      await adapter.saveSnapshot(createSnapshot('flow1', 1));
      await adapter.saveSnapshot(createSnapshot('flow2', 1));

      expect(adapter.getAllFlowIds()).toHaveLength(2);

      adapter.clearAll();

      expect(adapter.getAllFlowIds()).toEqual([]);
    });
  });

  describe('Shared Storage Behavior', () => {
    it('should share data across multiple instances', async () => {
      const adapter1 = new MemoryStorageAdapter();
      const adapter2 = new MemoryStorageAdapter();

      adapter1.clearAll(); // Ensure clean state

      // Save with adapter1
      await adapter1.saveSnapshot(
        createSnapshot(testFlowId, 1, { message: 'Hello from adapter1' })
      );

      // Load with adapter2 - should see the same data
      const loaded = await adapter2.loadSnapshot(testFlowId);
      expect(loaded).toBeDefined();
      expect(loaded?.state).toEqual({ message: 'Hello from adapter1' });

      // Save more with adapter2
      await adapter2.saveSnapshot(
        createSnapshot(testFlowId, 2, { message: 'Hello from adapter2' })
      );

      // Load with adapter1 - should see updates from adapter2
      const updated = await adapter1.loadSnapshot(testFlowId);
      expect(updated?.version).toBe(2);
      expect(updated?.state).toEqual({ message: 'Hello from adapter2' });
    });

    it('should share clearAll() across instances', async () => {
      const adapter1 = new MemoryStorageAdapter();
      const adapter2 = new MemoryStorageAdapter();

      adapter1.clearAll();

      // Add data via adapter1
      await adapter1.saveSnapshot(createSnapshot('flow1', 1));

      // Verify adapter2 sees it
      expect(await adapter2.flowExists('flow1')).toBe(true);

      // Clear via adapter2
      adapter2.clearAll();

      // Verify adapter1 sees the clear
      expect(await adapter1.flowExists('flow1')).toBe(false);
      expect(adapter1.getAllFlowIds()).toEqual([]);
    });

    it('should share delete operations across instances', async () => {
      const adapter1 = new MemoryStorageAdapter();
      const adapter2 = new MemoryStorageAdapter();

      adapter1.clearAll();

      await adapter1.saveSnapshot(createSnapshot(testFlowId, 1));

      // Delete via adapter2
      await adapter2.deleteFlow(testFlowId);

      // Verify adapter1 sees the deletion
      expect(await adapter1.flowExists(testFlowId)).toBe(false);
    });

    it('should share prune operations across instances', async () => {
      const adapter1 = new MemoryStorageAdapter();
      const adapter2 = new MemoryStorageAdapter();

      adapter1.clearAll();

      // Create history with adapter1
      for (let i = 1; i <= 10; i++) {
        await adapter1.saveSnapshot(
          createSnapshot(testFlowId, i, { count: i })
        );
      }

      // Prune via adapter2
      await adapter2.pruneHistory(testFlowId, 3);

      // Verify adapter1 sees pruned data
      const count = await adapter1.getSnapshotCount(testFlowId);
      expect(count).toBe(3);

      const history = await adapter1.loadHistory(testFlowId);
      expect(history).toHaveLength(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle timestamp as Date object', async () => {
      const now = new Date();
      await adapter.saveSnapshot(createSnapshot(testFlowId, 1));

      const loaded = await adapter.loadSnapshot(testFlowId);
      expect(loaded?.timestamp).toBeInstanceOf(Date);
    });

    it('should handle complex state objects', async () => {
      const complexState = {
        messages: ['msg1', 'msg2'],
        user: { id: 123, name: 'Alice' },
        metadata: { tags: ['tag1', 'tag2'], count: 42 },
      };

      await adapter.saveSnapshot(createSnapshot(testFlowId, 1, complexState));

      const loaded = await adapter.loadSnapshot(testFlowId);
      expect(loaded?.state).toEqual(complexState);
    });

    it('should handle multiple flows independently', async () => {
      await adapter.saveSnapshot(
        createSnapshot('flow1', 1, { name: 'Flow 1' })
      );
      await adapter.saveSnapshot(
        createSnapshot('flow2', 1, { name: 'Flow 2' })
      );

      const flow1 = await adapter.loadSnapshot('flow1');
      const flow2 = await adapter.loadSnapshot('flow2');

      expect(flow1?.state).toEqual({ name: 'Flow 1' });
      expect(flow2?.state).toEqual({ name: 'Flow 2' });

      await adapter.deleteFlow('flow1');

      expect(await adapter.flowExists('flow1')).toBe(false);
      expect(await adapter.flowExists('flow2')).toBe(true);
    });
  });
});
