/**
 * Custom Storage Adapter Tests
 *
 * Demonstrates and verifies that any class extending StorageAdapter
 * can be plugged into ChatGraph seamlessly.
 *
 * Uses a real SQLite database (better-sqlite3, in-memory :memory:) as the
 * concrete example — the same pattern applies to PostgreSQL, Redis, S3, etc.
 */

import Database from 'better-sqlite3';
import { z } from 'zod';
import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  StorageAdapter,
  StateSnapshot,
} from '../src/persistence/storage-adapter';
import { StateSchema } from '../src/schema/state-schema';
import { ChatGraph, START, END, registry } from '../src';

// ---------------------------------------------------------------------------
// SQLiteStorageAdapter — a minimal custom implementation
// ---------------------------------------------------------------------------

class SQLiteStorageAdapter extends StorageAdapter {
  private db: Database.Database;

  constructor() {
    super();
    // In-memory database: no files, no cleanup needed
    this.db = new Database(':memory:');
    this.db.exec(`
      CREATE TABLE snapshots (
        flowId   TEXT    NOT NULL,
        version  INTEGER NOT NULL,
        timestamp TEXT   NOT NULL,
        state    TEXT    NOT NULL,
        tracker  TEXT    NOT NULL,
        PRIMARY KEY (flowId, version)
      )
    `);
  }

  async saveSnapshot<S extends StateSchema>(
    snapshot: StateSnapshot<S>
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO snapshots (flowId, version, timestamp, state, tracker)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        snapshot.flowId,
        snapshot.version,
        snapshot.timestamp.toISOString(),
        JSON.stringify(snapshot.state),
        JSON.stringify(snapshot.tracker)
      );
  }

  async loadSnapshot<S extends StateSchema>(
    flowId: string,
    version?: number
  ): Promise<StateSnapshot<S> | null> {
    const row: any =
      version !== undefined
        ? this.db
            .prepare(`SELECT * FROM snapshots WHERE flowId = ? AND version = ?`)
            .get(flowId, version)
        : this.db
            .prepare(
              `SELECT * FROM snapshots WHERE flowId = ? ORDER BY version DESC LIMIT 1`
            )
            .get(flowId);

    if (!row) return null;
    return this.deserialise(row) as StateSnapshot<S>;
  }

  async loadHistory<S extends StateSchema>(
    flowId: string,
    limit?: number
  ): Promise<StateSnapshot<S>[]> {
    const rows: any[] = limit
      ? (this.db
          .prepare(
            `SELECT * FROM snapshots WHERE flowId = ? ORDER BY version DESC LIMIT ?`
          )
          .all(flowId, limit) as any[])
      : (this.db
          .prepare(
            `SELECT * FROM snapshots WHERE flowId = ? ORDER BY version DESC`
          )
          .all(flowId) as any[]);

    return rows.map((r) => this.deserialise(r)) as StateSnapshot<S>[];
  }

  async deleteFlow(flowId: string): Promise<void> {
    this.db.prepare(`DELETE FROM snapshots WHERE flowId = ?`).run(flowId);
  }

  async pruneHistory(flowId: string, keepLast: number): Promise<void> {
    this.db
      .prepare(
        `DELETE FROM snapshots
         WHERE flowId = ?
           AND version NOT IN (
             SELECT version FROM snapshots
             WHERE flowId = ?
             ORDER BY version DESC
             LIMIT ?
           )`
      )
      .run(flowId, flowId, keepLast);
  }

  async getSnapshotCount(flowId: string): Promise<number> {
    const row: any = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM snapshots WHERE flowId = ?`)
      .get(flowId);
    return row.cnt as number;
  }

  async flowExists(flowId: string): Promise<boolean> {
    const row: any = this.db
      .prepare(`SELECT 1 FROM snapshots WHERE flowId = ? LIMIT 1`)
      .get(flowId);
    return row !== undefined;
  }

  private deserialise(row: any): StateSnapshot {
    return {
      flowId: row.flowId,
      version: row.version,
      timestamp: new Date(row.timestamp),
      state: JSON.parse(row.state),
      tracker: JSON.parse(row.tracker),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSnap = (flowId: string, version: number, state: any = {}) => ({
  flowId,
  version,
  timestamp: new Date(),
  state,
  tracker: {
    __graphId: flowId,
    __currentNodeId: `node${version}`,
    __isActionTaken: true,
    __isResponseValid: false,
    __isDone: false,
  },
});

// ---------------------------------------------------------------------------
// Contract tests — StorageAdapter interface
// ---------------------------------------------------------------------------

describe('Custom SQLiteStorageAdapter — StorageAdapter contract', () => {
  let adapter: SQLiteStorageAdapter;
  const FLOW = 'sqlite-flow';

  beforeEach(() => {
    adapter = new SQLiteStorageAdapter(); // fresh in-memory DB each test
  });

  describe('saveSnapshot / loadSnapshot', () => {
    it('saves and reloads all fields', async () => {
      await adapter.saveSnapshot(makeSnap(FLOW, 1, { name: 'Alice' }));
      const loaded = await adapter.loadSnapshot(FLOW);

      expect(loaded).not.toBeNull();
      expect(loaded!.flowId).toBe(FLOW);
      expect(loaded!.version).toBe(1);
      expect(loaded!.state).toEqual({ name: 'Alice' });
      expect(loaded!.tracker.__currentNodeId).toBe('node1');
      expect(loaded!.timestamp).toBeInstanceOf(Date);
    });

    it('returns the latest version when version is omitted', async () => {
      await adapter.saveSnapshot(makeSnap(FLOW, 1, { v: 1 }));
      await adapter.saveSnapshot(makeSnap(FLOW, 2, { v: 2 }));
      await adapter.saveSnapshot(makeSnap(FLOW, 3, { v: 3 }));

      const loaded = await adapter.loadSnapshot(FLOW);
      expect(loaded!.version).toBe(3);
      expect(loaded!.state).toEqual({ v: 3 });
    });

    it('returns a specific older version', async () => {
      await adapter.saveSnapshot(makeSnap(FLOW, 1, { v: 1 }));
      await adapter.saveSnapshot(makeSnap(FLOW, 2, { v: 2 }));

      const v1 = await adapter.loadSnapshot(FLOW, 1);
      expect(v1!.version).toBe(1);
      expect(v1!.state).toEqual({ v: 1 });
    });

    it('returns null for a non-existent flow', async () => {
      expect(await adapter.loadSnapshot('no-such-flow')).toBeNull();
    });

    it('returns null for a non-existent version', async () => {
      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      expect(await adapter.loadSnapshot(FLOW, 999)).toBeNull();
    });

    it('preserves complex nested state', async () => {
      const state = { msgs: ['a', 'b'], meta: { score: 3.14, active: true } };
      await adapter.saveSnapshot(makeSnap(FLOW, 1, state));
      expect((await adapter.loadSnapshot(FLOW))!.state).toEqual(state);
    });
  });

  describe('loadHistory', () => {
    it('returns snapshots ordered newest-first', async () => {
      for (let i = 1; i <= 4; i++)
        await adapter.saveSnapshot(makeSnap(FLOW, i));

      const history = await adapter.loadHistory(FLOW);
      expect(history.map((s) => s.version)).toEqual([4, 3, 2, 1]);
    });

    it('applies limit and returns the most recent N', async () => {
      for (let i = 1; i <= 5; i++)
        await adapter.saveSnapshot(makeSnap(FLOW, i));

      const limited = await adapter.loadHistory(FLOW, 3);
      expect(limited.map((s) => s.version)).toEqual([5, 4, 3]);
    });

    it('returns an empty array for a non-existent flow', async () => {
      expect(await adapter.loadHistory('no-such-flow')).toEqual([]);
    });
  });

  describe('deleteFlow', () => {
    it('removes all snapshots for a flow', async () => {
      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      await adapter.deleteFlow(FLOW);

      expect(await adapter.loadSnapshot(FLOW)).toBeNull();
      expect(await adapter.flowExists(FLOW)).toBe(false);
    });

    it('does not throw when deleting a non-existent flow', async () => {
      await expect(adapter.deleteFlow('no-such-flow')).resolves.not.toThrow();
    });

    it('does not affect other flows', async () => {
      await adapter.saveSnapshot(makeSnap(FLOW, 1, { owner: 'A' }));
      await adapter.saveSnapshot(makeSnap('other', 1, { owner: 'B' }));

      await adapter.deleteFlow(FLOW);

      expect(await adapter.loadSnapshot(FLOW)).toBeNull();
      expect((await adapter.loadSnapshot('other'))!.state).toEqual({
        owner: 'B',
      });
    });
  });

  describe('pruneHistory', () => {
    it('keeps only the N most recent versions', async () => {
      for (let i = 1; i <= 5; i++)
        await adapter.saveSnapshot(makeSnap(FLOW, i));

      await adapter.pruneHistory(FLOW, 2);

      const remaining = await adapter.loadHistory(FLOW);
      expect(remaining).toHaveLength(2);
      expect(remaining[0].version).toBe(5);
      expect(remaining[1].version).toBe(4);
    });

    it('is a no-op when keepLast >= total', async () => {
      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      await adapter.saveSnapshot(makeSnap(FLOW, 2));
      await adapter.pruneHistory(FLOW, 10);

      expect(await adapter.getSnapshotCount(FLOW)).toBe(2);
    });

    it('does not throw for a non-existent flow', async () => {
      await expect(
        adapter.pruneHistory('no-such-flow', 3)
      ).resolves.not.toThrow();
    });
  });

  describe('getSnapshotCount / flowExists', () => {
    it('returns 0 / false for an unknown flow', async () => {
      expect(await adapter.getSnapshotCount('no-such-flow')).toBe(0);
      expect(await adapter.flowExists('no-such-flow')).toBe(false);
    });

    it('increments count and reports existence correctly', async () => {
      expect(await adapter.flowExists(FLOW)).toBe(false);

      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      expect(await adapter.getSnapshotCount(FLOW)).toBe(1);
      expect(await adapter.flowExists(FLOW)).toBe(true);

      await adapter.saveSnapshot(makeSnap(FLOW, 2));
      expect(await adapter.getSnapshotCount(FLOW)).toBe(2);
    });

    it('returns false after the flow is deleted', async () => {
      await adapter.saveSnapshot(makeSnap(FLOW, 1));
      await adapter.deleteFlow(FLOW);
      expect(await adapter.flowExists(FLOW)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests — custom adapter plugged into ChatGraph
// ---------------------------------------------------------------------------

describe('Custom SQLiteStorageAdapter — plugged into ChatGraph', () => {
  const schema = z.object({
    name: z.string().default(''),
    messages: z.array(z.string()).registerReducer(registry, {
      default: () => [],
      reducer: { fn: (_p, n) => n },
    }),
  });

  let adapter: SQLiteStorageAdapter;

  beforeEach(() => {
    adapter = new SQLiteStorageAdapter();
  });

  it('auto-saves state after each invoke', async () => {
    const graph = new ChatGraph({
      id: 'sqlite-chat',
      schema,
      registry,
      storageAdapter: adapter,
      autoSave: true,
      nodes: [
        {
          id: 'greet',
          action: { message: 'Hi! What is your name?' },
          validate: { answerKey: 'name' },
        },
        {
          id: 'done',
          action: { message: 'Nice to meet you, {{name}}!' },
          autoAdvance: true,
        },
      ],
      edges: [
        { from: START, to: 'greet' },
        { from: 'greet', to: 'done' },
        { from: 'done', to: END },
      ],
    });

    // First invoke — action phase
    await graph.invoke({ userMessage: '' });
    expect(await adapter.flowExists('sqlite-chat')).toBe(true);
    expect(await adapter.getSnapshotCount('sqlite-chat')).toBe(1);

    // Second invoke — validates greet (save v2), then advances into the
    // autoAdvance `done` node and runs its action in the same invoke (save v3)
    await graph.invoke({ userMessage: 'Bob' });
    expect(await adapter.getSnapshotCount('sqlite-chat')).toBe(3);

    expect(graph.state.name).toBe('Bob');
  });

  it('restores graph state from the custom adapter', async () => {
    const graphA = new ChatGraph({
      id: 'sqlite-restore',
      schema,
      registry,
      storageAdapter: adapter,
      autoSave: true,
      nodes: [
        {
          id: 'ask',
          action: { message: 'Name?' },
          validate: { answerKey: 'name' },
        },
        {
          id: 'confirm',
          action: { message: 'Got it, {{name}}!' },
          autoAdvance: true,
        },
      ],
      edges: [
        { from: START, to: 'ask' },
        { from: 'ask', to: 'confirm' },
        { from: 'confirm', to: END },
      ],
    });

    await graphA.invoke({ userMessage: '' });
    await graphA.invoke({ userMessage: 'Carol' });
    // graphA is mid-flow (confirm node running)

    // Restore into a brand-new graph instance using the same adapter
    const graphB = new ChatGraph({
      id: 'sqlite-restore',
      schema,
      registry,
      storageAdapter: adapter,
      nodes: [
        {
          id: 'ask',
          action: { message: 'Name?' },
          validate: { answerKey: 'name' },
        },
        {
          id: 'confirm',
          action: { message: 'Got it, {{name}}!' },
          autoAdvance: true,
        },
      ],
      edges: [
        { from: START, to: 'ask' },
        { from: 'ask', to: 'confirm' },
        { from: 'confirm', to: END },
      ],
    });

    const restored = await graphB.restoreFromSnapshot();
    expect(restored).toBe(true);
    expect(graphB.state.name).toBe('Carol');
  });

  it('manual saveSnapshot / getSnapshotHistory / deleteSnapshots', async () => {
    const graph = new ChatGraph({
      id: 'sqlite-manual',
      schema,
      registry,
      storageAdapter: adapter,
      autoSave: false, // manual control
      nodes: [
        {
          id: 'ask',
          action: { message: 'Name?' },
          validate: { answerKey: 'name' },
        },
      ],
      edges: [
        { from: START, to: 'ask' },
        { from: 'ask', to: END },
      ],
    });

    await graph.invoke({ userMessage: '' });
    expect(await adapter.flowExists('sqlite-manual')).toBe(false); // autoSave off

    await graph.saveSnapshot();
    expect(await adapter.getSnapshotCount('sqlite-manual')).toBe(1);

    await graph.saveSnapshot();
    expect(await adapter.getSnapshotCount('sqlite-manual')).toBe(2);

    const history = await graph.getSnapshotHistory();
    expect(history).toHaveLength(2);
    expect(history[0].version).toBeGreaterThan(history[1].version);

    await graph.deleteSnapshots();
    expect(await adapter.flowExists('sqlite-manual')).toBe(false);
  });

  it('two independent flows stored in the same SQLite DB do not interfere', async () => {
    const makeGraph = (id: string) =>
      new ChatGraph({
        id,
        schema,
        registry,
        storageAdapter: adapter,
        autoSave: true,
        nodes: [
          {
            id: 'ask',
            action: { message: 'Name?' },
            validate: { answerKey: 'name' },
          },
        ],
        edges: [
          { from: START, to: 'ask' },
          { from: 'ask', to: END },
        ],
      });

    const g1 = makeGraph('flow-1');
    const g2 = makeGraph('flow-2');

    await g1.invoke({ userMessage: '' });
    await g1.invoke({ userMessage: 'Alice' });

    await g2.invoke({ userMessage: '' });
    await g2.invoke({ userMessage: 'Bob' });

    expect(g1.state.name).toBe('Alice');
    expect(g2.state.name).toBe('Bob');

    expect(await adapter.getSnapshotCount('flow-1')).toBeGreaterThan(0);
    expect(await adapter.getSnapshotCount('flow-2')).toBeGreaterThan(0);

    // Deleting one flow must not touch the other
    await g1.deleteSnapshots();
    expect(await adapter.flowExists('flow-1')).toBe(false);
    expect(await adapter.flowExists('flow-2')).toBe(true);
  });
});
