/**
 * MongoDB storage adapter for persistent state management
 * Requires mongodb package: npm install mongodb
 */

import { StorageAdapter, StateSnapshot } from './storage-adapter';
import { StateSchema } from '../schema/state-schema';

// Minimal interfaces for MongoDB — avoids compile-time dependency when mongodb is not installed.
// Install with: npm install mongodb
interface MongoCursorInterface {
  toArray(): Promise<MongoDocument[]>;
}

interface MongoDocument extends Record<string, unknown> {
  _id?: unknown;
}

interface MongoCollectionInterface {
  createIndex(indexSpec: Record<string, unknown>): Promise<string>;
  insertOne(doc: Record<string, unknown>): Promise<unknown>;
  findOne(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<MongoDocument | null>;
  find(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>
  ): MongoCursorInterface;
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
  countDocuments(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<number>;
}

interface MongoDatabaseInterface {
  collection(name: string): MongoCollectionInterface;
}

interface MongoClientInterface {
  connect(): Promise<void>;
  db(name: string): MongoDatabaseInterface;
  close(): Promise<void>;
}

type MongoClientConstructor = new (uri: string) => MongoClientInterface;

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
  private client: MongoClientInterface | null = null;
  private db: MongoDatabaseInterface | null = null;
  private collection: MongoCollectionInterface | null = null;
  private readonly options: Required<MongoStorageOptions>;
  private isConnected = false;

  constructor(options: MongoStorageOptions) {
    super();
    this.options = {
      ...options,
      collection: options.collection ?? 'chat_graph_snapshots',
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
      const mongoModule = (await import('mongodb')) as unknown as Record<
        string,
        unknown
      >;
      const MongoClientCtor = mongoModule[
        'MongoClient'
      ] as MongoClientConstructor;

      const client = new MongoClientCtor(this.options.uri);
      await client.connect();
      const db = client.db(this.options.database);
      const collection = db.collection(this.options.collection);

      // Create indexes for efficient queries
      await collection.createIndex({ flowId: 1, version: -1 });
      await collection.createIndex({ flowId: 1 });

      this.client = client;
      this.db = db;
      this.collection = collection;
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
    if (this.client !== null) {
      const client = this.client;
      await client.close();
      this.client = null;
      this.db = null;
      this.collection = null;
      this.isConnected = false;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected || this.collection === null) {
      await this.connect();
    }
  }

  private getCollection(): MongoCollectionInterface {
    if (this.collection === null) {
      throw new Error('Not connected to MongoDB. Call connect() first.');
    }
    return this.collection;
  }

  async saveSnapshot<S extends StateSchema>(
    snapshot: StateSnapshot<S>
  ): Promise<void> {
    await this.ensureConnected();

    await this.getCollection().insertOne({
      ...snapshot,
      timestamp: new Date(snapshot.timestamp),
      _id: `${snapshot.flowId}_v${snapshot.version}`, // Unique ID
    });
  }

  async loadSnapshot<S extends StateSchema>(
    flowId: string,
    version?: number
  ): Promise<StateSnapshot<S> | null> {
    await this.ensureConnected();

    const query: Record<string, unknown> = { flowId };

    if (version !== undefined) {
      query['version'] = version;
    }

    const doc = await this.getCollection().findOne(
      query,
      { sort: { version: -1 } } // Get latest if version not specified
    );

    if (doc === null) {
      return null;
    }

    // Remove MongoDB _id field
    const { _id, ...snapshot } = doc;
    void _id;
    return snapshot as unknown as StateSnapshot<S>;
  }

  async loadHistory<S extends StateSchema>(
    flowId: string,
    limit?: number
  ): Promise<StateSnapshot<S>[]> {
    await this.ensureConnected();

    const cursor = this.getCollection().find(
      { flowId },
      {
        sort: { version: -1 },
        limit: limit ?? 0, // 0 means no limit
      }
    );

    const docs = await cursor.toArray();

    // Remove MongoDB _id field from each document
    return docs.map((doc) => {
      const { _id, ...snapshot } = doc;
      void _id;
      return snapshot as unknown as StateSnapshot<S>;
    });
  }

  async deleteFlow(flowId: string): Promise<void> {
    await this.ensureConnected();

    await this.getCollection().deleteMany({ flowId });
  }

  async pruneHistory(flowId: string, keepLast: number): Promise<void> {
    await this.ensureConnected();

    // Find all versions for this flow, sorted by version descending
    const snapshots = await this.getCollection()
      .find({ flowId }, { projection: { version: 1 }, sort: { version: -1 } })
      .toArray();

    if (snapshots.length <= keepLast) {
      return; // Nothing to prune
    }

    // Get versions to delete (all except the last N)
    const versionsToDelete = snapshots.slice(keepLast).map((s) => s['version']);

    if (versionsToDelete.length > 0) {
      await this.getCollection().deleteMany({
        flowId,
        version: { $in: versionsToDelete },
      });
    }
  }

  async getSnapshotCount(flowId: string): Promise<number> {
    await this.ensureConnected();

    return this.getCollection().countDocuments({ flowId });
  }

  async flowExists(flowId: string): Promise<boolean> {
    await this.ensureConnected();

    const count = await this.getCollection().countDocuments(
      { flowId },
      { limit: 1 }
    );
    return count > 0;
  }
}
