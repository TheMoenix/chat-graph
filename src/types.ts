/**
 * Represents the state of a conversation flow
 */
export interface State {
  /** Current node ID in the flow */
  __currentNodeId: string;
  /** Whether the current node's action has been executed */
  __isActionTaken?: boolean;
  /** Whether the current node's validation has passed */
  __isResponseValid?: boolean;
  /** Whether validation has been attempted (to prevent re-executing action) */
  __validationAttempted?: boolean;
  /** Flow identifier */
  __flowId: string;
  /** User-defined state properties */
  [key: string]: any;
}

/**
 * Event representing user input or system triggers
 */
export interface ChatEvent {
  type: 'user_message';
  payload: any;
}

/**
 * Result of executing a step in the flow
 */
export interface StepResult {
  /** Updated state after step execution */
  state: State;
  /** Messages to send to the user */
  messages: string[];
  /** Whether the flow has completed */
  done: boolean;
}

/**
 * Result of executing a node's action phase
 */
export interface ActionResult {
  /** Messages to send to user */
  messages?: string[];
  /** State updates to apply */
  updates?: Partial<State>;
}

/**
 * Result of validating user input
 */
export interface ValidationResult {
  /** Whether validation passed */
  isValid: boolean;
  /** Error message to show if validation failed */
  errorMessage?: string;
  /** State updates to apply if validation passed */
  updates?: Partial<State>;
}

/**
 * Internal node definition with action and validation functions
 */
export interface NodeDefinition {
  id: string;
  action: (
    state: State,
    event: ChatEvent
  ) => ActionResult | Promise<ActionResult>;
  validate?: (
    state: State,
    event: ChatEvent
  ) => ValidationResult | Promise<ValidationResult>;
}

/**
 * JSON-based node configuration (legacy, not fully implemented)
 */
export interface JSONNode {
  id: string;
  action?: {
    type: 'message' | 'prompt' | 'custom';
    data: any;
  };
  validate?: {
    type: 'regex' | 'custom';
    data: any;
  };
}

/**
 * Configuration for adding a node to the flow
 */
export type NodeConfig =
  | {
      /** Action definition - can be a simple message or a function */
      action:
        | { message: string }
        | ((
            state: State,
            event: ChatEvent
          ) => ActionResult | Promise<ActionResult>);
      /** Validation definition - can be regex(es) or a function */
      validate?:
        | { regex: string; errorMessage: string }
        | Array<{ regex: string; errorMessage: string }>
        | ((
            state: State,
            event: ChatEvent
          ) => ValidationResult | Promise<ValidationResult>);
      /** Field name to store validated input in state */
      targetField?: string | null;
    }
  | ((state: State, event: ChatEvent) => ActionResult | Promise<ActionResult>);
