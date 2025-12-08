import { ChatGraph, createGraph } from '../src/graph';
import { START, END } from '../src';
import type { State, Node } from '../src/types';

/**
 * APPROACH 1: Function-based (Builder Pattern)
 * ✅ Type-safe: Node IDs are inferred and checked at compile time
 * ✅ Fluent API: Easy to read and chain
 * ✅ IDE autocomplete: Full IntelliSense support
 */
const functionBasedFlow = createGraph()
  .addNode({
    id: 'greet',
    action: { message: "Hi! What's your name?" },
    validate: {
      rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name.' }],
      targetField: 'name',
    },
  })
  .addNode({
    id: 'ask_age',
    action: (state) => ({
      messages: [`Nice to meet you, ${state.name}! How old are you?`],
    }),
    validate: {
      rules: [
        {
          regex: '^\\d+$',
          errorMessage: 'Please enter a valid age (numbers only).',
        },
      ],
      targetField: 'age',
    },
  })
  .addNode({
    id: 'confirm',
    action: (state) => ({
      messages: [
        `Great! So you're ${state.name} and ${state.age} years old. Is that correct?`,
      ],
    }),
    validate: {
      rules: [
        {
          regex: '^(yes|no)$',
          errorMessage: 'Please answer yes or no.',
        },
      ],
      targetField: 'confirmed',
    },
  })
  .addEdge(START, 'greet')
  .addEdge('greet', 'ask_age')
  .addEdge('ask_age', 'confirm')
  // Conditional routing based on state
  .addEdge('confirm', (state) => {
    return state.confirmed === 'yes' ? END : 'greet';
  })
  .build({ id: 'onboarding-fn', name: 'Function-Based Onboarding' });

/**
 * APPROACH 2: JSON-based (Declarative)
 * ✅ Serializable: Can be stored in database or config files
 * ✅ Dynamic: Can be generated or modified at runtime
 * ⚠️ Limited type inference: Node IDs are strings, not literal types
 *
 * For full type safety, use `as const` assertion:
 */
// For JSON approach, define nodes with proper typing
const jsonNodes = [
  {
    id: 'greet',
    action: { message: "Hi! What's your name?" },
    validate: {
      rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name.' }],
      targetField: 'name',
    },
  },
  {
    id: 'ask_age',
    action: (state: State) => ({
      messages: [`Nice to meet you, ${state.name}! How old are you?`],
    }),
    validate: {
      rules: [
        {
          regex: '^\\d+$',
          errorMessage: 'Please enter a valid age (numbers only).',
        },
      ],
      targetField: 'age',
    },
  },
  {
    id: 'confirm',
    action: (state: State) => ({
      messages: [
        `Great! So you're ${state.name} and ${state.age} years old. Is that correct?`,
      ],
    }),
    validate: {
      rules: [
        {
          regex: '^(yes|no)$',
          errorMessage: 'Please answer yes or no.',
        },
      ],
      targetField: 'confirmed',
    },
  },
] as const;

type JsonNodeIds = (typeof jsonNodes)[number]['id'];

const jsonBasedFlow = new ChatGraph({
  id: 'onboarding-json',
  name: 'JSON-Based Onboarding',
  nodes: jsonNodes,
  edges: new Map<
    JsonNodeIds | typeof START,
    JsonNodeIds | typeof END | ((state: State) => JsonNodeIds | typeof END)
  >([
    [START, 'greet'],
    ['greet', 'ask_age'],
    ['ask_age', 'confirm'],
    [
      'confirm',
      (state: State) => {
        return state.confirmed === 'yes' ? END : 'greet';
      },
    ],
  ]),
});

/**
 * APPROACH 3: Hybrid - Define nodes separately for reusability
 */
const sharedNodes = [
  {
    id: 'greet',
    action: { message: "Hi! What's your name?" },
    validate: {
      rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name.' }],
      targetField: 'name',
    },
  },
  {
    id: 'farewell',
    action: (state: State) => ({
      messages: [`Goodbye, ${state.name}!`],
    }),
    validate: null,
  },
] as const;

// Type-safe helper to extract node IDs
type NodeIds<T extends readonly Node[]> = T[number]['id'];
type MyNodeIds = NodeIds<typeof sharedNodes>; // 'greet' | 'farewell'

/**
 * APPROACH 4: Factory pattern for dynamic flow creation
 */
function createDynamicFlow(flowType: 'simple' | 'advanced') {
  const builder = createGraph().addNode({
    id: 'start',
    action: { message: 'Welcome!' },
    validate: null,
  });

  if (flowType === 'advanced') {
    builder
      .addNode({
        id: 'advanced_step',
        action: { message: 'This is an advanced feature.' },
        validate: null,
      })
      .addEdge(START, 'start')
      .addEdge('start', 'advanced_step')
      .addEdge('advanced_step', END);
  } else {
    builder.addEdge(START, 'start').addEdge('start', END);
  }

  return builder.build({ id: 'dynamic', name: 'Dynamic Flow' });
}

/**
 * Key TypeScript Generics Concepts Demonstrated:
 *
 * 1. **Generic Type Accumulation**:
 *    ChatGraphBuilder<readonly [...Nodes, NewNode]>
 *    Each .addNode() call accumulates types, building a tuple of node types
 *
 * 2. **Const Type Parameters**:
 *    <const NewNode extends Node>
 *    Preserves literal types like 'greet' instead of widening to string
 *
 * 3. **Type Extraction**:
 *    ExtractNodeIds<Nodes> = Nodes[number]['id']
 *    Extracts union of all node IDs from tuple
 *
 * 4. **Conditional Types**:
 *    RouterNode<Nodes> = (state: State) => NodeId | typeof END
 *    Allows functions as edge targets for conditional routing
 *
 * 5. **Mapped Types**:
 *    EdgesMap<Nodes> = Map<NodeId | START, NodeId | RouterNode | END>
 *    Creates type-safe edge map from node types
 *
 * 6. **Readonly Tuples**:
 *    readonly [...Nodes, NewNode]
 *    Preserves exact order and types of nodes
 *
 * 7. **Type Assertions**:
 *    return this as any
 *    Needed because TypeScript can't prove type accumulation is safe
 *
 * 8. **as const Assertion**:
 *    nodes: [...] as const
 *    Makes array elements readonly and infers literal types
 */

// Example usage
async function demo() {
  const state = {
    __currentNodeId: '',
    __flowId: 'test',
  };

  const result = await functionBasedFlow.compile(state, {
    type: 'user_message',
    payload: 'John',
  });

  console.log('Function-based result:', result);

  const result2 = await jsonBasedFlow.compile(state, {
    type: 'user_message',
    payload: 'Jane',
  });

  console.log('JSON-based result:', result2);

  const dynamicFlow = createDynamicFlow('advanced');
  const result3 = await dynamicFlow.compile(state, {
    type: 'user_message',
    payload: 'test',
  });

  console.log('Dynamic flow result:', result3);
}

// Uncomment to run:
// demo();

export { functionBasedFlow, jsonBasedFlow, createDynamicFlow };
