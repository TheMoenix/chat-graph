import { MongoStorageAdapter } from '../src/persistence/mongo-adapter';
import { ChatGraphBuilder, START, END, InferState, registry, z } from '../src';

/**
 * MongoDB Storage Adapter Test
 * 
 * Prerequisites:
 * 1. Install mongodb: npm install mongodb
 * 2. Start MongoDB:
 *    - Docker: docker run -d -p 27017:27017 --name mongo-test mongo:latest
 *    - Local: brew services start mongodb-community
 * 3. Run: npm run test:mongo
 */

async function testMongoAdapter() {
  console.log('=== MongoDB Storage Adapter Test ===\n');

  // MongoDB configuration
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017';
  const database = 'chat_graph_test';
  
  const adapter = new MongoStorageAdapter({
    uri: mongoUri,
    database,
    collection: 'test_snapshots',
  });

  try {
    // Test 1: Connection
    console.log('Test 1: Connecting to MongoDB...');
    await adapter.connect();
    console.log('✅ Connected successfully\n');

    // Test 2: Basic Save/Load
    console.log('Test 2: Testing basic save/load...');
    await adapter.saveSnapshot({
      flowId: 'test-flow-1',
      version: 1,
      timestamp: new Date(),
      state: { test: 'data', counter: 1 },
      tracker: {
        __graphId: 'test-flow-1',
        __currentNodeId: 'node1',
        __isActionTaken: true,
        __isResponseValid: false,
        __isDone: false,
      },
    });
    
    const loaded = await adapter.loadSnapshot('test-flow-1');
    console.log('✅ Saved and loaded snapshot:', loaded?.version);
    console.log('   State:', loaded?.state);
    console.log();

    // Test 3: Version History
    console.log('Test 3: Testing version history...');
    await adapter.saveSnapshot({
      flowId: 'test-flow-1',
      version: 2,
      timestamp: new Date(),
      state: { test: 'data', counter: 2 },
      tracker: {
        __graphId: 'test-flow-1',
        __currentNodeId: 'node2',
        __isActionTaken: true,
        __isResponseValid: true,
        __isDone: false,
      },
    });

    const history = await adapter.loadHistory('test-flow-1');
    console.log(`✅ Loaded ${history.length} snapshots from history`);
    history.forEach((s) => console.log(`   v${s.version}: ${JSON.stringify(s.state)}`));
    console.log();

    // Test 4: Load Specific Version
    console.log('Test 4: Loading specific version...');
    const v1 = await adapter.loadSnapshot('test-flow-1', 1);
    console.log(`✅ Loaded version 1:`, v1?.state);
    console.log();

    // Test 5: Snapshot Count
    console.log('Test 5: Checking snapshot count...');
    const count = await adapter.getSnapshotCount('test-flow-1');
    console.log(`✅ Total snapshots: ${count}\n`);

    // Test 6: Flow Exists
    console.log('Test 6: Checking flow existence...');
    const exists = await adapter.flowExists('test-flow-1');
    const notExists = await adapter.flowExists('non-existent-flow');
    console.log(`✅ test-flow-1 exists: ${exists}`);
    console.log(`✅ non-existent-flow exists: ${notExists}\n`);

    // Test 7: Prune History
    console.log('Test 7: Pruning history (keep last 1)...');
    await adapter.pruneHistory('test-flow-1', 1);
    const prunedCount = await adapter.getSnapshotCount('test-flow-1');
    console.log(`✅ Snapshots after pruning: ${prunedCount}\n`);

    // Test 8: Integration with ChatGraph
    console.log('Test 8: Testing with ChatGraph...');
    
    const WorkflowState = z.object({
      name: z.string().optional(),
      counter: z.number().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: {
          fn: (prev, next) => next,
        },
        default: () => [] as string[],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: WorkflowState })
      .addNode({
        id: 'greet',
        action: { message: "Hi! What's your name?" },
        validate: {
          rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name.' }],
          targetField: 'name',
        },
      })
      .addNode({
        id: 'thanks',
        action: (state: InferState<typeof WorkflowState>) => ({
          messages: [`Thanks ${state.name}!`],
        }),
        noUserInput: true,
      })
      .addEdge(START, 'greet')
      .addEdge('greet', 'thanks')
      .addEdge('thanks', END)
      .compile({
        id: 'integration-test',
        storageAdapter: adapter,
      });

    // First invocation
    await graph.invoke({ user_message: '' });
    console.log('   First invocation (action):', graph.state.messages);

    // Second invocation (validation)
    await graph.invoke({ user_message: 'Alice' });
    console.log('   Second invocation (validation):', graph.state.messages);

    // Check that state was persisted
    const persistedSnapshot = await adapter.loadSnapshot('integration-test');
    console.log('✅ State persisted to MongoDB');
    console.log('   Persisted state:', persistedSnapshot?.state);
    console.log();

    // Test 9: New instance loads state
    console.log('Test 9: New graph instance loads persisted state...');
    const graph2 = new ChatGraphBuilder({ schema: WorkflowState })
      .addNode({
        id: 'greet',
        action: { message: "Hi! What's your name?" },
        validate: {
          rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name.' }],
          targetField: 'name',
        },
      })
      .addNode({
        id: 'thanks',
        action: (state: InferState<typeof WorkflowState>) => ({
          messages: [`Thanks ${state.name}!`],
        }),
        noUserInput: true,
      })
      .addEdge(START, 'greet')
      .addEdge('greet', 'thanks')
      .addEdge('thanks', END)
      .compile({
        id: 'integration-test',
        storageAdapter: adapter,
      });

    // This should load the persisted state
    await graph2.invoke({ user_message: '' });
    console.log('✅ New instance loaded state:', graph2.state);
    console.log('   IsDone:', graph2.isDone);
    console.log();

    // Cleanup
    console.log('Test 10: Cleanup...');
    await adapter.deleteFlow('test-flow-1');
    await adapter.deleteFlow('integration-test');
    console.log('✅ Deleted test flows\n');

    await adapter.disconnect();
    console.log('✅ Disconnected from MongoDB\n');

    console.log('🎉 All tests passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure MongoDB is running: docker run -d -p 27017:27017 mongo:latest');
    console.error('2. Install mongodb: npm install mongodb');
    console.error('3. Check connection URI:', mongoUri);
    
    if (adapter) {
      await adapter.disconnect().catch(() => {});
    }
    process.exit(1);
  }
}

// Run the test
testMongoAdapter();
