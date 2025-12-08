/**
 * Chat Flow Engine
 *
 * A conversational flow engine with two-phase nodes (action + validation)
 * and support for both JSON configuration and function-based definitions.
 *
 * @packageDocumentation
 */

// Export the Flow class and builder
export { ChatGraph as Flow, createGraph } from './graph';

// Export all types
export type {
  State,
  ChatEvent,
  StepResult,
  ActionResult,
  ValidationResult,
  Node,
  NodeAction,
  NodeValidate,
} from './types';

// Export constants
export { START, END } from './constants';
