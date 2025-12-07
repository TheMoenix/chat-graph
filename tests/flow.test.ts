import { ChatGraph } from '../src/flow';
import { START, END } from '../src/constants';
import type { State, ChatEvent } from '../src/types';

describe('Flow', () => {
  describe('Basic Node Operations', () => {
    it('should create a flow and add nodes', () => {
      const flow = new ChatGraph('test-flow');

      flow.addNode({
        id: 'greet',
        action: { message: 'Hello!' },
      });

      expect(flow).toBeDefined();
    });

    it('should execute a simple action node', async () => {
      const flow = new ChatGraph('test');

      flow
        .addNode({
          id: 'greet',
          action: { message: 'Hello!' },
        })
        .addEdge(START, 'greet')
        .addEdge('greet', END);

      const state: State = {
        __currentNodeId: '',
        __flowId: 'test',
      };

      const result = await flow.compile(state, {
        type: 'user_message',
        payload: 'hi',
      });

      expect(result.messages).toContain('Hello!');
      expect(result.done).toBe(true);
    });
  });

  describe('Two-Phase Node Model', () => {
    it('should execute action phase first', async () => {
      const flow = new ChatGraph('test');

      flow
        .addNode({
          id: 'askName',
          action: { message: 'What is your name?' },
          validate: {
            rules: [{ regex: '\\w+', errorMessage: 'Invalid name' }],
            targetField: 'name',
          },
        })
        .addEdge(START, 'askName')
        .addEdge('askName', END);

      const state: State = {
        __currentNodeId: '',
        __flowId: 'test',
      };

      const result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      expect(result.messages).toContain('What is your name?');
      expect(result.state.__isActionTaken).toBe(true);
      expect(result.state.__isResponseValid).toBe(false);
      expect(result.done).toBe(false);
    });

    it('should validate user response in second phase', async () => {
      const flow = new ChatGraph('test');

      flow
        .addNode({
          id: 'askName',
          action: { message: 'What is your name?' },
          validate: {
            rules: [{ regex: '\\w+', errorMessage: 'Invalid name' }],
            targetField: 'name',
          },
        })
        .addEdge(START, 'askName')
        .addEdge('askName', END);

      // First: action phase
      const state: State = {
        __currentNodeId: '',
        __flowId: 'test',
      };

      let result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      expect(result.state.__isActionTaken).toBe(true);
      expect(result.state.__isResponseValid).toBe(false);

      // Second: validation phase
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'John',
      });

      expect(result.state.__isResponseValid).toBe(true);
      expect(result.state.name).toBe('John');
      expect(result.done).toBe(true);
    });

    it('should show error message on validation failure', async () => {
      const flow = new ChatGraph('test');

      flow
        .addNode({
          id: 'askEmail',
          action: { message: 'Enter email:' },
          validate: {
            rules: [
              { regex: '^\\S+@\\S+\\.\\S+$', errorMessage: 'Invalid email' },
            ],
            targetField: 'email',
          },
        })
        .addEdge(START, 'askEmail')
        .addEdge('askEmail', END);

      // Action phase
      const state: State = {
        __currentNodeId: '',
        __flowId: 'test',
      };

      let result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      // Invalid validation
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'notanemail',
      });

      expect(result.messages).toContain('Invalid email');
      expect(result.state.__isResponseValid).toBe(false);
      expect(result.state.__validationAttempted).toBe(true);
      expect(result.done).toBe(false);
    });
  });

  describe('Multiple Validators', () => {
    it('should run all validators in sequence', async () => {
      const flow = new ChatGraph('test');

      flow
        .addNode({
          id: 'askName',
          action: { message: 'Name?' },
          validate: {
            rules: [
              { regex: '\\w+', errorMessage: 'Name required' },
              { regex: '.{2,}', errorMessage: 'Min 2 chars' },
            ],
            targetField: 'name',
          },
        })
        .addEdge(START, 'askName')
        .addEdge('askName', END);

      const state: State = {
        __currentNodeId: '',
        __flowId: 'test',
      };

      // Action
      let result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      // Fail first validator
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: '',
      });

      expect(result.messages).toContain('Name required');

      // Fail second validator
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'A',
      });

      expect(result.messages).toContain('Min 2 chars');

      // Pass all validators
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'John',
      });

      expect(result.state.name).toBe('John');
      expect(result.done).toBe(true);
    });
  });

  describe('Template Interpolation', () => {
    it('should interpolate state variables in messages', async () => {
      const flow = new ChatGraph('test');

      flow
        .addNode({
          id: 'greet',
          action: { message: 'Hello, {name}!' },
        })
        .addEdge(START, 'greet')
        .addEdge('greet', END);

      const state: State = {
        __currentNodeId: '',
        __flowId: 'test',
        name: 'Alice',
      };

      const result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      expect(result.messages).toContain('Hello, Alice!');
    });
  });

  describe('Conditional Edges', () => {
    it('should route based on state conditions', async () => {
      const flow = new ChatGraph('test');

      flow
        .addNode({
          id: 'askAge',
          action: { message: 'Age?' },
          validate: {
            rules: [{ regex: '^\\d+$', errorMessage: 'Enter number' }],
            targetField: 'age',
          },
        })
        .addNode({
          id: 'convertAge',
          action: (state) => ({
            messages: [],
            updates: { age: parseInt(state.age) },
          }),
        })
        .addNode({
          id: 'adult',
          action: { message: 'You are {age}+' },
        })
        .addNode({
          id: 'minor',
          action: { message: 'Under 18' },
        })
        .addEdge(START, 'askAge')
        .addEdge('askAge', 'convertAge')
        .addConditionalEdge('convertAge', (state) =>
          state.age >= 18 ? 'adult' : 'minor'
        )
        .addEdge('adult', END)
        .addEdge('minor', END);

      // Test adult path
      let state: State = {
        __currentNodeId: '',
        __flowId: 'test',
      };

      let result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: '25',
      });

      expect(result.messages).toContain('You are 25+');
      expect(result.done).toBe(true);

      // Test minor path
      state = {
        __currentNodeId: '',
        __flowId: 'test',
      };

      result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: '16',
      });

      expect(result.messages).toContain('Under 18');
      expect(result.done).toBe(true);
    });
  });

  describe('Function-Based Nodes', () => {
    it('should support function-only nodes', async () => {
      const flow = new ChatGraph('test');

      flow
        .addNode({
          id: 'process',
          action: async (state, event) => ({
            messages: ['Processing...'],
            updates: { processed: true },
          }),
        })
        .addEdge(START, 'process')
        .addEdge('process', END);

      const state: State = {
        __currentNodeId: '',
        __flowId: 'test',
      };

      const result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      expect(result.messages).toContain('Processing...');
      expect(result.state.processed).toBe(true);
      expect(result.done).toBe(true);
    });

    it('should support custom validation functions', async () => {
      const flow = new ChatGraph('test');

      flow
        .addNode({
          id: 'custom',
          action: { message: 'Enter code:' },
          validate: async (state, event) => {
            const isValid = event.payload === 'SECRET';
            return {
              isValid,
              errorMessage: isValid ? undefined : 'Wrong code',
              updates: isValid ? { code: event.payload } : {},
            };
          },
        })
        .addEdge(START, 'custom')
        .addEdge('custom', END);

      const state: State = {
        __currentNodeId: '',
        __flowId: 'test',
      };

      // Action
      let result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      // Invalid
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'WRONG',
      });

      expect(result.messages).toContain('Wrong code');
      expect(result.done).toBe(false);

      // Valid
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'SECRET',
      });

      expect(result.state.code).toBe('SECRET');
      expect(result.done).toBe(true);
    });
  });

  describe('Flow Chaining', () => {
    it('should chain method calls fluently', () => {
      const flow = new ChatGraph('test');

      const result = flow
        .addNode({ id: 'a', action: { message: 'A' } })
        .addNode({ id: 'b', action: { message: 'B' } })
        .addEdge(START, 'a')
        .addEdge('a', 'b')
        .addEdge('b', END);

      expect(result).toBe(flow);
    });
  });
});
