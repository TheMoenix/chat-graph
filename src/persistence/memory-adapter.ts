/**
 * In-memory storage adapter for development and testing
 * Stores all snapshots in memory (data is lost when process ends)
 */

import { StorageAdapter, StateSnapshot } from './storage-adapter';
import { StateSchema } from '../schema/state-schema';

/**
 * Memory-based storage adapter
 * All data stored in a Map, lost when process ends
 */
export class MemoryStorageAdapter extends StorageAdapter {
  private storage: Map<string, StateSnapshot[]> = new Map();

  async saveSnapshot<S extends StateSchema>(
    snapshot: StateSnapshot<S>
  ): Promise<void> {
    const flowSnapshots = this.storage.get(snapshot.flowId) || [];

    // Add new snapshot to history
    flowSnapshots.push({
      ...snapshot,
      timestamp: new Date(snapshot.timestamp), // Ensure Date object
    });

    this.storage.set(snapshot.flowId, flowSnapshots);
  }

  async loadSnapshot<S extends StateSchema>(
    flowId: string,
    version?: number
  ): Promise<StateSnapshot<S> | null> {
    const flowSnapshots = this.storage.get(flowId);

    if (!flowSnapshots || flowSnapshots.length === 0) {
      return null;
    }

    if (version !== undefined) {
      // Find specific version
      const snapshot = flowSnapshots.find((s) => s.version === version);
      return snapshot ? (snapshot as StateSnapshot<S>) : null;
    }

    // Return latest version
    return flowSnapshots[flowSnapshots.length - 1] as StateSnapshot<S>;
  }

  async loadHistory<S extends StateSchema>(
    flowId: string,
    limit?: number
  ): Promise<StateSnapshot<S>[]> {
    const flowSnapshots = this.storage.get(flowId) || [];

    // Sort by version descending (newest first)
    const sorted = [...flowSnapshots].sort((a, b) => b.version - a.version);

    if (limit !== undefined && limit > 0) {
      return sorted.slice(0, limit) as StateSnapshot<S>[];
    }

    return sorted as StateSnapshot<S>[];
  }

  async deleteFlow(flowId: string): Promise<void> {
    this.storage.delete(flowId);
  }

  async pruneHistory(flowId: string, keepLast: number): Promise<void> {
    const flowSnapshots = this.storage.get(flowId);

    if (!flowSnapshots || flowSnapshots.length <= keepLast) {
      return; // Nothing to prune
    }

    // Sort by version descending and keep only the last N
    const sorted = [...flowSnapshots].sort((a, b) => b.version - a.version);
    const pruned = sorted.slice(0, keepLast);

    this.storage.set(flowId, pruned);
  }

  async getSnapshotCount(flowId: string): Promise<number> {
    const flowSnapshots = this.storage.get(flowId);
    return flowSnapshots ? flowSnapshots.length : 0;
  }

  async flowExists(flowId: string): Promise<boolean> {
    const flowSnapshots = this.storage.get(flowId);
    return flowSnapshots !== undefined && flowSnapshots.length > 0;
  }

  /**
   * Clear all data from memory (useful for testing)
   */
  clearAll(): void {
    this.storage.clear();
  }

  /**
   * Get all flow IDs in storage (useful for debugging)
   */
  getAllFlowIds(): string[] {
    return Array.from(this.storage.keys());
  }
}
