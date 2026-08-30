/**
 * Storage adapter interface for state persistence
 * Supports versioned snapshots of state and tracker
 */

import { StateSchema, InferState } from '../schema/state-schema';
import { NodeId, Tracker } from '../types/graph.types';

/**
 * Snapshot of graph execution state at a point in time
 */
export interface StateSnapshot<S extends StateSchema = StateSchema> {
  /** Unique identifier for the flow */
  flowId: string;
  /** Version number (increments with each save) */
  version: number;
  /** Timestamp when snapshot was created */
  timestamp: Date;
  /** User-defined state data */
  state: InferState<S>;
  /** Internal execution tracker */
  tracker: Tracker<readonly NodeId[]>;
}

/**
 * Raised when a snapshot is saved at a version that already exists for the flow.
 *
 * This is the engine's optimistic-concurrency signal: two processes both loaded
 * version N and both tried to write N+1, so one of them is working from state
 * that is no longer current. A host that catches it should reload the flow and
 * decide whether replaying its input is safe — the engine never retries,
 * because only the host knows that.
 *
 * Distinguishable from a storage outage, which surfaces as the backend's own
 * error.
 */
export class VersionConflictError extends Error {
  constructor(
    readonly flowId: string,
    readonly attemptedVersion: number
  ) {
    super(
      `Version ${attemptedVersion} already exists for flow "${flowId}". ` +
        `Another process advanced this conversation; reload and retry.`
    );
    this.name = 'VersionConflictError';
    // Restore the prototype chain so `instanceof` works when compiled to ES5
    Object.setPrototypeOf(this, VersionConflictError.prototype);
  }
}

/**
 * Abstract storage adapter interface
 * Implement this interface to create custom storage backends
 */
export abstract class StorageAdapter {
  /**
   * Save a new snapshot version for a flow
   *
   * Implementations MUST reject a snapshot whose `(flowId, version)` pair
   * already exists by throwing {@link VersionConflictError}, rather than
   * overwriting or silently storing a duplicate. This is what makes concurrent
   * turns on one conversation detectable in a multi-process host.
   *
   * @param snapshot The snapshot to save
   * @throws {VersionConflictError} If this version already exists for the flow
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
