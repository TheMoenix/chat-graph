/**
 * In-memory storage adapter for development and testing
 * Stores all snapshots in memory (data is lost when process ends)
 */

import {
  StorageAdapter,
  StateSnapshot,
  VersionConflictError,
} from './storage-adapter';
import { StateSchema } from '../schema/state-schema';

/**
 * Memory-based storage adapter
 * Uses a static Map shared across ALL instances - like an internal Redis
 */
export class MemoryStorageAdapter extends StorageAdapter {
  // Shared storage - all instances see the same data
  private static readonly sharedStorage: Map<string, StateSnapshot[]> =
    new Map();

  async saveSnapshot<S extends StateSchema>(
    snapshot: StateSnapshot<S>
  ): Promise<void> {
    const flowSnapshots =
      MemoryStorageAdapter.sharedStorage.get(snapshot.flowId) ?? [];

    // Reject a version that already exists — two processes both advancing the
    // same conversation must not silently produce two snapshots at one version
    if (flowSnapshots.some((s) => s.version === snapshot.version)) {
      throw new VersionConflictError(snapshot.flowId, snapshot.version);
    }

    // Add new snapshot to history
    flowSnapshots.push(MemoryStorageAdapter.copy(snapshot));

    MemoryStorageAdapter.sharedStorage.set(snapshot.flowId, flowSnapshots);
  }

  /**
   * Copies a snapshot on the way in and out of storage.
   *
   * A stored snapshot must not alias the live graph's `state` and `tracker`,
   * which the engine mutates in place. Without this, two graphs that load the
   * same snapshot share one tracker object and overwrite each other's node
   * pointer — which is precisely the concurrency this adapter exists to let
   * you test. A real backend serializes, so this matches production behaviour.
   */
  private static copy<S extends StateSchema>(
    snapshot: StateSnapshot<S>
  ): StateSnapshot<S> {
    return {
      ...snapshot,
      timestamp: new Date(snapshot.timestamp), // Ensure Date object
      state: MemoryStorageAdapter.deepClone(snapshot.state),
      tracker: MemoryStorageAdapter.deepClone(snapshot.tracker),
    };
  }

  /** structuredClone where available (Node 17+), JSON round-trip on Node 16 */
  private static deepClone<T>(value: T): T {
    const clone = (globalThis as { structuredClone?: <V>(v: V) => V })
      .structuredClone;

    if (clone !== undefined) {
      return clone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
  }

  async loadSnapshot<S extends StateSchema>(
    flowId: string,
    version?: number
  ): Promise<StateSnapshot<S> | null> {
    const flowSnapshots = MemoryStorageAdapter.sharedStorage.get(flowId) ?? [];

    if (flowSnapshots.length === 0) {
      return null;
    }

    if (version !== undefined) {
      // Find specific version
      const snapshot = flowSnapshots.find((s) => s.version === version);
      return snapshot === undefined
        ? null
        : MemoryStorageAdapter.copy(snapshot as StateSnapshot<S>);
    }

    // Return latest version
    return MemoryStorageAdapter.copy(
      flowSnapshots[flowSnapshots.length - 1] as StateSnapshot<S>
    );
  }

  async loadHistory<S extends StateSchema>(
    flowId: string,
    limit?: number
  ): Promise<StateSnapshot<S>[]> {
    const flowSnapshots = MemoryStorageAdapter.sharedStorage.get(flowId) ?? [];

    // Sort by version descending (newest first)
    const sorted = [...flowSnapshots].sort((a, b) => b.version - a.version);

    const copies = (sorted as StateSnapshot<S>[]).map((s) =>
      MemoryStorageAdapter.copy(s)
    );

    if (limit !== undefined && limit > 0) {
      return copies.slice(0, limit);
    }

    return copies;
  }

  async deleteFlow(flowId: string): Promise<void> {
    MemoryStorageAdapter.sharedStorage.delete(flowId);
  }

  async pruneHistory(flowId: string, keepLast: number): Promise<void> {
    const flowSnapshots = MemoryStorageAdapter.sharedStorage.get(flowId) ?? [];

    if (flowSnapshots.length <= keepLast) {
      return; // Nothing to prune
    }

    // Sort by version descending and keep only the last N
    const sorted = [...flowSnapshots].sort((a, b) => b.version - a.version);
    const pruned = sorted.slice(0, keepLast);

    MemoryStorageAdapter.sharedStorage.set(flowId, pruned);
  }

  async getSnapshotCount(flowId: string): Promise<number> {
    return (MemoryStorageAdapter.sharedStorage.get(flowId) ?? []).length;
  }

  async flowExists(flowId: string): Promise<boolean> {
    const flowSnapshots = MemoryStorageAdapter.sharedStorage.get(flowId);
    return flowSnapshots !== undefined && flowSnapshots.length > 0;
  }

  /**
   * Clear all shared data (useful for testing)
   */
  clearAll(): void {
    MemoryStorageAdapter.sharedStorage.clear();
  }

  /**
   * Get all flow IDs in shared storage (useful for debugging)
   */
  getAllFlowIds(): string[] {
    return Array.from(MemoryStorageAdapter.sharedStorage.keys());
  }
}
