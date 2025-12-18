/**
 * Comprehensive tests for chat-graph library
 * Testing all combinations of:
 * - Graph creation: Builder vs JSON
 * - State: With schema vs Without schema, With reducer vs Without reducer
 * - Edges: Simple edges vs Route edges
 * - Actions: Simple (message) vs Function
 * - Validation: None vs Simple vs Function
 */

import { describe, it, expect } from '@jest/globals';
import {
  ChatGraph,
  ChatGraphBuilder,
  START,
  END,
  InferState,
  registry,
  ChatEvent,
} from '../src';
import { z } from 'zod';

describe('Graph Creation Methods', () => {
  describe('Builder Pattern', () => {
    it('should create graph with builder pattern', async () => {
      const State = z.object({
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'test',
          action: { message: 'Hello' },
          noUserInput: true,
        })
        .addEdge(START, 'test')
        .addEdge('test', END)
        .compile({ id: 'builder-test' });

      const result = await graph.invoke({ user_message: '' });
      expect(result.messages).toEqual(['Hello']);
      expect(graph.isDone).toBe(true);
    });
  });

  describe('JSON/Object Configuration', () => {
    it('should create graph with JSON configuration', async () => {
      const State = z.object({
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraph({
        id: 'json-test',
        schema: State,
        registry,
        nodes: [
          {
            id: 'test',
            action: { message: 'Hello' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'test' },
          { from: 'test', to: END },
        ],
      });

      const result = await graph.invoke({ user_message: '' });
      expect(result.messages).toEqual(['Hello']);
      expect(graph.isDone).toBe(true);
    });
  });
});

describe('State Management', () => {
  describe('With Schema (Zod)', () => {
    describe('Without Reducer', () => {
      it('should handle state without reducer (simple replace)', async () => {
        const State = z.object({
          name: z.string().optional(),
          messages: z.array(z.string()).registerReducer(registry, {
            default: () => [],
          }),
        });

        const graph = new ChatGraphBuilder({ schema: State, registry })
          .addNode({
            id: 'step1',
            action: () => ({ name: 'Alice', messages: ['msg1'] }),
            noUserInput: true,
          })
          .addNode({
            id: 'step2',
            action: () => ({ messages: ['msg2'] }),
            noUserInput: true,
          })
          .addEdge(START, 'step1')
          .addEdge('step1', 'step2')
          .addEdge('step2', END)
          .compile({ id: 'no-reducer' });

        await graph.invoke({ user_message: '' });
        expect(graph.state.name).toBe('Alice');
        expect(graph.state.messages).toEqual(['msg2']); // Replaced, not merged
      });
    });

    describe('With Reducer', () => {
      it('should handle state with reducer (merge/concatenate)', async () => {
        const State = z.object({
          count: z.number().registerReducer(registry, {
            reducer: { fn: (prev, next) => prev + next },
            default: () => 0,
          }),
          messages: z.array(z.string()).registerReducer(registry, {
            reducer: { fn: (prev, next) => prev.concat(next) },
            default: () => [],
          }),
        });

        const graph = new ChatGraphBuilder({ schema: State, registry })
          .addNode({
            id: 'step1',
            action: () => ({ count: 5, messages: ['msg1'] }),
            noUserInput: true,
          })
          .addNode({
            id: 'step2',
            action: () => ({ count: 3, messages: ['msg2'] }),
            noUserInput: true,
          })
          .addEdge(START, 'step1')
          .addEdge('step1', 'step2')
          .addEdge('step2', END)
          .compile({ id: 'with-reducer' });

        await graph.invoke({ user_message: '' });
        expect(graph.state.count).toBe(8); // 5 + 3
        expect(graph.state.messages).toEqual(['msg1', 'msg2']); // Concatenated
      });
    });

    describe('Mixed Reducers', () => {
      it('should handle mixed fields with and without reducers', async () => {
        const State = z.object({
          status: z.string().optional(),
          count: z.number().registerReducer(registry, {
            reducer: { fn: (prev, next) => prev + next },
            default: () => 0,
          }),
          messages: z.array(z.string()).registerReducer(registry, {
            reducer: { fn: (prev, next) => prev.concat(next) },
            default: () => [],
          }),
        });

        const graph = new ChatGraphBuilder({ schema: State, registry })
          .addNode({
            id: 'step1',
            action: () => ({ status: 'started', count: 1, messages: ['a'] }),
            noUserInput: true,
          })
          .addNode({
            id: 'step2',
            action: () => ({ status: 'completed', count: 2, messages: ['b'] }),
            noUserInput: true,
          })
          .addEdge(START, 'step1')
          .addEdge('step1', 'step2')
          .addEdge('step2', END)
          .compile({ id: 'mixed' });

        await graph.invoke({ user_message: '' });
        expect(graph.state.status).toBe('completed'); // Replaced
        expect(graph.state.count).toBe(3); // Reduced
        expect(graph.state.messages).toEqual(['a', 'b']); // Reduced
      });
    });
  });

  describe('Without Schema', () => {
    it('should handle state without schema (simple merge)', async () => {
      const graph = new ChatGraph({
        id: 'no-schema',
        nodes: [
          {
            id: 'step1',
            action: () => ({ data: 'value1', messages: ['msg1'] }),
            noUserInput: true,
          },
          {
            id: 'step2',
            action: () => ({ extra: 'value2', messages: ['msg2'] }),
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'step1' },
          { from: 'step1', to: 'step2' },
          { from: 'step2', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      expect((graph.state as any).data).toBe('value1');
      expect((graph.state as any).extra).toBe('value2');
      expect((graph.state as any).messages).toEqual(['msg2']); // Last write wins
    });
  });
});

describe('Edge Types', () => {
  describe('Simple Edges', () => {
    it('should handle simple node-to-node edges', async () => {
      const State = z.object({
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
        path: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'a',
          action: () => ({ messages: ['A'], path: ['a'] }),
          noUserInput: true,
        })
        .addNode({
          id: 'b',
          action: () => ({ messages: ['B'], path: ['b'] }),
          noUserInput: true,
        })
        .addNode({
          id: 'c',
          action: () => ({ messages: ['C'], path: ['c'] }),
          noUserInput: true,
        })
        .addEdge(START, 'a')
        .addEdge('a', 'b')
        .addEdge('b', 'c')
        .addEdge('c', END)
        .compile({ id: 'simple-edges' });

      await graph.invoke({ user_message: '' });
      expect(graph.state.path).toEqual(['a', 'b', 'c']);
    });
  });

  describe('Router/Conditional Edges', () => {
    it('should handle conditional routing based on state', async () => {
      const State = z.object({
        choice: z.string().optional(),
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
        path: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'decide',
          action: () => ({
            choice: 'left',
            messages: ['decide'],
            path: ['decide'],
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'left',
          action: () => ({ messages: ['left'], path: ['left'] }),
          noUserInput: true,
        })
        .addNode({
          id: 'right',
          action: () => ({ messages: ['right'], path: ['right'] }),
          noUserInput: true,
        })
        .addEdge(START, 'decide')
        .addEdge('decide', (state: InferState<typeof State>) => {
          return state.choice === 'left' ? 'left' : 'right';
        })
        .addEdge('left', END)
        .addEdge('right', END)
        .compile({ id: 'router-edges' });

      await graph.invoke({ user_message: '' });
      expect(graph.state.path).toEqual(['decide', 'left']);
    });

    it('should route to different paths based on dynamic state', async () => {
      const State = z.object({
        value: z.number().optional(),
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
        result: z.string().optional(),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'input',
          action: () => ({ value: 15, messages: ['input'] }),
          noUserInput: true,
        })
        .addNode({
          id: 'low',
          action: () => ({ result: 'low', messages: ['low'] }),
          noUserInput: true,
        })
        .addNode({
          id: 'high',
          action: () => ({ result: 'high', messages: ['high'] }),
          noUserInput: true,
        })
        .addEdge(START, 'input')
        .addEdge('input', (state: InferState<typeof State>) =>
          state.value! < 10 ? 'low' : 'high'
        )
        .addEdge('low', END)
        .addEdge('high', END)
        .compile({ id: 'dynamic-router' });

      await graph.invoke({ user_message: '' });
      expect(graph.state.result).toBe('high');
    });
  });
});

describe('Action Types', () => {
  describe('Simple Message Actions', () => {
    it('should handle simple message object actions', async () => {
      const State = z.object({
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'greet',
          action: { message: 'Hello, World!' },
          noUserInput: true,
        })
        .addEdge(START, 'greet')
        .addEdge('greet', END)
        .compile({ id: 'simple-message' });

      await graph.invoke({ user_message: '' });
      expect(graph.state.messages).toEqual(['Hello, World!']);
    });

    it('should interpolate variables in message actions', async () => {
      const State = z.object({
        name: z.string().optional(),
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'setName',
          action: () => ({ name: 'Alice' }),
          noUserInput: true,
        })
        .addNode({
          id: 'greet',
          action: { message: 'Hello, {{name}}!' },
          noUserInput: true,
        })
        .addEdge(START, 'setName')
        .addEdge('setName', 'greet')
        .addEdge('greet', END)
        .compile({ id: 'interpolation' });

      await graph.invoke({ user_message: '' });
      expect(graph.state.messages).toContain('Hello, Alice!');
    });
  });

  describe('Function Actions', () => {
    it('should handle function-based actions', async () => {
      const State = z.object({
        count: z.number().default(0),
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'increment',
          action: (state: InferState<typeof State>) => ({
            count: state.count + 1,
            messages: [`Count is now ${state.count + 1}`],
          }),
          noUserInput: true,
        })
        .addEdge(START, 'increment')
        .addEdge('increment', END)
        .compile({ id: 'function-action' });

      await graph.invoke({ user_message: '' });
      expect(graph.state.count).toBe(1);
      expect(graph.state.messages).toContain('Count is now 1');
    });

    it('should handle async function actions', async () => {
      const State = z.object({
        data: z.string().optional(),
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'fetch',
          action: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { data: 'fetched', messages: ['Data fetched'] };
          },
          noUserInput: true,
        })
        .addEdge(START, 'fetch')
        .addEdge('fetch', END)
        .compile({ id: 'async-action' });

      await graph.invoke({ user_message: '' });
      expect(graph.state.data).toBe('fetched');
    });

    it('should access state and event in function actions', async () => {
      const State = z.object({
        userInput: z.string().optional(),
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'process',
          action: (state: InferState<typeof State>, event: ChatEvent) => ({
            userInput: event.user_message,
            messages: [`You said: ${event.user_message}`],
          }),
          noUserInput: true,
        })
        .addEdge(START, 'process')
        .addEdge('process', END)
        .compile({ id: 'state-event' });

      await graph.invoke({ user_message: 'Hello!' });
      expect(graph.state.userInput).toBe('Hello!');
      expect(graph.state.messages).toContain('You said: Hello!');
    });
  });
});

describe('Validation Types', () => {
  describe('No Validation (noUserInput)', () => {
    it('should execute without waiting for user input', async () => {
      const State = z.object({
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'auto',
          action: { message: 'Automatic' },
          noUserInput: true,
        })
        .addEdge(START, 'auto')
        .addEdge('auto', END)
        .compile({ id: 'no-validation' });

      await graph.invoke({ user_message: '' });
      expect(graph.isDone).toBe(true);
    });
  });

  describe('Simple Regex Validation', () => {
    it('should validate user input with regex', async () => {
      const State = z.object({
        email: z.string().optional(),
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'askEmail',
          action: { message: 'Enter your email:' },
          validate: {
            rules: [
              {
                regex: '\\S+@\\S+\\.\\S+',
                errorMessage: 'Invalid email format',
              },
            ],
            targetField: 'email',
          },
        })
        .addEdge(START, 'askEmail')
        .addEdge('askEmail', END)
        .compile({ id: 'regex-validation' });

      // First invoke - ask question
      let result = await graph.invoke({ user_message: '' });
      expect(result.messages).toContain('Enter your email:');
      expect(graph.isDone).toBe(false);

      // Invalid input
      result = await graph.invoke({ user_message: 'not-an-email' });
      expect(result.messages).toContain('Invalid email format');
      expect(graph.isDone).toBe(false);

      // Valid input
      result = await graph.invoke({ user_message: 'test@example.com' });
      expect(graph.state.email).toBe('test@example.com');
      expect(graph.isDone).toBe(true);
    });

    it('should validate with multiple regex rules', async () => {
      const State = z.object({
        password: z.string().optional(),
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'askPassword',
          action: { message: 'Enter password:' },
          validate: {
            rules: [
              {
                regex: '.{8,}',
                errorMessage: 'Password must be at least 8 characters',
              },
              {
                regex: '.*[0-9].*',
                errorMessage: 'Password must contain a number',
              },
            ],
            targetField: 'password',
          },
        })
        .addEdge(START, 'askPassword')
        .addEdge('askPassword', END)
        .compile({ id: 'multi-regex' });

      await graph.invoke({ user_message: '' });

      // Too short
      let result = await graph.invoke({ user_message: 'short' });
      expect(result.messages).toContain(
        'Password must be at least 8 characters'
      );

      // No number
      result = await graph.invoke({ user_message: 'longpassword' });
      expect(result.messages).toContain('Password must contain a number');

      // Valid
      result = await graph.invoke({ user_message: 'password123' });
      expect(graph.state.password).toBe('password123');
      expect(graph.isDone).toBe(true);
    });
  });

  describe('Function Validation', () => {
    it('should validate with custom function', async () => {
      const State = z.object({
        age: z.number().optional(),
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'askAge',
          action: { message: 'Enter your age:' },
          validate: (state: InferState<typeof State>, event: ChatEvent) => {
            const age = parseInt(event.user_message);
            if (isNaN(age)) {
              return {
                isValid: false,
                errorMessage: 'Please enter a valid number',
              };
            }
            if (age < 18) {
              return {
                isValid: false,
                errorMessage: 'You must be 18 or older',
              };
            }
            return {
              isValid: true,
              state: { age },
            };
          },
        })
        .addEdge(START, 'askAge')
        .addEdge('askAge', END)
        .compile({ id: 'function-validation' });

      await graph.invoke({ user_message: '' });

      // Not a number
      let result = await graph.invoke({ user_message: 'abc' });
      expect(result.messages).toContain('Please enter a valid number');

      // Too young
      result = await graph.invoke({ user_message: '16' });
      expect(result.messages).toContain('You must be 18 or older');

      // Valid
      result = await graph.invoke({ user_message: '25' });
      expect(graph.state.age).toBe(25);
      expect(graph.isDone).toBe(true);
    });

    it('should handle async validation functions', async () => {
      const State = z.object({
        username: z.string().optional(),
        messages: z.array(z.string()).registerReducer(registry, {
          reducer: { fn: (prev, next) => prev.concat(next) },
          default: () => [],
        }),
      });

      const graph = new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'askUsername',
          action: { message: 'Enter username:' },
          validate: async (
            state: InferState<typeof State>,
            event: ChatEvent
          ) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            const taken = ['admin', 'root'];
            if (taken.includes(event.user_message)) {
              return {
                isValid: false,
                errorMessage: 'Username already taken',
              };
            }
            return {
              isValid: true,
              state: { username: event.user_message },
            };
          },
        })
        .addEdge(START, 'askUsername')
        .addEdge('askUsername', END)
        .compile({ id: 'async-validation' });

      await graph.invoke({ user_message: '' });

      let result = await graph.invoke({ user_message: 'admin' });
      expect(result.messages).toContain('Username already taken');

      result = await graph.invoke({ user_message: 'myusername' });
      expect(graph.state.username).toBe('myusername');
      expect(graph.isDone).toBe(true);
    });
  });
});

describe('Complex Combinations', () => {
  it('should handle builder + schema with reducer + router edges + function actions + function validation', async () => {
    const State = z.object({
      name: z.string().optional(),
      age: z.number().optional(),
      category: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (prev, next) => prev.concat(next) },
        default: () => [],
      }),
    });

    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'askName',
        action: (state: InferState<typeof State>) => ({
          messages: ['What is your name?'],
        }),
        validate: (state: InferState<typeof State>, event: ChatEvent) => {
          if (!event.user_message || event.user_message.length < 2) {
            return {
              isValid: false,
              errorMessage: 'Name must be at least 2 characters',
            };
          }
          return {
            isValid: true,
            state: { name: event.user_message },
          };
        },
      })
      .addNode({
        id: 'askAge',
        action: (state: InferState<typeof State>) => ({
          messages: [`Nice to meet you, ${state.name}! How old are you?`],
        }),
        validate: (state: InferState<typeof State>, event: ChatEvent) => {
          const age = parseInt(event.user_message);
          if (isNaN(age) || age < 0) {
            return {
              isValid: false,
              errorMessage: 'Please enter a valid age',
            };
          }
          return {
            isValid: true,
            state: { age },
          };
        },
      })
      .addNode({
        id: 'child',
        action: (state: InferState<typeof State>) => ({
          category: 'child',
          messages: ['You are a child!'],
        }),
        noUserInput: true,
      })
      .addNode({
        id: 'adult',
        action: (state: InferState<typeof State>) => ({
          category: 'adult',
          messages: ['You are an adult!'],
        }),
        noUserInput: true,
      })
      .addEdge(START, 'askName')
      .addEdge('askName', 'askAge')
      .addEdge('askAge', (state: InferState<typeof State>) => {
        return state.age! < 18 ? 'child' : 'adult';
      })
      .addEdge('child', END)
      .addEdge('adult', END)
      .compile({ id: 'complex' });

    await graph.invoke({ user_message: '' });
    await graph.invoke({ user_message: 'Alice' });
    await graph.invoke({ user_message: '25' });

    expect(graph.state.name).toBe('Alice');
    expect(graph.state.age).toBe(25);
    expect(graph.state.category).toBe('adult');
    expect(graph.isDone).toBe(true);
  });

  it('should handle JSON config + schema without reducer + simple edges + message actions + regex validation', async () => {
    const State = z.object({
      email: z.string().optional(),
      phone: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (prev, next) => next },
        default: () => [],
      }),
    });

    const graph = new ChatGraph({
      id: 'contact-form',
      schema: State,
      registry,
      nodes: [
        {
          id: 'askEmail',
          action: { message: 'Enter your email:' },
          validate: {
            rules: [
              {
                regex: '\\S+@\\S+\\.\\S+',
                errorMessage: 'Invalid email',
              },
            ],
            targetField: 'email',
          },
        },
        {
          id: 'askPhone',
          action: { message: 'Enter your phone:' },
          validate: {
            rules: [
              {
                regex: '\\d{10}',
                errorMessage: 'Phone must be 10 digits',
              },
            ],
            targetField: 'phone',
          },
        },
        {
          id: 'thanks',
          action: { message: 'Thank you!' },
          noUserInput: true,
        },
      ],
      edges: [
        { from: START, to: 'askEmail' },
        { from: 'askEmail', to: 'askPhone' },
        { from: 'askPhone', to: 'thanks' },
        { from: 'thanks', to: END },
      ],
    });

    await graph.invoke({ user_message: '' });
    await graph.invoke({ user_message: 'test@example.com' });
    await graph.invoke({ user_message: '1234567890' });

    expect(graph.state.email).toBe('test@example.com');
    expect(graph.state.phone).toBe('1234567890');
    expect(graph.state.messages).toEqual(['Thank you!']);
    expect(graph.isDone).toBe(true);
  });
});
