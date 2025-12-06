/**
 * Chat Flow Engine
 *
 * A conversational flow engine with two-phase nodes (action + validation)
 * and support for both JSON configuration and function-based definitions.
 *
 * @packageDocumentation
 */

// Export the Flow class
export { Flow } from './flow';

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
  ExecutableNode,
} from './types';

// Export constants
export { START, END } from './constants';
