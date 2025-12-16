/**
 * Chat Flow Engine
 *
 * A conversational flow engine with two-phase nodes (action + validation)
 * and support for both JSON configuration and function-based definitions.
 *
 * @packageDocumentation
 */

export { ChatGraph } from './graph';
export type * from './types/graph.types';
export { START, END } from './constants';

// Schema and state management with Zod
export type {
  StateSchema,
  InferState,
  ReducerConfig,
  FieldConfig,
} from './schema/state-schema';
export {
  createInitialState,
  mergeState,
  registry,
  StateRegistry,
} from './schema/state-schema';

// Re-export Zod for convenience
export { z } from 'zod';

// State manager and persistence
export {
  StateManager,
  getGlobalStateManager,
  resetGlobalStateManager,
} from './state-manager';
export type { StateSnapshot } from './persistence/storage-adapter';
export { StorageAdapter } from './persistence/storage-adapter';
export { MemoryStorageAdapter } from './persistence/memory-adapter';
export { MongoStorageAdapter } from './persistence/mongo-adapter';
export type { MongoStorageOptions } from './persistence/mongo-adapter';
