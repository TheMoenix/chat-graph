import type {
  State,
  ChatEvent,
  StepResult,
  ValidationResult,
  Node,
  NodeAction,
  NodeValidate,
  RunnableNodeAction,
  RunnableNodeValidate,
  Graph,
  ExtractNodeIds,
  Runnable,
  Edge,
  Edges,
  Tracker,
} from './types';

import { START, END } from './constants';

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
> {
  private nodes: Node<Runnable>[] = [];
  private readonly edges: Edges<Nodes, true> = new Map();
  declare private tracker: Tracker<Nodes>;
  declare private graphState: State<S>;

  constructor(config: Graph<Nodes, false, S>) {
    this.tracker = {
      __graphId: config.id,
      __currentNodeId: START,
      __isActionTaken: false,
      __isResponseValid: false,
      __isDone: false,
    };

    // Convert Node[] to ExecutableNode[] by processing actions and validations
    console.log(config.nodes);
    this.nodes = this.processNodes(config.nodes);
    console.log(this.nodes);

    if (config.edges) {
      this.edges = this.processEdges(config.edges);
    }

    if (config.initialState) {
      this.graphState = config.initialState;
    }
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
    const rules = Array.isArray(validate.rules)
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
   * @param state - Current conversation state
   * @param event - User input event
   * @returns Step result with updated state and messages
   */
  async invoke(event: ChatEvent): Promise<StepResult> {
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

      const nextResult = await this.invoke(event);
      return {
        ...result,
        messages: [...result.messages, ...nextResult.messages],
      };
    }

    // Action taken but waiting for validation OR validation failed
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
    this.graphState = {
      ...this.graphState,
      ...actionResult.state,
    };
    if (node.noUserInput) {
      this.tracker.__isResponseValid = true;
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
    this.graphState = {
      ...this.graphState,
      ...validationResult.state,
    };
    if (!validationResult.isValid) {
      return {
        messages: validationResult.errorMessage
          ? [validationResult.errorMessage]
          : [],
      };
    } else {
      // Validation passed
      this.tracker.__isResponseValid = true;
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
   * @param config - Graph configuration
   * @returns The constructed ChatGraph instance
   */
  build(config: { id: string }): ChatGraph<Nodes> {
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
