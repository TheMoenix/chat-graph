/**
 * State type definitions
 *
 * For strongly-typed state management, use the schema-based approach:
 * @see {@link ../schema/state-schema.ts}
 *
 * @example
 * ```typescript
 * import { StateSchema, InferState } from './schema/state-schema';
 *
 * const mySchema = {
 *   name: String,
 *   age: Number,
 *   messages: {
 *     type: Array,
 *     reducer: (prev: string[], next: string[]) => [...prev, ...next]
 *   }
 * } as const;
 *
 * type MyState = InferState<typeof mySchema>;
 * // Result: { name: string; age: number; messages: string[] }
 * ```
 */

/**
 * Represents the state of a conversation flow
 * For backward compatibility - prefer using StateSchema for new code
 */
export type State<T = Record<string, any>> = { /** Flow-specific data */ } & T;
