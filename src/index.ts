/**
 * Chat Flow Engine
 *
 * A conversational flow engine with two-phase nodes (action + validation)
 * and support for both JSON configuration and function-based definitions.
 *
 * @packageDocumentation
 */

export { ChatGraph, createGraph } from './graph';
export type * from './types/graph.types';
export { START, END } from './constants';
