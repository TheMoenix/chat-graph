import { START, END } from './constants';

export type Tracker<Nodes extends readonly NodeId[]> = {
  /** Current node ID in the flow */
  __currentNodeId: ExtractNodeIds<Nodes>;
  /** Whether the current node's action has been executed */
  __isActionTaken?: boolean;
  /** Whether the current node's validation has passed */
  __isResponseValid?: boolean;
  /** Whether validation has been attempted (to prevent re-executing action) */
  __validationAttempted?: boolean;
  /** Flow identifier */
  __graphId: string;
};

/**
 * Represents the state of a conversation flow
 */
export type State<T = Record<string, any>> = { /** Flow-specific data */ } & T;

/**
 * Event representing user input or system triggers
 */
export type ChatEvent = {
  user_message: string;
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

export type Runnable = true;

export type RunnableNodeAction = (
  state: State,
  event: ChatEvent
) => ActionResult | Promise<ActionResult>;

type StaticNodeAction = {
  message: string;
};

export type NodeAction<Runnable extends boolean = false> = Runnable extends true
  ? RunnableNodeAction
  : RunnableNodeAction | StaticNodeAction;

export type RunnableNodeValidate = (
  state: State,
  event: ChatEvent
) => ValidationResult | Promise<ValidationResult>;

export type StaticNodeValidate = {
  rules: readonly { regex: string; errorMessage: string }[];
  /** Field name to store validated input in state */
  targetField?: string | null;
};

export type NodeValidate<Runnable extends boolean = false> =
  Runnable extends true
    ? RunnableNodeValidate
    : RunnableNodeValidate | StaticNodeValidate;

type NodeId = {
  id: string;
};

/**
 * Public node definition with flexible action and validation types
 */
export type Node<Runnable extends boolean = false> = NodeId & {
  /** This is for executing the node's main action, like asking the user a question */
  action: NodeAction<Runnable>;
  /** This is for validating the user input and is it sufficient to wrap this node and move to the next node, like if the user answered the question correctly or in the accepted format */
  validate?: NodeValidate<Runnable> | null;
};

export type ExtractNodeIds<Nodes extends readonly NodeId[]> =
  Nodes[number]['id'];

type RouterNode<Nodes extends readonly NodeId[]> = (
  state: State
) => Nodes[number]['id'] | typeof END;

type EdgeFrom<Nodes extends readonly NodeId[]> =
  | ExtractNodeIds<Nodes>
  | typeof START;

type EdgeTo<Nodes extends readonly NodeId[]> =
  | ExtractNodeIds<Nodes>
  | RouterNode<Nodes>
  | typeof END;

export type Edge<Nodes extends readonly NodeId[]> = {
  from: EdgeFrom<Nodes>;
  to: EdgeTo<Nodes>;
};

type EdgesArray<Nodes extends readonly NodeId[]> = Edge<Nodes>[];

type EdgesMap<Nodes extends readonly NodeId[]> = Map<
  EdgeFrom<Nodes>,
  EdgeTo<Nodes>
>;

export type Edges<
  Nodes extends readonly NodeId[],
  RunnableMap extends boolean = false,
> = RunnableMap extends false ? EdgesArray<Nodes> : EdgesMap<Nodes>;

export type Graph<
  Nodes extends readonly Node<R>[],
  R extends boolean = false,
> = {
  id: string;
  nodes: Nodes;
  edges: Edges<Nodes, R>;
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
