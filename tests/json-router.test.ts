import { ChatGraph, START, END, MemoryStorageAdapter, registry } from '../src';
import { z } from 'zod';

describe('JSON-based Router', () => {
  const storage = new MemoryStorageAdapter();

  beforeEach(async () => {
    await storage.deleteFlow('router-test');
  });

  describe('Basic Operators', () => {
    it('should route based on equals condition', async () => {
      const schema = z.object({
        choice: z.string().default(''),
        result: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask',
            action: { message: 'Choose left or right' },
            validate: {
              rules: [{ regex: '^(left|right)$', errorMessage: 'Invalid' }],
              targetField: 'choice',
            },
          },
          {
            id: 'left_path',
            action: { message: 'You chose left!' },
            noUserInput: true,
          },
          {
            id: 'right_path',
            action: { message: 'You chose right!' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask' },
          {
            from: 'ask',
            to: {
              conditions: [
                {
                  field: 'choice',
                  operator: 'equals',
                  value: 'left',
                  goto: 'left_path',
                },
                {
                  field: 'choice',
                  operator: 'equals',
                  value: 'right',
                  goto: 'right_path',
                },
              ],
              default: END,
            },
          },
          { from: 'left_path', to: END },
          { from: 'right_path', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: 'left' });
      expect(graph.state.messages).toContain('You chose left!');
    });

    it('should route based on numeric comparisons (gt, lt)', async () => {
      const schema = z.object({
        age: z.number().default(0),
        result: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask_age',
            action: { message: 'How old are you?' },
            validate: {
              rules: [{ regex: '^[0-9]+$', errorMessage: 'Invalid age' }],
              targetField: 'age',
            },
          },
          {
            id: 'minor',
            action: { message: 'You are a minor' },
            noUserInput: true,
          },
          {
            id: 'adult',
            action: { message: 'You are an adult' },
            noUserInput: true,
          },
          {
            id: 'senior',
            action: { message: 'You are a senior' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask_age' },
          {
            from: 'ask_age',
            to: {
              conditions: [
                { field: 'age', operator: 'lt', value: 18, goto: 'minor' },
                { field: 'age', operator: 'gte', value: 65, goto: 'senior' },
              ],
              default: 'adult',
            },
          },
          { from: 'minor', to: END },
          { from: 'adult', to: END },
          { from: 'senior', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: '15' });
      expect(graph.state.messages).toContain('You are a minor');

      await storage.deleteFlow('router-test');
      const graph2 = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask_age',
            action: { message: 'How old are you?' },
            validate: {
              rules: [{ regex: '^[0-9]+$', errorMessage: 'Invalid age' }],
              targetField: 'age',
            },
          },
          {
            id: 'minor',
            action: { message: 'You are a minor' },
            noUserInput: true,
          },
          {
            id: 'adult',
            action: { message: 'You are an adult' },
            noUserInput: true,
          },
          {
            id: 'senior',
            action: { message: 'You are a senior' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask_age' },
          {
            from: 'ask_age',
            to: {
              conditions: [
                { field: 'age', operator: 'lt', value: 18, goto: 'minor' },
                { field: 'age', operator: 'gte', value: 65, goto: 'senior' },
              ],
              default: 'adult',
            },
          },
          { from: 'minor', to: END },
          { from: 'adult', to: END },
          { from: 'senior', to: END },
        ],
      });

      await graph2.invoke({ user_message: '' });
      await graph2.invoke({ user_message: '70' });
      expect(graph2.state.messages).toContain('You are a senior');
    });

    it('should route based on contains operator', async () => {
      const schema = z.object({
        text: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask',
            action: { message: 'Say something' },
            validate: {
              targetField: 'text',
            },
          },
          {
            id: 'hello_response',
            action: { message: 'Hello to you too!' },
            noUserInput: true,
          },
          {
            id: 'other_response',
            action: { message: 'I heard you' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask' },
          {
            from: 'ask',
            to: {
              conditions: [
                {
                  field: 'text',
                  operator: 'contains',
                  value: 'hello',
                  goto: 'hello_response',
                },
              ],
              default: 'other_response',
            },
          },
          { from: 'hello_response', to: END },
          { from: 'other_response', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: 'hello world' });
      expect(graph.state.messages).toContain('Hello to you too!');
    });

    it('should route based on regex operator', async () => {
      const schema = z.object({
        email: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask_email',
            action: { message: 'Enter email' },
            validate: {
              targetField: 'email',
            },
          },
          {
            id: 'valid_email',
            action: { message: 'Valid email!' },
            noUserInput: true,
          },
          {
            id: 'invalid_email',
            action: { message: 'Invalid email!' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask_email' },
          {
            from: 'ask_email',
            to: {
              conditions: [
                {
                  field: 'email',
                  operator: 'regex',
                  value: '^[\\w.-]+@[\\w.-]+\\.\\w{2,}$',
                  goto: 'valid_email',
                },
              ],
              default: 'invalid_email',
            },
          },
          { from: 'valid_email', to: END },
          { from: 'invalid_email', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: 'test@example.com' });
      expect(graph.state.messages).toContain('Valid email!');
    });

    it('should route based on in operator', async () => {
      const schema = z.object({
        color: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask_color',
            action: { message: 'Pick a primary color' },
            validate: {
              targetField: 'color',
            },
          },
          {
            id: 'primary',
            action: { message: 'Good choice!' },
            noUserInput: true,
          },
          {
            id: 'not_primary',
            action: { message: 'Not a primary color' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask_color' },
          {
            from: 'ask_color',
            to: {
              conditions: [
                {
                  field: 'color',
                  operator: 'in',
                  value: ['red', 'blue', 'yellow'],
                  goto: 'primary',
                },
              ],
              default: 'not_primary',
            },
          },
          { from: 'primary', to: END },
          { from: 'not_primary', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: 'blue' });
      expect(graph.state.messages).toContain('Good choice!');
    });
  });

  describe('Multiple Conditions', () => {
    it('should evaluate conditions in order and use first match', async () => {
      const schema = z.object({
        score: z.number().default(0),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask_score',
            action: { message: 'Enter score' },
            validate: {
              rules: [{ regex: '^[0-9]+$', errorMessage: 'Invalid' }],
              targetField: 'score',
            },
          },
          {
            id: 'excellent',
            action: { message: 'Excellent!' },
            noUserInput: true,
          },
          {
            id: 'good',
            action: { message: 'Good!' },
            noUserInput: true,
          },
          {
            id: 'fair',
            action: { message: 'Fair' },
            noUserInput: true,
          },
          {
            id: 'poor',
            action: { message: 'Poor' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask_score' },
          {
            from: 'ask_score',
            to: {
              conditions: [
                {
                  field: 'score',
                  operator: 'gte',
                  value: 90,
                  goto: 'excellent',
                },
                { field: 'score', operator: 'gte', value: 70, goto: 'good' },
                { field: 'score', operator: 'gte', value: 50, goto: 'fair' },
              ],
              default: 'poor',
            },
          },
          { from: 'excellent', to: END },
          { from: 'good', to: END },
          { from: 'fair', to: END },
          { from: 'poor', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: '85' });
      expect(graph.state.messages).toContain('Good!');
    });
  });

  describe('Default Routing', () => {
    it('should use default route when no conditions match', async () => {
      const schema = z.object({
        value: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask',
            action: { message: 'Enter value' },
            validate: {
              targetField: 'value',
            },
          },
          {
            id: 'matched',
            action: { message: 'Matched!' },
            noUserInput: true,
          },
          {
            id: 'default',
            action: { message: 'Default path' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask' },
          {
            from: 'ask',
            to: {
              conditions: [
                {
                  field: 'value',
                  operator: 'equals',
                  value: 'special',
                  goto: 'matched',
                },
              ],
              default: 'default',
            },
          },
          { from: 'matched', to: END },
          { from: 'default', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: 'random' });
      expect(graph.state.messages).toContain('Default path');
    });

    it('should support END as default destination', async () => {
      const schema = z.object({
        value: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask',
            action: { message: 'Enter value' },
            validate: {
              targetField: 'value',
            },
          },
          {
            id: 'matched',
            action: { message: 'Matched!' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask' },
          {
            from: 'ask',
            to: {
              conditions: [
                {
                  field: 'value',
                  operator: 'equals',
                  value: 'special',
                  goto: 'matched',
                },
              ],
              default: END,
            },
          },
          { from: 'matched', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: 'random' });
      expect(graph.isDone).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    it('should still support function-based routers', async () => {
      const schema = z.object({
        choice: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask',
            action: { message: 'Choose' },
            validate: {
              targetField: 'choice',
            },
          },
          {
            id: 'left',
            action: { message: 'Left!' },
            noUserInput: true,
          },
          {
            id: 'right',
            action: { message: 'Right!' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask' },
          {
            from: 'ask',
            to: (state) => (state.choice === 'left' ? 'left' : 'right'),
          },
          { from: 'left', to: END },
          { from: 'right', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: 'left' });
      expect(graph.state.messages).toContain('Left!');
    });

    it('should still support simple string edges', async () => {
      const schema = z.object({
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'first',
            action: { message: 'First' },
            noUserInput: true,
          },
          {
            id: 'second',
            action: { message: 'Second' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'first' },
          { from: 'first', to: 'second' },
          { from: 'second', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      expect(graph.state.messages).toContain('Second');
    });
  });

  describe('Negation Operators', () => {
    it('should support not_equals operator', async () => {
      const schema = z.object({
        value: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask',
            action: { message: 'Enter value' },
            validate: {
              targetField: 'value',
            },
          },
          {
            id: 'not_skip',
            action: { message: 'Processing...' },
            noUserInput: true,
          },
          {
            id: 'skipped',
            action: { message: 'Skipped!' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask' },
          {
            from: 'ask',
            to: {
              conditions: [
                {
                  field: 'value',
                  operator: 'not_equals',
                  value: 'skip',
                  goto: 'not_skip',
                },
              ],
              default: 'skipped',
            },
          },
          { from: 'not_skip', to: END },
          { from: 'skipped', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: 'proceed' });
      expect(graph.state.messages).toContain('Processing...');
    });

    it('should support not_contains operator', async () => {
      const schema = z.object({
        text: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask',
            action: { message: 'Say something' },
            validate: {
              targetField: 'text',
            },
          },
          {
            id: 'clean',
            action: { message: 'Clean message!' },
            noUserInput: true,
          },
          {
            id: 'spam',
            action: { message: 'Spam detected!' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask' },
          {
            from: 'ask',
            to: {
              conditions: [
                {
                  field: 'text',
                  operator: 'not_contains',
                  value: 'spam',
                  goto: 'clean',
                },
              ],
              default: 'spam',
            },
          },
          { from: 'clean', to: END },
          { from: 'spam', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: 'hello there' });
      expect(graph.state.messages).toContain('Clean message!');
    });

    it('should support not_in operator', async () => {
      const schema = z.object({
        color: z.string().default(''),
        messages: z.array(z.string()).registerReducer(registry, {
          default: () => [],
          reducer: { fn: (p, n) => n },
        }),
      });

      const graph = new ChatGraph({
        id: 'router-test',
        schema,
        storageAdapter: storage,
        nodes: [
          {
            id: 'ask_color',
            action: { message: 'Pick a color' },
            validate: {
              targetField: 'color',
            },
          },
          {
            id: 'allowed',
            action: { message: 'Allowed color!' },
            noUserInput: true,
          },
          {
            id: 'forbidden',
            action: { message: 'Forbidden color!' },
            noUserInput: true,
          },
        ],
        edges: [
          { from: START, to: 'ask_color' },
          {
            from: 'ask_color',
            to: {
              conditions: [
                {
                  field: 'color',
                  operator: 'not_in',
                  value: ['black', 'white'],
                  goto: 'allowed',
                },
              ],
              default: 'forbidden',
            },
          },
          { from: 'allowed', to: END },
          { from: 'forbidden', to: END },
        ],
      });

      await graph.invoke({ user_message: '' });
      await graph.invoke({ user_message: 'red' });
      expect(graph.state.messages).toContain('Allowed color!');
    });
  });
});
