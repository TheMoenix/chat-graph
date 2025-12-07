import type {
  State,
  ChatEvent,
  StepResult,
  ActionResult,
  ValidationResult,
  Node,
  NodeAction,
  NodeValidate,
  ExecutableNode,
  Flow,
  ExtractNodeIds,
  RouterNode,
  EdgesMap,
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
  private readonly id: string;
  private readonly name: string;
  // private startNodeId: string;
  private nodes: ExecutableNode[] = [];
  private readonly edges: EdgesMap<Nodes> = new Map();

  // Implementation (must handle both)
  constructor(config?: Flow<Nodes>) {
    this.id = config?.id || 'flow';
    this.name = config?.name || 'Flow';
    if (config?.nodes) {
      this.nodes = config.nodes as unknown as ExecutableNode[];
    }
    if (config?.edges) {
      this.edges = config.edges;
    }
    // ...
  }

  /**
   * Compiles and executes the flow recursively until waiting for user input
   *
   * @param state - Current conversation state
   * @param event - User input event
   * @returns Step result with updated state and messages
   */
  async compile(state: State, event: ChatEvent): Promise<StepResult> {
    const result = await this.executeNode(state, event);

    // If action not taken yet AND no messages (initial state, not validation failure)
    // then keep executing until action is taken
    if (!result.state.__isActionTaken && result.messages.length === 0) {
      return this.compile(result.state, event);
    }

    // If both phases complete (action taken + validated), move to next node
    if (result.state.__isActionTaken && result.state.__isResponseValid) {
      const nextNodeId = this.getNextNode(
        result.state.__currentNodeId,
        result.state
      );

      // Check if flow is done
      if (nextNodeId === END) {
        return { ...result, done: true };
      }

      // Move to next node and execute its action recursively
      return this.compile(
        {
          ...result.state,
          __isActionTaken: false,
          __isResponseValid: false,
          __validationAttempted: false,
          __currentNodeId: nextNodeId,
        },
        event
      );
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
    const currentNodeId =
      state.__currentNodeId || this.getNextNode(START, state);
    const node = this.nodes.find((n) => n.id === currentNodeId);
    const results: StepResult = { state, messages: [], done: false };

    if (!node) {
      results.done = true;
      return results;
    }

    // PHASE 1: Action (if not taken yet)
    if (!state.__isActionTaken) {
      const actionResult = await node.action(state, event);
      results.messages = actionResult.messages || [];
      results.state = {
        ...state,
        ...actionResult.updates,
        __currentNodeId: node.id,
        __isActionTaken: true,
        __isResponseValid: node.validate ? false : true,
        __validationAttempted: false,
      };
      return results;
    }

    // PHASE 2: Validation (if action taken but not validated)
    if (!state.__isResponseValid && node.validate) {
      const validationResult = await node.validate(state, event);

      if (!validationResult.isValid) {
        // Validation failed - keep action taken, mark validation attempted
        results.state = {
          ...state,
          __validationAttempted: true,
        };
        results.messages = validationResult.errorMessage
          ? [validationResult.errorMessage]
          : [];
        return results;
      }

      // Validation passed
      results.state = {
        ...state,
        ...validationResult.updates,
        __isResponseValid: true,
      };
      return results;
    }

    // Both phases complete or no validation needed
    return results;
  }

  /**
   * Determines the next node based on edges and conditional routing
   */
  private getNextNode(
    nodeId: ExtractNodeIds<Nodes>,
    state: State
  ): ExtractNodeIds<Nodes> | typeof END {
    if (this.edges.has(nodeId)) {
      const to = this.edges.get(nodeId)!;
      if (typeof to === 'function') {
        return to(state) as ExtractNodeIds<Nodes> | typeof END;
      } else {
        return to;
      }
    }
    return END;
  }
}

class ChatGraphBuilder<Nodes extends readonly Node[] = readonly []> {
  private readonly nodes: Node[] = [];
  private readonly edges: Map<
    string | typeof START,
    string | Function | typeof END
  > = new Map();

  addNode<const NewNode extends Node>(
    node: NewNode
  ): ChatGraphBuilder<readonly [...Nodes, NewNode]> {
    // Convert config to NodeDefinition
    const actionFn = this.createAction(node.action);
    const validateFn = node.validate
      ? this.createValidate(node.validate)
      : undefined;
    this.nodes.push({
      id: node.id,
      action: actionFn,
      validate: validateFn,
    });
    return this as any; // Type assertion needed
  }

  /**
   * Adds a directed edge from one node to another
   *
   * @param from - Source node ID or "__START__"
   * @param to - Target node ID or "__END__"
   * @returns The flow instance for chaining
   */
  addEdge(
    from: ExtractNodeIds<Nodes> | typeof START,
    to: ExtractNodeIds<Nodes> | RouterNode<Nodes> | typeof END
  ): this {
    this.edges.set(from, to);
    return this;
  }

  build(config: { id: string; name: string }): ChatGraph<Nodes> {
    // Convert to final ChatGraph
    return new ChatGraph({
      ...config,
      nodes: this.nodes as unknown as Nodes, // TODO fix this cast
      edges: this.edges as EdgesMap<Nodes>,
    }) as ChatGraph<Nodes>;
  }

  /**
   * Creates an action function from config
   */
  private createAction(
    action: NodeAction
  ): (state: State, event: ChatEvent) => ActionResult | Promise<ActionResult> {
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
  private createValidate(
    validate: NodeValidate | null
  ): (
    state: State,
    event: ChatEvent
  ) => ValidationResult | Promise<ValidationResult> {
    if (!validate) {
      return () => ({ isValid: true });
    }

    if (typeof validate === 'function') {
      return validate;
    }

    // Array of validators (run all in sequence)
    const rules = Array.isArray(validate.rules)
      ? validate.rules
      : [validate.rules];

    return (state: State, event: ChatEvent): ValidationResult => {
      if (event.type !== 'user_message') {
        return { isValid: false };
      }

      const input = event.payload;

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
}

// Helper function
export function createGraph() {
  return new ChatGraphBuilder();
}
