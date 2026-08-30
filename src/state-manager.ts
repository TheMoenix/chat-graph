/**
 * State manager for versioned state and tracker persistence
 * Manages state snapshots across graph instances using storage adapters
 */

import { StateSchema, InferState } from './schema/state-schema';
import { NodeId, Tracker } from './types/graph.types';
import { StorageAdapter, StateSnapshot } from './persistence/storage-adapter';
import { MemoryStorageAdapter } from './persistence/memory-adapter';

/**
 * Global state manager for managing flow state across instances
 * Provides versioned snapshots and persistence
 */
export class StateManager<S extends StateSchema = StateSchema> {
  private readonly adapter: StorageAdapter;

  /**
   * Create a new state manager
   * @param adapter Storage adapter to use (defaults to in-memory)
   */
  constructor(adapter?: StorageAdapter) {
    this.adapter = adapter ?? new MemoryStorageAdapter();
  }

  /**
   * Save a new snapshot for a flow at the version after `baseVersion`
   *
   * The version is derived from the snapshot the caller loaded, not from
   * process memory: that is what makes a concurrent write detectable. Two
   * processes that both loaded version N both attempt N+1, and the storage
   * adapter rejects the loser with a {@link VersionConflictError}.
   *
   * @param baseVersion Version this save builds on. Omit to read the current
   *   latest from storage first, which is convenient for direct callers but
   *   offers no protection against a concurrent writer.
   * @throws {VersionConflictError} If the resulting version already exists
   */
  async save(
    flowId: string,
    state: InferState<S>,
    tracker: Tracker<readonly NodeId[]>,
    baseVersion?: number
  ): Promise<number> {
    const currentVersion =
      baseVersion ?? (await this.adapter.loadSnapshot(flowId))?.version ?? 0;
    const newVersion = currentVersion + 1;

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
    return this.adapter.loadSnapshot<S>(flowId, version);
  }

  /**
   * Get the complete history of snapshots for a flow
   */
  async getHistory(
    flowId: string,
    limit?: number
  ): Promise<StateSnapshot<S>[]> {
    return this.adapter.loadHistory<S>(flowId, limit);
  }

  /**
   * Delete all snapshots for a flow
   */
  async delete(flowId: string): Promise<void> {
    await this.adapter.deleteFlow(flowId);
  }

  /**
   * Clear all data (useful for testing)
   */
  async clear(): Promise<void> {
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
    return this.adapter.getSnapshotCount(flowId);
  }

  /**
   * Check if a flow exists in storage
   */
  async exists(flowId: string): Promise<boolean> {
    return this.adapter.flowExists(flowId);
  }

  /**
   * Get the storage adapter being used
   */
  getAdapter(): StorageAdapter {
    return this.adapter;
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
  globalStateManager = globalStateManager ?? new StateManager(adapter);
  return globalStateManager;
}

/**
 * Reset the global state manager
 * Useful for testing
 */
export function resetGlobalStateManager(): void {
  globalStateManager = null;
}
