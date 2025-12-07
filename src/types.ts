import { START, END } from './constants';

/**
 * Represents the state of a conversation flow
 */
export type State = {
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
};

/**
 * Event representing user input or system triggers
 */
export type ChatEvent = {
  type: 'user_message';
  payload: any;
};

/**
 * Result of executing a step in the flow
 */
export type StepResult = {
  /** Updated state after step execution */
  state: State;
  /** Messages to send to the user */
  messages: string[];
  /** Whether the flow has completed */
  done: boolean;
};

/**
 * Result of executing a node's action phase
 */
export type ActionResult = {
  /** Messages to send to user */
  messages?: string[];
  /** State updates to apply */
  updates?: Partial<State>;
};

/**
 * Result of validating user input
 */
export type ValidationResult = {
  /** Whether validation passed */
  isValid: boolean;
  /** Error message to show if validation failed */
  errorMessage?: string;
  /** State updates to apply if validation passed */
  updates?: Partial<State>;
};

export type ExecutableNodeAction = (
  state: State,
  event: ChatEvent
) => ActionResult | Promise<ActionResult>;

export type NodeAction =
  | ((state: State, event: ChatEvent) => ActionResult | Promise<ActionResult>)
  | {
      message: string;
    };

export type ExecutableNodeValidate = (
  state: State,
  event: ChatEvent
) => ValidationResult | Promise<ValidationResult>;

export type NodeValidate =
  | ((
      state: State,
      event: ChatEvent
    ) => ValidationResult | Promise<ValidationResult>)
  | {
      rules: { regex: string; errorMessage: string }[];
      /** Field name to store validated input in state */
      targetField?: string | null;
    };

/**
 * Public node definition with flexible action and validation types
 */
export type Node = {
  /** Node unique identifier */
  id: string;
  /** This is for executing the node's main action, like asking the user a question */
  action: NodeAction;
  /** This is for validating the user input and is it sufficient to wrap this node and move to the next node, like if the user answered the question correctly or in the accepted format */
  validate?: NodeValidate | null;
};

/**
 * Public node definition with flexible action and validation types
 */
export type ExecutableNode = {
  /** Node unique identifier */
  id: string;
  /** This is for executing the node's main action, like asking the user a question */
  action: ExecutableNodeAction;
  /** This is for validating the user input and is it sufficient to wrap this node and move to the next node, like if the user answered the question correctly or in the accepted format */
  validate?: ExecutableNodeValidate | null;
};

export type ExtractNodeIds<Nodes extends readonly Node[]> = Nodes[number]['id'];

export type RouterNode<Nodes extends readonly Node[]> = (
  state: State
) => Nodes[number]['id'] | typeof END;

export type EdgesMap<Nodes extends readonly Node[]> = Map<
  ExtractNodeIds<Nodes> | typeof START,
  ExtractNodeIds<Nodes> | RouterNode<Nodes> | typeof END
>;

export type Flow<Nodes extends readonly Node[]> = {
  id: string;
  name: string;
  nodes: Nodes;
  edges: EdgesMap<Nodes>;
};

type HasDuplicates<
  Arr extends readonly string[],
  Seen extends string = never,
> = Arr extends readonly [
  infer First extends string,
  ...infer Rest extends readonly string[],
]
  ? First extends Seen
    ? true // Found duplicate!
    : HasDuplicates<Rest, Seen | First>
  : false;
