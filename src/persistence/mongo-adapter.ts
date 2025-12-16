/**
 * MongoDB storage adapter for persistent state management
 * Requires mongodb package: npm install mongodb
 */

import { StorageAdapter, StateSnapshot } from './storage-adapter';
import { StateSchema } from '../schema/state-schema';

// Type-only imports to avoid runtime dependency if MongoDB not installed
type MongoClient = any;
type Db = any;
type Collection = any;

/**
 * MongoDB configuration options
 */
export interface MongoStorageOptions {
  /** MongoDB connection URI */
  uri: string;
  /** Database name */
  database: string;
  /** Collection name for snapshots (defaults to 'chat_graph_snapshots') */
  collection?: string;
}

/**
 * MongoDB-based storage adapter
 * Persists snapshots to MongoDB for production use
 */
export class MongoStorageAdapter extends StorageAdapter {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private collection: Collection | null = null;
  private options: MongoStorageOptions;
  private isConnected = false;

  constructor(options: MongoStorageOptions) {
    super();
    this.options = {
      ...options,
      collection: options.collection || 'chat_graph_snapshots',
    };
  }

  /**
   * Connect to MongoDB
   * Must be called before using the adapter
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      // Dynamic import to avoid requiring mongodb if not used
      // Install with: npm install mongodb
      // @ts-ignore - mongodb may not be installed
      const { MongoClient } = await import('mongodb');

      this.client = new MongoClient(this.options.uri);
      await this.client.connect();
      this.db = this.client.db(this.options.database);
      this.collection = this.db.collection(this.options.collection);

      // Create indexes for efficient queries
      await this.collection.createIndex({ flowId: 1, version: -1 });
      await this.collection.createIndex({ flowId: 1 });

      this.isConnected = true;
    } catch (error) {
      throw new Error(
        `Failed to connect to MongoDB: ${error instanceof Error ? error.message : String(error)}\n` +
          `Make sure to install mongodb: npm install mongodb`
      );
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.collection = null;
      this.isConnected = false;
    }
  }

  private ensureConnected(): void {
    if (!this.isConnected || !this.collection) {
      throw new Error(
        'MongoStorageAdapter is not connected. Call connect() first.'
      );
    }
  }

  async saveSnapshot<S extends StateSchema>(
    snapshot: StateSnapshot<S>
  ): Promise<void> {
    this.ensureConnected();

    await this.collection!.insertOne({
      ...snapshot,
      timestamp: new Date(snapshot.timestamp),
      _id: `${snapshot.flowId}_v${snapshot.version}`, // Unique ID
    });
  }

  async loadSnapshot<S extends StateSchema>(
    flowId: string,
    version?: number
  ): Promise<StateSnapshot<S> | null> {
    this.ensureConnected();

    let query: any = { flowId };

    if (version !== undefined) {
      query.version = version;
    }

    const doc = await this.collection!.findOne(
      query,
      { sort: { version: -1 } } // Get latest if version not specified
    );

    if (!doc) {
      return null;
    }

    // Remove MongoDB _id field
    const { _id, ...snapshot } = doc;
    return snapshot as StateSnapshot<S>;
  }

  async loadHistory<S extends StateSchema>(
    flowId: string,
    limit?: number
  ): Promise<StateSnapshot<S>[]> {
    this.ensureConnected();

    const cursor = this.collection!.find(
      { flowId },
      {
        sort: { version: -1 },
        limit: limit || 0, // 0 means no limit
      }
    );

    const docs = await cursor.toArray();

    // Remove MongoDB _id field from each document
    return docs.map(
      ({ _id, ...snapshot }: any) => snapshot as StateSnapshot<S>
    );
  }

  async deleteFlow(flowId: string): Promise<void> {
    this.ensureConnected();

    await this.collection!.deleteMany({ flowId });
  }

  async pruneHistory(flowId: string, keepLast: number): Promise<void> {
    this.ensureConnected();

    // Find all versions for this flow, sorted by version descending
    const snapshots = await this.collection!.find(
      { flowId },
      { projection: { version: 1 }, sort: { version: -1 } }
    ).toArray();

    if (snapshots.length <= keepLast) {
      return; // Nothing to prune
    }

    // Get versions to delete (all except the last N)
    const versionsToDelete = snapshots
      .slice(keepLast)
      .map((s: any) => s.version);

    if (versionsToDelete.length > 0) {
      await this.collection!.deleteMany({
        flowId,
        version: { $in: versionsToDelete },
      });
    }
  }

  async getSnapshotCount(flowId: string): Promise<number> {
    this.ensureConnected();

    return await this.collection!.countDocuments({ flowId });
  }

  async flowExists(flowId: string): Promise<boolean> {
    this.ensureConnected();

    const count = await this.collection!.countDocuments(
      { flowId },
      { limit: 1 }
    );
    return count > 0;
  }
}
