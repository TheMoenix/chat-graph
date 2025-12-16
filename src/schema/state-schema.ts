/**
 * State schema builder for strongly-typed state management using Zod
 * Supports both simple Zod types and reducer-enabled fields via registry
 */

import { z } from 'zod';

/**
 * Reducer configuration for a field
 */
export type ReducerConfig<T = any> = {
  /** Reducer function that merges previous and new values */
  fn: (prevValue: T, newValue: T) => T;
};

/**
 * Field configuration with optional reducer and default value
 */
export type FieldConfig<T = any> = {
  reducer?: ReducerConfig<T>;
  default?: () => T;
};

/**
 * Symbol to store metadata on Zod schemas
 */
const REDUCER_METADATA = Symbol('reducerMetadata');

/**
 * Registry for field reducers and defaults
 * Stores metadata for how fields should be merged
 */
export class StateRegistry {
  private fieldConfigs: Map<z.ZodType<any>, FieldConfig<any>> = new Map();

  /**
   * Register a field configuration (reducer and/or default)
   */
  registerField<T extends z.ZodType<any>>(
    schema: T,
    config: FieldConfig<z.infer<T>>
  ): T {
    // Store metadata directly on the schema object
    (schema as any)[REDUCER_METADATA] = config;
    this.fieldConfigs.set(schema, config);
    return schema;
  }

  /**
   * Get field configuration for a schema
   */
  getConfig<T>(schema: z.ZodType<T>): FieldConfig<T> | undefined {
    return (schema as any)[REDUCER_METADATA] || this.fieldConfigs.get(schema);
  }

  /**
   * Check if a schema has a reducer
   */
  hasReducer(schema: z.ZodType<any>): boolean {
    const config = this.getConfig(schema);
    return !!config?.reducer;
  }

  /**
   * Get the default value for a schema if configured
   */
  getDefault<T>(schema: z.ZodType<T>): T | undefined {
    const config = this.getConfig(schema);
    return config?.default?.();
  }
}

/**
 * Helper function to add registerReducer method to Zod schema instances
 */
export function extendZodWithRegister() {
  if (!(z.ZodType.prototype as any).registerReducer) {
    (z.ZodType.prototype as any).registerReducer = function <
      T extends z.ZodType<any>,
    >(this: T, registry: StateRegistry, config: FieldConfig<z.infer<T>>): T {
      return registry.registerField(this, config);
    };
  }
}

// Auto-extend Zod on import
extendZodWithRegister();

// Type augmentation for TypeScript
declare module 'zod' {
  interface ZodType {
    registerReducer<T extends z.ZodType<any>>(
      this: T,
      registry: StateRegistry,
      config: FieldConfig<z.infer<T>>
    ): T;
  }
}

/**
 * State schema type - a Zod object schema
 */
export type StateSchema = z.ZodObject<any>;

/**
 * Infer the TypeScript type from a Zod state schema
 */
export type InferState<S extends StateSchema> = z.infer<S>;

/**
 * Create initial state from Zod schema with default values
 * Applies defaults from registry and validates with Zod schema
 */
export function createInitialState<S extends StateSchema>(
  schema: S | undefined,
  registry: StateRegistry | undefined,
  overrides: Partial<z.infer<S>> = {}
): z.infer<S> {
  if (!schema) {
    return overrides as z.infer<S>;
  }

  const initialState: any = { ...overrides };

  // Add default values for fields not in overrides
  if (registry && schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const [key, fieldSchema] of Object.entries(shape)) {
      if (!(key in initialState)) {
        const defaultValue = registry.getDefault(fieldSchema as z.ZodType);
        if (defaultValue !== undefined) {
          initialState[key] = defaultValue;
        }
      }
    }
  }

  // Parse with Zod to apply defaults and validate
  try {
    return schema.parse(initialState);
  } catch (error) {
    // If parsing fails, return the initial state as-is
    // This allows partial states during construction
    return initialState as z.infer<S>;
  }
}

/**
 * Merge state updates using Zod schema and registry reducers
 * If a field has a reducer, apply it; otherwise use shallow merge
 */
export function mergeState<S extends StateSchema>(
  schema: S | undefined,
  registry: StateRegistry | undefined,
  currentState: z.infer<S>,
  updates: Partial<z.infer<S>>
): z.infer<S> {
  if (!schema || !registry) {
    // No schema/registry - simple shallow merge
    return { ...currentState, ...updates } as z.infer<S>;
  }

  const mergedState: any = { ...currentState };

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;

    for (const [key, newValue] of Object.entries(updates)) {
      const fieldSchema = shape[key] as z.ZodType<any> | undefined;
      const currentValue = (currentState as any)[key];

      if (fieldSchema) {
        const config = registry.getConfig(fieldSchema);

        if (config?.reducer) {
          // Apply reducer function
          let prevValue = currentValue;
          if (prevValue === undefined && config.default) {
            prevValue = config.default();
          }
          mergedState[key] = config.reducer.fn(prevValue, newValue);
        } else {
          // Simple shallow merge
          mergedState[key] = newValue;
        }
      } else {
        // Field not in schema - still merge it
        mergedState[key] = newValue;
      }
    }
  }

  return mergedState as z.infer<S>;
}

/**
 * Create a new state registry
 */
// export function createRegistry(): StateRegistry {
//   return new StateRegistry();
// }

export const registry = new StateRegistry();
