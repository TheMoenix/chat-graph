import { START, END } from '../constants';
import { InferState, StateSchema } from '../schema/state-schema';

export type Tracker<Nodes extends readonly NodeId[]> = {
  /** Current node ID in the flow */
  __currentNodeId: ExtractNodeIds<Nodes>;
  /** Whether the current node's action has been executed */
  __isActionTaken?: boolean;
  /** Whether the current node's validation has passed */
  __isResponseValid?: boolean;
  /** Flow identifier */
  __graphId: string;
  /** Flow identifier */
  __isDone: boolean;
};

/**
 * Event representing user input or system triggers
 */
export type ChatEvent = {
  userMessage: string;
};

/**
 * Result of validating user input
 */
export type ValidationResult<Schema extends StateSchema = StateSchema> = {
  /** Whether validation passed */
  isValid: boolean;
  /** Error message to show if validation failed */
  errorMessage?: string;
  /** State updates to apply if validation passed */
  state?: Partial<InferState<Schema>>;
};

export type Runnable = true;

export type RunnableNodeAction<Schema extends StateSchema> = (
  state: InferState<Schema>,
  event: ChatEvent
) => Partial<InferState<Schema>> | Promise<Partial<InferState<Schema>>>;

type StaticNodeAction = {
  message: string;
};

export type NodeAction<
  Schema extends StateSchema,
  Runnable extends boolean = false,
> = Runnable extends true
  ? RunnableNodeAction<Schema>
  : RunnableNodeAction<Schema> | StaticNodeAction;

export type RunnableNodeValidate<Schema extends StateSchema = StateSchema> = (
  state: InferState<Schema>,
  event: ChatEvent
) => ValidationResult<Schema> | Promise<ValidationResult<Schema>>;

export type StaticNodeValidate = {
  rules?: readonly { regex: string; errorMessage: string }[];
  /** Field name to store validated input in state */
  answerKey?: string | null;
};

export type NodeValidate<
  Schema extends StateSchema = StateSchema,
  Runnable extends boolean = false,
> = Runnable extends true
  ? RunnableNodeValidate<Schema>
  : RunnableNodeValidate<Schema> | StaticNodeValidate;

export type NodeId = {
  id: string;
};

type NodeBase<Schema extends StateSchema, Runnable extends boolean> = NodeId & {
  /** This is for executing the node's main action, like asking the user a question */
  action: NodeAction<Schema, Runnable>;
};

/** When user input is expected */
type NodeWithUserInput<
  Schema extends StateSchema,
  Runnable extends boolean,
> = NodeBase<Schema, Runnable> & {
  /**
   * When this is true, after the action is executed, the flow automatically moves to the next node
   * when this is false or undefined, the flow waits for user input before moving to the next node
   * Note: You can't have validate if autoAdvance is true since there's no user input to validate
   * @optional
   */
  autoAdvance?: false; // TODO try omit this field entirely
  /**
   * This is for validating the user input and is it sufficient to wrap this node and move to the next node,
   * like if the user answered the question correctly or in the accepted format
   * Note: You can't have validate if autoAdvance is true since there's no user input to validate
   * @optional
   */
  validate?: NodeValidate<Schema, Runnable> | null;
};

/** When this is true, the node does not expect user input */
type NodeWithoutUserInput<
  Schema extends StateSchema,
  Runnable extends boolean,
> = NodeBase<Schema, Runnable> & {
  /**
   * When this is true, after the action is executed, the flow automatically moves to the next node
   * when this is false or undefined, the flow waits for user input before moving to the next node
   * Note: You can't have validate if autoAdvance is true since there's no user input to validate
   */
  autoAdvance: true;
  /**
   * This is for validating the user input and is it sufficient to wrap this node and move to the next node,
   * like if the user answered the question correctly or in the accepted format
   * Note: You can't have validate if autoAdvance is true since there's no user input to validate
   */
  validate?: never;
};

/**
 * Public node definition with flexible action and validation types
 */
export type Node<
  Schema extends StateSchema,
  Runnable extends boolean = false,
> =
  | NodeWithUserInput<Schema, Runnable>
  | NodeWithoutUserInput<Schema, Runnable>;

export type ExtractNodeIds<Nodes extends readonly NodeId[]> =
  Nodes[number]['id'];

/**
 * Condition operator types for JSON-based routing
 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'regex'
  | 'in'
  | 'not_in';

/**
 * Single routing condition with type-safe field and goto
 */
export type RouterCondition<
  Nodes extends readonly NodeId[] = readonly NodeId[],
  Schema extends StateSchema = StateSchema,
> = {
  /** State field to check (type-safe against schema) */
  field: keyof InferState<Schema>;
  /** Comparison operator */
  operator: ConditionOperator;
  /** Value to compare against */
  value: InferState<Schema>[keyof InferState<Schema>];
  /** Node to go to if condition matches (type-safe against node IDs) */
  goto: ExtractNodeIds<Nodes> | typeof END;
};

/**
 * JSON-based static router definition
 * Evaluates conditions in order and routes to the first match
 */
export type StaticRouter<
  Nodes extends readonly NodeId[] = readonly NodeId[],
  Schema extends StateSchema = StateSchema,
> = {
  /** Array of conditions to evaluate in order */
  conditions: readonly RouterCondition<Nodes, Schema>[];
  /** Fallback destination if no conditions match */
  default: ExtractNodeIds<Nodes> | typeof END;
};

type RouterNode<
  Nodes extends readonly NodeId[],
  Schema extends StateSchema = StateSchema,
> = (
  state: InferState<Schema>
) =>
  | Nodes[number]['id']
  | typeof END
  | Promise<Nodes[number]['id'] | typeof END>;

type EdgeFrom<Nodes extends readonly NodeId[]> =
  | ExtractNodeIds<Nodes>
  | typeof START;

export type EdgeTo<
  Nodes extends readonly NodeId[],
  Schema extends StateSchema = StateSchema,
> =
  | ExtractNodeIds<Nodes>
  | RouterNode<Nodes, Schema>
  | StaticRouter<Nodes, Schema>
  | typeof END;

export type RunnableEdgeTo<
  Nodes extends readonly NodeId[],
  Schema extends StateSchema = StateSchema,
> = ExtractNodeIds<Nodes> | RouterNode<Nodes, Schema> | typeof END;

export type Edge<
  Nodes extends readonly NodeId[],
  Schema extends StateSchema = StateSchema,
> = {
  from: EdgeFrom<Nodes>;
  to: EdgeTo<Nodes, Schema>;
};

type EdgesArray<Nodes extends readonly NodeId[]> = Edge<Nodes>[];

type EdgesMap<
  Nodes extends readonly NodeId[],
  Schema extends StateSchema = StateSchema,
> = Map<EdgeFrom<Nodes>, RunnableEdgeTo<Nodes, Schema>>;

export type Edges<
  Nodes extends readonly NodeId[],
  RunnableMap extends boolean = false,
  Schema extends StateSchema = StateSchema,
> = RunnableMap extends false ? EdgesArray<Nodes> : EdgesMap<Nodes, Schema>;

export type Graph<
  Nodes extends readonly Node<Schema, R>[],
  R extends boolean = false,
  Schema extends StateSchema = StateSchema,
> = {
  id: string;
  nodes: Nodes;
  edges: Edges<Nodes, R, Schema>;
  initialState?: InferState<Schema>;
};

// type HasDuplicates<
//   Arr extends readonly string[],
//   Seen extends string = never,
// > = Arr extends readonly [
//   infer First extends string,
//   ...infer Rest extends readonly string[],
// ]
//   ? First extends Seen
//     ? true // Found duplicate!
//     : HasDuplicates<Rest, Seen | First>
//   : false;
