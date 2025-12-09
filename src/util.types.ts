/** Utility type to simplify and prettify TypeScript types for better readability.*/
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
