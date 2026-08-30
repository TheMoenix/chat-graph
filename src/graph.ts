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
  StaticRouter,
  RouterCondition,
  ExtractNodeIds,
  RunnableEdgeTo,
  EdgeTo,
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
import { StateSnapshot, StorageAdapter } from './persistence/storage-adapter';

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
 *     answerKey: "name"
 *   })
 *   .addEdge("__START__", "greet")
 *   .addEdge("greet", "__END__");
 *
 * const result = await flow.compile(state, event);
 * ```
 */
export class ChatGraph<
  Schema extends StateSchema = StateSchema,
  Nodes extends readonly Node<Schema>[] = readonly [],
> {
  private readonly nodes: Node<Schema, Runnable>[] = [];
  private readonly edges: Edges<Nodes, true> = new Map();
  declare private tracker: Tracker<Nodes>;
  declare private graphState: InferState<Schema>;
  private readonly schema?: Schema;
  private readonly registry?: StateRegistry;
  private readonly stateManager?: StateManager<Schema>;
  /** Messages produced during the current turn. Never persisted. */
  private emitted: string[] = [];
  private readonly id: string;
  private readonly autoSave: boolean = false;

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
    this.autoSave = config.autoSave ?? true;
    this.id = config.id;

    // Initialize state manager if storageAdapter is provided
    if (config.storageAdapter !== undefined) {
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

    if (config.edges.length > 0) {
      this.edges = this.processEdges(config.edges);
    }

    // Initialize state with schema defaults or provided initial state
    this.graphState = createInitialState(
      this.schema,
      this.registry,
      config.initialState as Partial<InferState<Schema>>
    );
  }
  /** Current conversation state */
  get state(): InferState<Schema> {
    return { ...this.graphState };
  }

  /** Whether the flow has completed */
  get isDone(): boolean {
    return this.tracker.__isDone;
  }

  /**
   * Messages produced by the most recent invoke(), in order.
   * Cleared at the start of each turn and never persisted, so a restored
   * snapshot starts a turn with an empty list.
   */
  get emittedMessages(): string[] {
    return [...this.emitted];
  }

  /**
   * Processes nodes to convert config-based definitions to executable functions
   */
  private processNodes(
    nodes: readonly Node<Schema>[]
  ): Node<Schema, Runnable>[] {
    return nodes.map((node) => {
      if (node.autoAdvance === true) {
        return {
          id: node.id,
          action: this.createAction(node.action),
          autoAdvance: node.autoAdvance,
        };
      } else {
        return {
          id: node.id,
          action: this.createAction(node.action),
          validate:
            node.validate !== null && node.validate !== undefined
              ? this.createValidate(node.validate)
              : undefined,
        };
      }
    });
  }

  private processEdges(edges: Edges<Nodes, false>): Edges<Nodes, true> {
    const edgeMap: Edges<Nodes, true> = new Map();

    for (const edge of edges) {
      edgeMap.set(edge.from, this.createRouter(edge.to));
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
      }) as unknown as Partial<InferState<Schema>>;
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
    const rules = validate.rules ?? [];

    return (
      _: InferState<Schema>,
      event: ChatEvent
    ): ValidationResult<Schema> => {
      const input = event.userMessage;

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

      // All passed - save to answerKey if specified
      const updates =
        validate.answerKey !== null && validate.answerKey !== undefined
          ? { [validate.answerKey]: input }
          : {};

      return {
        isValid: true,
        state: updates as Partial<InferState<Schema>>,
      };
    };
  }

  /**
   * Creates a router function from config (supports both functions and JSON-based routers)
   */
  private createRouter(
    router: EdgeTo<Nodes, Schema>
  ): RunnableEdgeTo<Nodes, Schema> {
    // If it's already a function or string/END, return as is
    if (typeof router === 'function' || typeof router === 'string') {
      return router;
    }

    // It's a StaticRouter object - convert to function
    const staticRouter = router as StaticRouter<Nodes, Schema>;
    return (state: InferState<Schema>): ExtractNodeIds<Nodes> | typeof END => {
      // Evaluate conditions in order
      for (const condition of staticRouter.conditions) {
        if (this.evaluateCondition(state, condition)) {
          return condition.goto as ExtractNodeIds<Nodes> | typeof END;
        }
      }
      // No conditions matched, use default
      return staticRouter.default as ExtractNodeIds<Nodes> | typeof END;
    };
  }

  /**
   * Evaluates a single routing condition against the current state
   */
  private evaluateCondition(
    state: InferState<Schema>,
    condition: RouterCondition<Nodes, Schema>
  ): boolean {
    const currentStateValue = state[condition.field];
    const { operator, value } = condition;

    switch (operator) {
      case 'equals':
        return currentStateValue === value;
      case 'not_equals':
        return currentStateValue !== value;
      case 'gt':
        return currentStateValue > value;
      case 'gte':
        return currentStateValue >= value;
      case 'lt':
        return currentStateValue < value;
      case 'lte':
        return currentStateValue <= value;
      case 'contains':
        if (typeof currentStateValue === 'string') {
          return currentStateValue.includes(value as string);
        }
        if (Array.isArray(currentStateValue)) {
          return currentStateValue.includes(value);
        }
        return false;
      case 'not_contains':
        if (typeof currentStateValue === 'string') {
          return !currentStateValue.includes(value as string);
        }
        if (Array.isArray(currentStateValue)) {
          return !currentStateValue.includes(value);
        }
        return true;
      case 'regex':
        if (typeof currentStateValue === 'string') {
          const regex = new RegExp(value as string);
          return regex.test(currentStateValue);
        }
        return false;
      case 'in':
        if (Array.isArray(value)) {
          return value.includes(currentStateValue);
        }
        return false;
      case 'not_in':
        if (Array.isArray(value)) {
          return !value.includes(currentStateValue);
        }
        return true;
      default:
        return false;
    }
  }

  /**
   * Interpolates variables in text using {key} syntax
   */
  private interpolate(text: string, state: InferState<Schema>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
      String(state[key])
    );
  }

  /**
   * Compiles and executes the flow recursively until waiting for user input
   *
   * @param event - User input event
   * @returns The updated state
   */
  async invoke(event: ChatEvent): Promise<InferState<Schema>> {
    this.emitted = [];

    if (this.stateManager !== undefined) {
      const snapshot = await this.stateManager.load(this.id);
      if (snapshot !== null) {
        this.graphState = snapshot.state;
        this.tracker = snapshot.tracker as Tracker<Nodes>;
      }
    }

    await this.subInvoke(event);
    return this.graphState;
  }

  private async subInvoke(event: ChatEvent): Promise<void> {
    if (this.tracker.__currentNodeId === START) {
      await this.getNextNode(event);
    }
    await this.executeNode(event);

    // If both phases complete (action taken + validated), move to next node
    if (
      this.tracker.__isActionTaken === true &&
      this.tracker.__isResponseValid === true
    ) {
      await this.getNextNode(event);

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

    if (node === undefined) {
      console.warn(`Node not found: ${this.tracker.__currentNodeId}`);
      return;
    }

    if (this.tracker.__isActionTaken === false) {
      await this.executeNodeAction(node, event);
    } else if (this.tracker.__isResponseValid === false) {
      await this.executeNodeValidation(node, event);
    }
  }

  /**
   * Applies a state update through the schema reducers, recording any messages
   * it carries as output of the current turn.
   *
   * Messages are recorded from the update rather than from the merged state:
   * what a turn produced is independent of what the `messages` reducer chooses
   * to keep, so no reducer configuration can hide or duplicate turn output.
   */
  private applyStateUpdate(update: Partial<InferState<Schema>>): void {
    const produced: unknown = (update as { messages?: unknown }).messages;
    if (Array.isArray(produced)) {
      for (const message of produced as unknown[]) {
        this.emitted.push(String(message));
      }
    }

    this.graphState = mergeState(
      this.schema,
      this.registry,
      this.graphState,
      update
    );
  }

  private async executeNodeAction(
    node: Node<Schema, Runnable>,
    event: ChatEvent
  ): Promise<void> {
    const stateUpdate = await node.action(this.graphState, event);
    this.tracker.__isActionTaken = true;

    // Apply state update with reducers (no runtime validation)
    this.applyStateUpdate(stateUpdate);

    if (node.autoAdvance === true) {
      this.tracker.__isResponseValid = true;
    }

    // Auto-save snapshot if enabled
    if (this.autoSave === true && this.stateManager !== undefined) {
      await this.stateManager.save(this.id, this.graphState, this.tracker);
    }
  }

  private async executeNodeValidation(
    node: Node<Schema, Runnable>,
    event: ChatEvent
  ): Promise<void> {
    if (node.validate === null || node.validate === undefined) {
      // No validation needed, mark as valid
      this.tracker.__isResponseValid = true;
      return;
    }

    const validationResult = await node.validate(this.graphState, event);

    // Merge state using schema reducers if available
    if (validationResult.state !== undefined) {
      // Apply state update with reducers (no runtime validation)
      this.applyStateUpdate(validationResult.state);
    }

    if (!validationResult.isValid) {
      // Add error message to state messages if validation failed
      if (validationResult.errorMessage !== undefined) {
        this.applyStateUpdate({
          messages: [validationResult.errorMessage],
        } as unknown as Partial<InferState<Schema>>);
      }
    } else {
      // Validation passed
      this.tracker.__isResponseValid = true;

      // Auto-save snapshot if enabled
      if (this.autoSave === true && this.stateManager !== undefined) {
        await this.stateManager.save(this.id, this.graphState, this.tracker);
      }
    }
  }

  /**
   * Determines the next node based on edges and conditional routing
   */
  private async getNextNode(event: ChatEvent): Promise<void> {
    if (this.edges.has(this.tracker.__currentNodeId)) {
      const to = this.edges.get(this.tracker.__currentNodeId);
      if (to === undefined) {
        console.warn(
          `Edge target not found for node: ${this.tracker.__currentNodeId}`
        );
        this.tracker.__currentNodeId = END;
        return;
      }
      if (typeof to === 'function') {
        this.tracker.__currentNodeId = await to(this.graphState, event);
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
    if (this.stateManager === undefined) {
      return false;
    }

    const snapshot = await this.stateManager.load(this.id, version);
    if (snapshot === null) {
      return false;
    }

    this.graphState = snapshot.state;
    this.tracker = snapshot.tracker as Tracker<Nodes>;
    return true;
  }

  /**
   * Get the complete history of snapshots for this flow
   */
  async getSnapshotHistory(limit?: number): Promise<StateSnapshot<Schema>[]> {
    if (this.stateManager === undefined) {
      return [];
    }
    return this.stateManager.getHistory(this.id, limit);
  }

  /**
   * Manually save a snapshot
   */
  async saveSnapshot(): Promise<number | null> {
    if (this.stateManager === undefined) {
      return null;
    }
    return this.stateManager.save(this.id, this.graphState, this.tracker);
  }

  /**
   * Delete all snapshots for this flow
   */
  async deleteSnapshots(): Promise<void> {
    if (this.stateManager === undefined) {
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
  private readonly schema: Schema;
  private readonly registry: StateRegistry;
  private readonly nodes: Node<Schema>[] = [];
  private readonly edges: Edges<Nodes> = [];

  constructor({
    schema,
    registry: stateRegistry,
  }: {
    schema: Schema;
    registry?: StateRegistry;
  }) {
    this.schema = schema;
    this.registry = stateRegistry ?? registry;
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
    return this as unknown as ChatGraphBuilder<Schema, [...Nodes, NewNode]>;
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
  }): ChatGraph<Schema, Nodes> {
    return new ChatGraph<Schema, Nodes>({
      ...config,
      schema: this.schema,
      registry: this.registry,
      nodes: this.nodes as Nodes,
      edges: this.edges,
    });
  }
}
