/**
 * Represents the state of a conversation flow
 */
export type State<T = Record<string, any>> = { /** Flow-specific data */ } & T;
