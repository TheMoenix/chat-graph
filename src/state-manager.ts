/**
 * State manager for versioned state and tracker persistence
 * Manages state snapshots across graph instances using storage adapters
 */

import { StateSchema, InferState } from './schema/state-schema';
import { Tracker } from './types/graph.types';
import { StorageAdapter, StateSnapshot } from './persistence/storage-adapter';
import { MemoryStorageAdapter } from './persistence/memory-adapter';

/**
 * Global state manager for managing flow state across instances
 * Provides versioned snapshots and persistence
 */
export class StateManager<S extends StateSchema = any> {
  private adapter: StorageAdapter;
  private versionCounters: Map<string, number> = new Map();

  /**
   * Create a new state manager
   * @param adapter Storage adapter to use (defaults to in-memory)
   */
  constructor(adapter?: StorageAdapter) {
    this.adapter = adapter || new MemoryStorageAdapter();
  }

  /**
   * Save a new snapshot for a flow
   * Automatically increments version number
   */
  async save(
    flowId: string,
    state: InferState<S>,
    tracker: Tracker<any>
  ): Promise<number> {
    // Get next version number
    const currentVersion = this.versionCounters.get(flowId) || 0;
    const newVersion = currentVersion + 1;
    this.versionCounters.set(flowId, newVersion);

    const snapshot: StateSnapshot<S> = {
      flowId,
      version: newVersion,
      timestamp: new Date(),
      state,
      tracker,
    };

    await this.adapter.saveSnapshot(snapshot);
    return newVersion;
  }

  /**
   * Load a specific snapshot version or the latest
   */
  async load(
    flowId: string,
    version?: number
  ): Promise<StateSnapshot<S> | null> {
    const snapshot = await this.adapter.loadSnapshot<S>(flowId, version);

    // Update version counter if we loaded a snapshot
    if (snapshot) {
      const currentMax = this.versionCounters.get(flowId) || 0;
      this.versionCounters.set(flowId, Math.max(currentMax, snapshot.version));
    }

    return snapshot;
  }

  /**
   * Get the complete history of snapshots for a flow
   */
  async getHistory(
    flowId: string,
    limit?: number
  ): Promise<StateSnapshot<S>[]> {
    return await this.adapter.loadHistory<S>(flowId, limit);
  }

  /**
   * Delete all snapshots for a flow
   */
  async delete(flowId: string): Promise<void> {
    await this.adapter.deleteFlow(flowId);
    this.versionCounters.delete(flowId);
  }

  /**
   * Clear all data (useful for testing)
   */
  async clear(): Promise<void> {
    this.versionCounters.clear();

    // If using memory adapter, clear it
    if (this.adapter instanceof MemoryStorageAdapter) {
      this.adapter.clearAll();
    }
  }

  /**
   * Prune old snapshots, keeping only the most recent N versions
   */
  async pruneHistory(flowId: string, keepLast: number): Promise<void> {
    await this.adapter.pruneHistory(flowId, keepLast);
  }

  /**
   * Get the number of snapshots for a flow
   */
  async getSnapshotCount(flowId: string): Promise<number> {
    return await this.adapter.getSnapshotCount(flowId);
  }

  /**
   * Check if a flow exists in storage
   */
  async exists(flowId: string): Promise<boolean> {
    return await this.adapter.flowExists(flowId);
  }

  /**
   * Get the storage adapter being used
   */
  getAdapter(): StorageAdapter {
    return this.adapter;
  }

  /**
   * Initialize version counter from storage
   * Useful when manager is recreated
   */
  async initializeVersionCounter(flowId: string): Promise<void> {
    const latest = await this.adapter.loadSnapshot(flowId);
    if (latest) {
      this.versionCounters.set(flowId, latest.version);
    }
  }
}

/**
 * Create a global singleton state manager for simple use cases
 * For advanced use cases, create your own StateManager instance
 */
let globalStateManager: StateManager | null = null;

/**
 * Get or create the global state manager
 */
export function getGlobalStateManager(adapter?: StorageAdapter): StateManager {
  if (!globalStateManager) {
    globalStateManager = new StateManager(adapter);
  }
  return globalStateManager;
}

/**
 * Reset the global state manager
 * Useful for testing
 */
export function resetGlobalStateManager(): void {
  globalStateManager = null;
}
