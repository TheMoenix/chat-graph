import type {
  State,
  ChatEvent,
  StepResult,
  ActionResult,
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
export class ChatGraph<Nodes extends readonly Node[] = readonly []> {
  private nodes: Node<Runnable>[] = [];
  private readonly edges: Edges<Nodes, true> = new Map();
  declare tracker: Tracker<Nodes>;

  constructor(config: Graph<Nodes>) {
    this.tracker = {
      __graphId: config.id,
      __currentNodeId: START,
      __isActionTaken: false,
      __isResponseValid: false,
      __validationAttempted: false,
    };

    // Convert Node[] to ExecutableNode[] by processing actions and validations
    this.nodes = this.processNodes(config.nodes);

    if (config.edges) {
      this.edges = this.processEdges(config.edges);
    }
  }

  /**
   * Processes nodes to convert config-based definitions to executable functions
   */
  private processNodes(nodes: readonly Node[]): Node<Runnable>[] {
    return nodes.map((node) => ({
      id: node.id,
      action: this.createAction(node.action),
      validate: node.validate ? this.createValidate(node.validate) : undefined,
    }));
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

    return (state: State, event: ChatEvent): ValidationResult => {
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
        updates,
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
  async compile(event: ChatEvent, state: State): Promise<StepResult> {
    if (this.tracker.__currentNodeId === START) {
      await this.getNextNode(state);
    }
    const result = await this.executeNode(state, event);

    // If action not taken yet AND no messages (initial state, not validation failure)
    // then keep executing until action is taken
    // if (!this.tracker.__isActionTaken && result.messages.length === 0) {
    //   return this.compile(event, result.state);
    // }

    // If both phases complete (action taken + validated), move to next node
    if (this.tracker.__isActionTaken && this.tracker.__isResponseValid) {
      await this.getNextNode(result.state);

      // Check if flow is done
      if (this.tracker.__currentNodeId === END) {
        return { ...result, done: true };
      }

      this.tracker = {
        ...this.tracker,
        __isActionTaken: false,
        __isResponseValid: false,
        __validationAttempted: false,
      };
      // Move to next node and execute its action recursively
      return this.compile(event, result.state);
    }

    // Action taken but waiting for validation OR validation failed
    return result;
  }

  /**
   * Executes a single node (one phase: action or validation)
   */
  private async executeNode(
    state: State,
    event: ChatEvent
  ): Promise<StepResult> {
    // await this.getNextNode(state);
    const node = this.nodes.find((n) => n.id === this.tracker.__currentNodeId);
    const results: StepResult = { state, messages: [], done: false };

    if (!node) {
      console.warn(`Node not found: ${this.tracker.__currentNodeId}`);
      results.done = true;
      return results;
    }

    // PHASE 1: Action (if not taken yet)
    if (!this.tracker.__isActionTaken) {
      const actionResult = await node.action(state, event);
      results.messages = actionResult.messages || [];
      results.state = {
        ...state,
        ...actionResult.updates,
      };
      this.tracker = {
        ...this.tracker,
        __isActionTaken: true,
      };
      return results;
    }

    // PHASE 2: Validation (if action taken but not validated)
    if (!this.tracker.__isResponseValid && node.validate) {
      const validationResult = await node.validate(state, event);

      if (!validationResult.isValid) {
        this.tracker.__validationAttempted = true;
        results.messages = validationResult.errorMessage
          ? [validationResult.errorMessage]
          : [];
        return results;
      }

      // Validation passed
      results.state = {
        ...state,
        ...validationResult.updates,
      };
      this.tracker.__isResponseValid = true;
      return results;
    } else {
      // No validation needed, mark as valid
      this.tracker.__isResponseValid = true;
    }

    return results;
  }

  /**
   * Determines the next node based on edges and conditional routing
   */
  private async getNextNode(
    // nodeId: ExtractNodeIds<Nodes>,
    state: State
  ): Promise<void> {
    if (this.edges.has(this.tracker.__currentNodeId || START)) {
      const to = this.edges.get(this.tracker.__currentNodeId || START)!;
      if (typeof to === 'function') {
        this.tracker.__currentNodeId = (await to(state)) as
          | ExtractNodeIds<Nodes>
          | typeof END;
        return;
      } else {
        this.tracker.__currentNodeId = to;
        return;
      }
    }
    this.tracker.__currentNodeId = END;
  }
}

class ChatGraphBuilder<Nodes extends readonly Node[] = readonly []> {
  private readonly nodes: Node[] = [];
  private readonly edges: Edges<Nodes> = [];

  addNode<const NewNode extends Node>(
    node: NewNode
  ): ChatGraphBuilder<readonly [...Nodes, NewNode]> {
    // Store node as-is; ChatGraph will process it
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

  build(config: { id: string; name: string }): ChatGraph<Nodes> {
    // Convert to final ChatGraph with proper typing
    return new ChatGraph({
      ...config,
      nodes: this.nodes as unknown as Nodes,
      edges: this.edges,
    });
  }
}

// Helper function
export function createGraph() {
  return new ChatGraphBuilder();
}
