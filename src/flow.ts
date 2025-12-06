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
} from './types';

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
export class Flow {
  private readonly id: string;
  private readonly name: string;
  private startNodeId: string;
  private readonly nodes: Map<string, ExecutableNode> = new Map();
  private readonly edges: Map<string, string> = new Map();
  private readonly conditionalEdges: Map<string, (state: State) => string> =
    new Map();

  /**
   * Creates a new Flow instance
   *
   * @param id - Unique identifier for the flow
   * @param name - Human-readable name for the flow
   */
  constructor(id: string, name: string = 'Flow') {
    this.id = id;
    this.name = name;
    this.startNodeId = '';
  }

  /**
   * Adds a node to the flow
   *
   * @param id - Unique node identifier
   * @param config - Node configuration (object with action/validate or just an action function)
   * @returns The flow instance for chaining
   *
   * @example
   * ```typescript
   * // Simple message node with validation
   * flow.addNode("askName", {
   *   action: { message: "What's your name?" },
   *   validate: { regex: "\\w+", errorMessage: "Invalid name" },
   *   targetField: "name"
   * });
   *
   * // Function-based node
   * flow.addNode("process", (state) => ({
   *   messages: ["Processing..."],
   *   updates: { processed: true }
   * }));
   * ```
   */
  addNode(node: Node): this {
    // Convert config to NodeDefinition
    const actionFn = this.createAction(node.action);
    const validateFn = node.validate
      ? this.createValidate(node.validate)
      : undefined;
    this.nodes.set(node.id, {
      id: node.id,
      action: actionFn,
      validate: validateFn,
    });
    return this;
  }

  /**
   * Adds a directed edge from one node to another
   *
   * @param from - Source node ID or "__START__"
   * @param to - Target node ID or "__END__"
   * @returns The flow instance for chaining
   */
  addEdge(from: string | '__START__', to: string | '__END__'): this {
    if (from === '__START__') {
      this.startNodeId = to;
    } else if (to === '__END__') {
      this.edges.set(from, 'END');
    } else {
      this.edges.set(from, to);
    }
    return this;
  }

  /**
   * Adds a conditional edge that routes based on state
   *
   * @param from - Source node ID
   * @param router - Function that returns the target node ID based on state
   * @returns The flow instance for chaining
   *
   * @example
   * ```typescript
   * flow.addConditionalEdge("checkAge", (state) =>
   *   state.age >= 18 ? "adult" : "minor"
   * );
   * ```
   */
  addConditionalEdge(from: string, router: (state: State) => string): this {
    this.conditionalEdges.set(from, router);
    return this;
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
      if (nextNodeId === 'END') {
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
    const currentNodeId = state.__currentNodeId || this.startNodeId;
    const node = this.nodes.get(currentNodeId);
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
  private getNextNode(nodeId: string, state: State): string {
    if (this.conditionalEdges.has(nodeId)) {
      return this.conditionalEdges.get(nodeId)!(state);
    }
    if (this.edges.has(nodeId)) {
      return this.edges.get(nodeId)!;
    }
    return 'END';
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
