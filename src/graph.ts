import type {
  ChatEvent,
  StepResult,
  ValidationResult,
  Node,
  NodeAction,
  NodeValidate,
  RunnableNodeAction,
  RunnableNodeValidate,
  Graph,
  Runnable,
  Edge,
  Edges,
  Tracker,
} from './types/graph.types';

import { START, END } from './constants';
import { State } from './types/state.types';
import {
  StateSchema,
  InferState,
  mergeState,
  createInitialState,
  StateRegistry,
  registry,
} from './schema/state-schema';
import { StateManager } from './state-manager';
import { StorageAdapter } from './persistence/storage-adapter';

/**
 * Flow engine that executes conversation flows with two-phase nodes (action + validation)
 *
 * @example
 * ```typescript
 * const flow = new Flow("onboarding", "User Onboarding");
 *
 * flow
 *   .addNode("greet", {
 *     action: { message: "Hi! What's your name?" },
 *     validate: { regex: "\\w+", errorMessage: "Enter a valid name" },
 *     targetField: "name"
 *   })
 *   .addEdge("__START__", "greet")
 *   .addEdge("greet", "__END__");
 *
 * const result = await flow.compile(state, event);
 * ```
 */
export class ChatGraph<
  Nodes extends readonly Node[] = readonly [],
  S extends State = {},
  Schema extends StateSchema = any,
> {
  private nodes: Node<Runnable>[] = [];
  private readonly edges: Edges<Nodes, true> = new Map();
  declare private tracker: Tracker<Nodes>;
  declare private graphState: State<S>;
  private schema?: Schema;
  private registry?: StateRegistry;
  private stateManager?: StateManager<Schema>;
  private flowId?: string;
  private autoSave: boolean = false;

  constructor(
    config: Graph<Nodes, false, S> & {
      schema?: Schema;
      registry?: StateRegistry;
      flowId?: string;
      storageAdapter?: StorageAdapter;
      autoSave?: boolean;
    }
  ) {
    this.schema = config.schema;
    this.registry = config.registry;
    this.flowId = config.flowId;
    this.autoSave = config.autoSave !== undefined ? config.autoSave : true;

    // Initialize state manager if flowId is provided
    if (this.flowId) {
      this.stateManager = new StateManager<Schema>(config.storageAdapter);
    }

    this.tracker = {
      __graphId: config.id,
      __currentNodeId: START,
      __isActionTaken: false,
      __isResponseValid: false,
      __isDone: false,
    };

    // Convert Node[] to ExecutableNode[] by processing actions and validations
    this.nodes = this.processNodes(config.nodes);

    if (config.edges) {
      this.edges = this.processEdges(config.edges);
    }

    // Initialize state with schema defaults or provided initial state
    this.graphState = createInitialState(
      this.schema,
      this.registry,
      config.initialState as any
    ) as State<S>;
  }
  /** Current conversation state */
  get state() {
    return { ...this.graphState };
  }

  /** Whether the flow has completed */
  get isDone() {
    return this.tracker.__isDone;
  }

  /**
   * Processes nodes to convert config-based definitions to executable functions
   */
  private processNodes(nodes: readonly Node[]): Node<Runnable>[] {
    return nodes.map((node) => {
      if (node.noUserInput)
        return {
          id: node.id,
          action: this.createAction(node.action),
          noUserInput: node.noUserInput,
        };
      else
        return {
          id: node.id,
          action: this.createAction(node.action),
          validate: node.validate
            ? this.createValidate(node.validate)
            : undefined,
        };
    });
  }

  private processEdges(edges: Edges<Nodes, false>): Edges<Nodes, true> {
    const edgeMap: Edges<Nodes, true> = new Map();

    for (const edge of edges) {
      edgeMap.set(edge.from, edge.to);
    }

    return edgeMap;
  }

  /**
   * Creates an action function from config
   */
  private createAction(action: NodeAction): RunnableNodeAction {
    if (typeof action === 'function') {
      return action;
    }

    // Simple message object
    return (state: State) => ({
      messages: [this.interpolate(action.message, state)],
    });
  }

  /**
   * Creates a validation function from config
   */
  private createValidate(validate: NodeValidate): RunnableNodeValidate {
    if (typeof validate === 'function') {
      return validate;
    }

    // Array of validators (run all in sequence)
    const rules = !validate.rules
      ? []
      : Array.isArray(validate.rules)
        ? validate.rules
        : [validate.rules];

    return (_: State, event: ChatEvent): ValidationResult => {
      const input = event.user_message || '';

      // Run all validators
      for (const validator of rules) {
        const regex = new RegExp(validator.regex);
        if (!regex.test(input)) {
          return {
            isValid: false,
            errorMessage: validator.errorMessage,
          };
        }
      }

      // All passed - save to targetField if specified
      const updates =
        validate && 'targetField' in validate && validate.targetField
          ? { [validate.targetField]: input }
          : {};

      return {
        isValid: true,
        state: updates,
      };
    };
  }

  /**
   * Interpolates variables in text using {key} syntax
   */
  private interpolate(text: string, state: State): string {
    return text.replace(/\{(\w+)\}/g, (_, key) => state[key] || '');
  }

  /**
   * Compiles and executes the flow recursively until waiting for user input
   *
   * @param event - User input event
   * @returns Step result with updated state and messages
   */
  async invoke(event: ChatEvent): Promise<StepResult> {
    if (this.flowId && this.stateManager) {
      const snapshot = await this.stateManager.load(this.flowId);
      if (snapshot) {
        this.graphState = snapshot.state as State<S>;
        this.tracker = snapshot.tracker as Tracker<Nodes>;
      }
    }

    return this.subInvoke(event);
  }

  private async subInvoke(event: ChatEvent): Promise<StepResult> {
    if (this.tracker.__currentNodeId === START) {
      await this.getNextNode();
    }
    const result = await this.executeNode(event);

    // If both phases complete (action taken + validated), move to next node
    if (this.tracker.__isActionTaken && this.tracker.__isResponseValid) {
      await this.getNextNode();

      // Check if flow is done
      if (this.tracker.__currentNodeId === END) {
        this.tracker.__isDone = true;
        return result;
      }

      this.tracker = {
        ...this.tracker,
        __isActionTaken: false,
        __isResponseValid: false,
      };

      const nextResult = await this.subInvoke(event);
      return {
        ...result,
        messages: [...result.messages, ...nextResult.messages],
      };
    }

    return result;
  }

  /**
   * Executes a single node (one phase: action or validation)
   */
  private async executeNode(event: ChatEvent): Promise<StepResult> {
    // await this.getNextNode(state);
    const node = this.nodes.find((n) => n.id === this.tracker.__currentNodeId);

    if (!node) {
      console.warn(`Node not found: ${this.tracker.__currentNodeId}`);
      return {
        messages: [],
      };
    }

    if (!this.tracker.__isActionTaken) {
      return this.executeNodeAction(node, event);
    } else if (!this.tracker.__isResponseValid && node.validate) {
      return this.executeNodeValidation(node, event);
    } else if (!node.validate) {
      this.tracker.__isResponseValid = true;
    }
    return {
      messages: [],
    };
  }

  private async executeNodeAction(
    node: Node<Runnable>,
    event: ChatEvent
  ): Promise<StepResult> {
    const actionResult = await node.action(this.graphState, event);
    this.tracker.__isActionTaken = true;

    // Merge state using schema reducers if available
    if (actionResult.state) {
      // Apply state update with reducers (no runtime validation)
      this.graphState = mergeState(
        this.schema,
        this.registry,
        this.graphState as any,
        actionResult.state as any
      ) as State<S>;
    }

    if (node.noUserInput) {
      this.tracker.__isResponseValid = true;
    }

    // Auto-save snapshot if enabled
    if (this.autoSave && this.flowId && this.stateManager) {
      await this.stateManager.save(
        this.flowId,
        this.graphState as InferState<Schema>,
        this.tracker
      );
    }

    return {
      messages: actionResult.messages || [],
    };
  }

  private async executeNodeValidation(
    node: Node<Runnable>,
    event: ChatEvent
  ): Promise<StepResult> {
    if (!node.validate) {
      // No validation needed, mark as valid
      this.tracker.__isResponseValid = true;
      return {
        messages: [],
      };
    }

    const validationResult = await node.validate(this.graphState, event);

    // Merge state using schema reducers if available
    if (validationResult.state) {
      // Apply state update with reducers (no runtime validation)
      this.graphState = mergeState(
        this.schema,
        this.registry,
        this.graphState as any,
        validationResult.state as any
      ) as State<S>;
    }

    if (!validationResult.isValid) {
      return {
        messages: validationResult.errorMessage
          ? [validationResult.errorMessage]
          : [],
      };
    } else {
      // Validation passed
      this.tracker.__isResponseValid = true;

      // Auto-save snapshot if enabled
      if (this.autoSave && this.flowId && this.stateManager) {
        await this.stateManager.save(
          this.flowId,
          this.graphState as InferState<Schema>,
          this.tracker
        );
      }

      return {
        messages: [],
      };
    }
  }

  /**
   * Determines the next node based on edges and conditional routing
   */
  private async getNextNode(): Promise<void> {
    if (this.edges.has(this.tracker.__currentNodeId || START)) {
      const to = this.edges.get(this.tracker.__currentNodeId || START)!;
      if (typeof to === 'function') {
        this.tracker.__currentNodeId = await to(this.graphState);
      } else {
        this.tracker.__currentNodeId = to;
      }
      return;
    }
    this.tracker.__currentNodeId = END;
  }

  /**
   * Restore state and tracker from a saved snapshot
   * @param version Optional version to restore (defaults to latest)
   */
  async restoreFromSnapshot(version?: number): Promise<boolean> {
    if (!this.flowId || !this.stateManager) {
      console.warn('Cannot restore: flowId or stateManager not configured');
      return false;
    }

    const snapshot = await this.stateManager.load(this.flowId, version);
    if (!snapshot) {
      return false;
    }

    this.graphState = snapshot.state as State<S>;
    this.tracker = snapshot.tracker as Tracker<Nodes>;
    return true;
  }

  /**
   * Get the complete history of snapshots for this flow
   */
  async getSnapshotHistory(limit?: number) {
    if (!this.flowId || !this.stateManager) {
      return [];
    }
    return await this.stateManager.getHistory(this.flowId, limit);
  }

  /**
   * Manually save a snapshot
   */
  async saveSnapshot(): Promise<number | null> {
    if (!this.flowId || !this.stateManager) {
      return null;
    }
    return await this.stateManager.save(
      this.flowId,
      this.graphState as InferState<Schema>,
      this.tracker
    );
  }

  /**
   * Delete all snapshots for this flow
   */
  async deleteSnapshots(): Promise<void> {
    if (!this.flowId || !this.stateManager) {
      return;
    }
    await this.stateManager.delete(this.flowId);
  }

  /**
   * Get the state manager instance
   */
  getStateManager(): StateManager<Schema> | undefined {
    return this.stateManager;
  }
}

/**
 * Builder class for constructing ChatGraph instances
 *
 * @example
 * ```typescript
 * const flow = createGraph()
 *   .addNode({
 *     id: 'greet',
 *     action: { message: "Hi! What's your name?" },
 *     validate: {
 *       rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name.' }],
 *       targetField: 'name',
 *     },
 *   })
 *   .addNode({
 *     id: 'welcome',
 *     action: { message: "Nice to meet you, {{name}}!" },
 *   })
 *   .addEdge(START, 'greet')
 *   .addEdge('greet', 'welcome')
 *   .addEdge('welcome', END)
 *   .build({ id: 'onboarding' });
 *
 * const state : State = {};
 * const event: ChatEvent = { user_message: "Alice" };
 * const result = await flow.invoke(event, state);
 * console.log(result);
 * // Output:
 * // {
 * //   state: { name: 'Alice' },
 * //   messages: [ "Nice to meet you, Alice!" ],
 * //   done: true
 * // }
 * ```
 */
export class ChatGraphBuilder<Nodes extends Node[] = []> {
  private nodes: Node[] = [];
  private edges: Edges<Nodes> = [];

  /**
   * Adds a node to the graph
   *
   * @param node - Node configuration
   * @returns The flow instance for chaining
   */
  addNode<const NewNode extends Node>(
    node: NewNode
  ): ChatGraphBuilder<[...Nodes, NewNode]> {
    this.nodes.push(node);
    return this as any; // Type assertion needed for generics accumulation
  }

  /**
   * Adds a directed edge from one node to another
   *
   * @param from - Source node ID or "__START__"
   * @param to - Target node ID or "__END__"
   * @returns The flow instance for chaining
   */
  addEdge(from: Edge<Nodes>['from'], to: Edge<Nodes>['to']): this {
    this.edges.push({ from, to });
    return this;
  }

  /**
   * Builds the chat graph
   *
   * @param config - Graph configuration with optional schema and persistence options
   * @returns The constructed ChatGraph instance
   */
  build<Schema extends StateSchema = any>(config: {
    id: string;
    schema?: Schema;
    registry?: StateRegistry;
    flowId?: string;
    storageAdapter?: StorageAdapter;
    autoSave?: boolean;
  }): ChatGraph<Nodes, any, Schema> {
    return new ChatGraph({
      ...config,
      nodes: this.nodes as unknown as Nodes,
      edges: this.edges,
    });
  }
}

/** Helper function to create a new chat graph builder */
export function createGraph() {
  return new ChatGraphBuilder();
}

/**
 * StateGraph - LangGraph-style builder with Zod schema
 *
 * @example
 * ```typescript
 * const registry = createRegistry();
 * const State = z.object({
 *   foo: z.string(),
 *   bar: z.array(z.string()).register(registry, {
 *     reducer: {
 *       fn: (x, y) => x.concat(y),
 *     },
 *     default: () => [] as string[],
 *   }),
 * });
 *
 * const graph = new StateGraph(State, registry)
 *   .addNode("nodeA", (state) => {
 *     return { foo: "a", bar: ["a"] };
 *   })
 *   .addNode("nodeB", (state) => {
 *     return { foo: "b", bar: ["b"] };
 *   })
 *   .addEdge(START, "nodeA")
 *   .addEdge("nodeA", "nodeB")
 *   .addEdge("nodeB", END)
 *   .compile({ id: "my-workflow" });
 * ```
 */
export class StateGraph<Schema extends StateSchema> {
  private schema: Schema;
  private registry: StateRegistry;
  private nodes: Node[] = [];
  private edges: Array<{ from: string; to: string }> = [];

  constructor(schema: Schema, StateRegistry?: StateRegistry) {
    this.schema = schema;
    this.registry = StateRegistry || registry;
  }

  /**
   * Add a node with an action function
   */
  addNode(
    id: string,
    action: (
      state: InferState<Schema>
    ) => Partial<InferState<Schema>> | Promise<Partial<InferState<Schema>>>
  ): this {
    const wrappedAction: RunnableNodeAction = async (state, event) => {
      const result = await action(state as InferState<Schema>);
      return {
        state: result,
        messages: [],
      };
    };

    this.nodes.push({
      id,
      action: wrappedAction,
      noUserInput: true,
    });

    return this;
  }

  /**
   * Add an edge between two nodes
   */
  addEdge(from: string, to: string): this {
    this.edges.push({ from, to });
    return this;
  }

  /**
   * Compile the graph into a ChatGraph instance
   */
  compile(config: {
    id: string;
    flowId?: string;
    storageAdapter?: StorageAdapter;
    autoSave?: boolean;
    initialState?: Partial<InferState<Schema>>;
  }): ChatGraph<any, any, Schema> {
    return new ChatGraph({
      ...config,
      schema: this.schema,
      registry: this.registry,
      nodes: this.nodes as any,
      edges: this.edges as any,
    }) as any;
  }
}
