import type {
  ChatEvent,
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
  Schema extends StateSchema = any,
  Nodes extends readonly Node<Schema>[] = readonly [],
> {
  private nodes: Node<Schema, Runnable>[] = [];
  private readonly edges: Edges<Nodes, true> = new Map();
  declare private tracker: Tracker<Nodes>;
  declare private graphState: InferState<Schema>;
  private schema?: Schema;
  private registry?: StateRegistry;
  private stateManager?: StateManager<Schema>;
  private id: string;
  private autoSave: boolean = false;

  constructor(
    config: Graph<Nodes, false> & {
      schema?: Schema;
      registry?: StateRegistry;
      storageAdapter?: StorageAdapter;
      autoSave?: boolean;
    }
  ) {
    this.schema = config.schema;
    this.registry = config.registry;
    this.autoSave = config.autoSave !== undefined ? config.autoSave : true;
    this.id = config.id;

    // Initialize state manager if storageAdapter is provided
    if (config.storageAdapter) {
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
    );
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
  private processNodes(
    nodes: readonly Node<Schema>[]
  ): Node<Schema, Runnable>[] {
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
  private createAction(action: NodeAction<Schema>): RunnableNodeAction<Schema> {
    if (typeof action === 'function') {
      return action;
    }

    // Simple message object - returns state update with messages
    // Only return new message - reducer will handle concatenation
    return (state: InferState<Schema>): Partial<InferState<Schema>> =>
      ({
        messages: [this.interpolate(action.message, state)],
      }) as any; // Partial<InferState<Schema>>
  }

  /**
   * Creates a validation function from config
   */
  private createValidate(
    validate: NodeValidate<Schema>
  ): RunnableNodeValidate<Schema> {
    if (typeof validate === 'function') {
      return validate;
    }

    // Array of validators (run all in sequence)
    const rules = !validate.rules
      ? []
      : Array.isArray(validate.rules)
        ? validate.rules
        : [validate.rules];

    return (
      _: InferState<Schema>,
      event: ChatEvent
    ): ValidationResult<Schema> => {
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
        state: updates as Partial<InferState<Schema>>,
      };
    };
  }

  /**
   * Interpolates variables in text using {key} syntax
   */
  private interpolate(text: string, state: InferState<Schema>): string {
    return text.replace(
      /\{\{(\w+)\}\}/g,
      (_, key) => (state as any)[key] || ''
    );
  }

  /**
   * Compiles and executes the flow recursively until waiting for user input
   *
   * @param event - User input event
   * @returns The updated state
   */
  async invoke(event: ChatEvent): Promise<InferState<Schema>> {
    if (this.stateManager) {
      const snapshot = await this.stateManager.load(this.id);
      if (snapshot) {
        this.graphState = snapshot.state;
        this.tracker = snapshot.tracker as Tracker<Nodes>;
      }
    }

    await this.subInvoke(event);
    return this.graphState;
  }

  private async subInvoke(event: ChatEvent): Promise<void> {
    if (this.tracker.__currentNodeId === START) {
      await this.getNextNode();
    }
    await this.executeNode(event);

    // If both phases complete (action taken + validated), move to next node
    if (this.tracker.__isActionTaken && this.tracker.__isResponseValid) {
      await this.getNextNode();

      // Check if flow is done
      if (this.tracker.__currentNodeId === END) {
        this.tracker.__isDone = true;
        return;
      }

      this.tracker = {
        ...this.tracker,
        __isActionTaken: false,
        __isResponseValid: false,
      };

      await this.subInvoke(event);
    }
  }

  /**
   * Executes a single node (one phase: action or validation)
   */
  private async executeNode(event: ChatEvent): Promise<void> {
    const node = this.nodes.find((n) => n.id === this.tracker.__currentNodeId);

    if (!node) {
      console.warn(`Node not found: ${this.tracker.__currentNodeId}`);
      return;
    }

    if (!this.tracker.__isActionTaken) {
      await this.executeNodeAction(node, event);
    } else if (!this.tracker.__isResponseValid && node.validate) {
      await this.executeNodeValidation(node, event);
    } else if (!node.validate) {
      this.tracker.__isResponseValid = true;
    }
  }

  private async executeNodeAction(
    node: Node<Schema, Runnable>,
    event: ChatEvent
  ): Promise<void> {
    const stateUpdate = await node.action(this.graphState, event);
    this.tracker.__isActionTaken = true;

    // Merge state using schema reducers if available
    if (stateUpdate) {
      // Apply state update with reducers (no runtime validation)
      this.graphState = mergeState(
        this.schema,
        this.registry,
        this.graphState,
        stateUpdate
      );
    }

    if (node.noUserInput) {
      this.tracker.__isResponseValid = true;
    }

    // Auto-save snapshot if enabled
    if (this.autoSave && this.stateManager) {
      await this.stateManager.save(this.id, this.graphState, this.tracker);
    }
  }

  private async executeNodeValidation(
    node: Node<Schema, Runnable>,
    event: ChatEvent
  ): Promise<void> {
    if (!node.validate) {
      // No validation needed, mark as valid
      this.tracker.__isResponseValid = true;
      return;
    }

    const validationResult = await node.validate(this.graphState, event);

    // Merge state using schema reducers if available
    if (validationResult.state) {
      // Apply state update with reducers (no runtime validation)
      this.graphState = mergeState(
        this.schema,
        this.registry,
        this.graphState,
        validationResult.state
      );
    }

    if (!validationResult.isValid) {
      // Add error message to state messages if validation failed
      if (validationResult.errorMessage) {
        this.graphState = mergeState(
          this.schema,
          this.registry,
          this.graphState,
          {
            messages: [validationResult.errorMessage],
          } as any // Partial<InferState<Schema>>
        );
      }
    } else {
      // Validation passed
      this.tracker.__isResponseValid = true;

      // Auto-save snapshot if enabled
      if (this.autoSave && this.stateManager) {
        await this.stateManager.save(this.id, this.graphState, this.tracker);
      }
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
    if (!this.stateManager) {
      console.warn('Cannot restore: stateManager not configured');
      return false;
    }

    const snapshot = await this.stateManager.load(this.id, version);
    if (!snapshot) {
      return false;
    }

    this.graphState = snapshot.state;
    this.tracker = snapshot.tracker as Tracker<Nodes>;
    return true;
  }

  /**
   * Get the complete history of snapshots for this flow
   */
  async getSnapshotHistory(limit?: number) {
    if (!this.stateManager) {
      return [];
    }
    return await this.stateManager.getHistory(this.id, limit);
  }

  /**
   * Manually save a snapshot
   */
  async saveSnapshot(): Promise<number | null> {
    if (!this.stateManager) {
      return null;
    }
    return await this.stateManager.save(this.id, this.graphState, this.tracker);
  }

  /**
   * Delete all snapshots for this flow
   */
  async deleteSnapshots(): Promise<void> {
    if (!this.stateManager) {
      return;
    }
    await this.stateManager.delete(this.id);
  }

  /**
   * Get the state manager instance
   */
  getStateManager(): StateManager<Schema> | undefined {
    return this.stateManager;
  }
}

/**
 * StateGraph - typed builder with Zod schema
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
export class ChatGraphBuilder<
  Schema extends StateSchema,
  Nodes extends Node<Schema>[] = [],
> {
  private schema: Schema;
  private registry: StateRegistry;
  private nodes: Node<Schema>[] = [];
  private edges: Edges<Nodes> = [];

  constructor({
    schema,
    registry: StateRegistry,
  }: {
    schema: Schema;
    registry?: StateRegistry;
  }) {
    this.schema = schema;
    this.registry = StateRegistry || registry;
  }

  /**
   * Adds a node to the graph
   *
   * @param node - Node configuration
   * @returns The flow instance for chaining
   */
  addNode<const NewNode extends Node<Schema>>(
    node: NewNode
  ): ChatGraphBuilder<Schema, [...Nodes, NewNode]> {
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
  addEdge(from: Edge<Nodes>['from'], to: Edge<Nodes, Schema>['to']): this {
    this.edges.push({ from, to });
    return this;
  }

  /**
   * Compile the graph into a ChatGraph instance
   */
  compile(config: {
    id: string;
    storageAdapter?: StorageAdapter;
    autoSave?: boolean;
    initialState?: Partial<InferState<Schema>>;
  }): ChatGraph<Schema> {
    return new ChatGraph({
      ...config,
      schema: this.schema,
      registry: this.registry,
      nodes: this.nodes as any,
      edges: this.edges as any,
    }) as any;
  }
}
