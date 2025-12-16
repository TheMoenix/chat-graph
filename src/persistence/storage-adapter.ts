/**
 * Storage adapter interface for state persistence
 * Supports versioned snapshots of state and tracker
 */

import { StateSchema, InferState } from '../schema/state-schema';
import { Tracker } from '../types/graph.types';

/**
 * Snapshot of graph execution state at a point in time
 */
export interface StateSnapshot<S extends StateSchema = any> {
  /** Unique identifier for the flow */
  flowId: string;
  /** Version number (increments with each save) */
  version: number;
  /** Timestamp when snapshot was created */
  timestamp: Date;
  /** User-defined state data */
  state: any;
  /** Internal execution tracker */
  tracker: Tracker<any>;
}

/**
 * Abstract storage adapter interface
 * Implement this interface to create custom storage backends
 */
export abstract class StorageAdapter {
  /**
   * Save a new snapshot version for a flow
   * @param snapshot The snapshot to save
   */
  abstract saveSnapshot<S extends StateSchema>(
    snapshot: StateSnapshot<S>
  ): Promise<void>;

  /**
   * Load a specific snapshot version or the latest if version not specified
   * @param flowId The flow identifier
   * @param version Optional version number (defaults to latest)
   * @returns The snapshot or null if not found
   */
  abstract loadSnapshot<S extends StateSchema>(
    flowId: string,
    version?: number
  ): Promise<StateSnapshot<S> | null>;

  /**
   * Load the complete history of snapshots for a flow
   * @param flowId The flow identifier
   * @param limit Optional limit on number of versions to return
   * @returns Array of snapshots ordered by version (newest first)
   */
  abstract loadHistory<S extends StateSchema>(
    flowId: string,
    limit?: number
  ): Promise<StateSnapshot<S>[]>;

  /**
   * Delete all snapshots for a flow
   * @param flowId The flow identifier
   */
  abstract deleteFlow(flowId: string): Promise<void>;

  /**
   * Prune old snapshots, keeping only the most recent N versions
   * @param flowId The flow identifier
   * @param keepLast Number of versions to keep
   */
  abstract pruneHistory(flowId: string, keepLast: number): Promise<void>;

  /**
   * Get the total number of snapshots for a flow
   * @param flowId The flow identifier
   * @returns The count of snapshots
   */
  abstract getSnapshotCount(flowId: string): Promise<number>;

  /**
   * Check if a flow exists in storage
   * @param flowId The flow identifier
   * @returns True if flow has at least one snapshot
   */
  abstract flowExists(flowId: string): Promise<boolean>;
}
