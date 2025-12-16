/**
 * Example: Using Zod schemas for state management (LangGraph-style)
 *
 * This example demonstrates how to use Zod schemas with the StateGraph class
 * to create type-safe workflows with reducer functions.
 */

import { StateGraph, registry, START, END, z } from '../src';

// Create a registry for field configurations (reducers and defaults)
// const registry = createRegistry();

// Define the state schema using Zod with reducer support
const WorkflowState = z.object({
  // Simple string field
  currentStep: z.string().default(''),

  // Number field with default
  count: z.number().default(0),

  // Array field with reducer that concatenates arrays
  messages: z.array(z.string()).registerReducer(registry, {
    reducer: {
      fn: (prev, next) => prev.concat(next),
    },
    default: () => [] as string[],
  }),

  // Array of numbers with a custom reducer
  scores: z.array(z.number()).registerReducer(registry, {
    reducer: {
      fn: (prev, next) => prev.concat(next),
    },
    default: () => [] as number[],
  }),
});

// Create the workflow graph (matching your LangGraph example!)
const workflow = new StateGraph(WorkflowState, registry)
  .addNode('nodeA', (state) => {
    console.log('Node A executing with state:', state);
    return {
      currentStep: 'A',
      messages: ['Message from A'],
      scores: [10],
      count: state.count + 1,
    };
  })
  .addNode('nodeB', (state) => {
    console.log('Node B executing with state:', state);
    return {
      currentStep: 'B',
      messages: ['Message from B'],
      scores: [20],
      count: state.count + 1,
    };
  })
  .addNode('nodeC', (state) => {
    console.log('Node C executing with state:', state);
    return {
      currentStep: 'C',
      messages: ['Message from C'],
      scores: [30],
      count: state.count + 1,
    };
  })
  .addEdge(START, 'nodeA')
  .addEdge('nodeA', 'nodeB')
  .addEdge('nodeB', 'nodeC')
  .addEdge('nodeC', END);

// Compile the graph
const graph = workflow.compile({
  id: 'zod-workflow-example',
  initialState: {
    count: 0,
  },
});

// Run the workflow
async function runWorkflow() {
  console.log('\n=== Running Zod State Workflow ===\n');

  const result = await graph.invoke({ user_message: '' });

  console.log('\n=== Workflow Complete ===\n');
  console.log('Final State:', graph.state);
  console.log('Result:', result);

  // The state should have:
  // - currentStep: 'C'
  // - count: 3
  // - messages: ['Message from A', 'Message from B', 'Message from C']
  // - scores: [10, 20, 30]
}

// Run the example
runWorkflow().catch(console.error);
