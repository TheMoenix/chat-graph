import { createGraph } from '../src/graph';
import { START, END } from '../src/constants';
import type { State, ChatEvent } from '../src/types';

describe('Flow', () => {
  describe('Basic Node Operations', () => {
    it('should create a flow and add nodes', () => {
      const flow = createGraph()
        .addNode({
          id: 'greet',
          action: { message: 'Hello!' },
          noUserInput: true,
        })
        .build({ id: 'test-flow' });

      expect(flow).toBeDefined();
    });

    it('should execute a simple action node with noUserInput', async () => {
      const flow = createGraph()
        .addNode({
          id: 'greet',
          action: { message: 'Hello!' },
          noUserInput: true,
        })
        .addEdge(START, 'greet')
        .addEdge('greet', END)
        .build({ id: 'test' });

      const result = await flow.invoke({
        user_message: '',
      });

      expect(result.messages).toContain('Hello!');
      expect(flow.isDone).toBe(true);
    });
  });

  describe('Two-Phase Node Model', () => {
    it('should execute action phase first', async () => {
      const flow = createGraph()
        .addNode({
          id: 'askName',
          action: { message: 'What is your name?' },
          validate: {
            rules: [{ regex: '\\w+', errorMessage: 'Invalid name' }],
            targetField: 'name',
          },
        })
        .addEdge(START, 'askName')
        .addEdge('askName', END)
        .build({ id: 'test' });

      const result = await flow.invoke({
        user_message: '',
      });

      expect(result.messages).toContain('What is your name?');
      expect(flow.isDone).toBe(false);
    });

    it('should validate user response in second phase', async () => {
      const flow = createGraph()
        .addNode({
          id: 'askName',
          action: { message: 'What is your name?' },
          validate: {
            rules: [{ regex: '\\w+', errorMessage: 'Invalid name' }],
            targetField: 'name',
          },
        })
        .addEdge(START, 'askName')
        .addEdge('askName', END)
        .build({ id: 'test' });

      // First: action phase
      let result = await flow.invoke({
        user_message: '',
      });

      expect(result.messages).toContain('What is your name?');
      expect(flow.isDone).toBe(false);

      // Second: validation phase
      result = await flow.invoke({
        user_message: 'John',
      });

      expect((flow.state as any).name).toBe('John');
      expect(flow.isDone).toBe(true);
    });

    it('should show error message on validation failure', async () => {
      const flow = createGraph()
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
        .addEdge('askEmail', END)
        .build({ id: 'test' });

      // Action phase
      let result = await flow.invoke({
        user_message: '',
      });

      // Invalid validation
      result = await flow.invoke({
        user_message: 'notanemail',
      });

      expect(result.messages).toContain('Invalid email');
      expect(flow.isDone).toBe(false);
    });
  });

  describe('Multiple Validators', () => {
    it('should run all validators in sequence', async () => {
      const flow = createGraph()
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
        .addEdge('askName', END)
        .build({ id: 'test' });

      // Action
      let result = await flow.invoke({
        user_message: '',
      });

      // Fail first validator
      result = await flow.invoke({
        user_message: '',
      });

      expect(result.messages).toContain('Name required');

      // Fail second validator
      result = await flow.invoke({
        user_message: 'A',
      });

      expect(result.messages).toContain('Min 2 chars');

      // Pass all validators
      result = await flow.invoke({
        user_message: 'John',
      });

      expect((flow.state as any).name).toBe('John');
      expect(flow.isDone).toBe(true);
    });
  });

  describe('Template Interpolation', () => {
    it('should interpolate state variables in messages', async () => {
      const flow = createGraph()
        .addNode({
          id: 'setName',
          action: (state: State) => ({
            messages: [],
            state: { name: 'Alice' },
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'greet',
          action: { message: 'Hello, {name}!' },
          noUserInput: true,
        })
        .addEdge(START, 'setName')
        .addEdge('setName', 'greet')
        .addEdge('greet', END)
        .build({ id: 'test' });

      const result = await flow.invoke({
        user_message: '',
      });

      expect(result.messages).toContain('Hello, Alice!');
    });
  });

  describe('Conditional Edges', () => {
    it('should route based on state conditions', async () => {
      const flow = createGraph()
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
          action: (state: State) => ({
            messages: [],
            state: { age: parseInt(state.age) },
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'adult',
          action: { message: 'You are {age}+' },
          noUserInput: true,
        })
        .addNode({
          id: 'minor',
          action: { message: 'Under 18' },
          noUserInput: true,
        })
        .addEdge(START, 'askAge')
        .addEdge('askAge', 'convertAge')
        .addEdge('convertAge', (state: State) =>
          state.age >= 18 ? 'adult' : 'minor'
        )
        .addEdge('adult', END)
        .addEdge('minor', END)
        .build({ id: 'test' });

      // Test adult path
      let result = await flow.invoke({
        user_message: '',
      });

      result = await flow.invoke({
        user_message: '25',
      });

      expect(result.messages).toContain('You are 25+');
      expect(flow.isDone).toBe(true);
    });

    it('should route to minor path correctly', async () => {
      const flow = createGraph()
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
          action: (state: State) => ({
            messages: [],
            state: { age: parseInt(state.age) },
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'adult',
          action: { message: 'You are {age}+' },
          noUserInput: true,
        })
        .addNode({
          id: 'minor',
          action: { message: 'Under 18' },
          noUserInput: true,
        })
        .addEdge(START, 'askAge')
        .addEdge('askAge', 'convertAge')
        .addEdge('convertAge', (state: State) =>
          state.age >= 18 ? 'adult' : 'minor'
        )
        .addEdge('adult', END)
        .addEdge('minor', END)
        .build({ id: 'test' });

      // Test minor path
      let result = await flow.invoke({
        user_message: '',
      });

      result = await flow.invoke({
        user_message: '16',
      });

      expect(result.messages).toContain('Under 18');
      expect(flow.isDone).toBe(true);
    });
  });

  describe('Function-Based Nodes', () => {
    it('should support function-only nodes', async () => {
      const flow = createGraph()
        .addNode({
          id: 'process',
          action: async (state: State, event: ChatEvent) => ({
            messages: ['Processing...'],
            state: { processed: true },
          }),
          noUserInput: true,
        })
        .addEdge(START, 'process')
        .addEdge('process', END)
        .build({ id: 'test' });

      const result = await flow.invoke({
        user_message: '',
      });

      expect(result.messages).toContain('Processing...');
      expect((flow.state as any).processed).toBe(true);
      expect(flow.isDone).toBe(true);
    });

    it('should support custom validation functions', async () => {
      const flow = createGraph()
        .addNode({
          id: 'custom',
          action: { message: 'Enter code:' },
          validate: async (state: State, event: ChatEvent) => {
            const isValid = event.user_message === 'SECRET';
            return {
              isValid,
              errorMessage: isValid ? undefined : 'Wrong code',
              state: isValid ? { code: event.user_message } : {},
            };
          },
        })
        .addEdge(START, 'custom')
        .addEdge('custom', END)
        .build({ id: 'test' });

      // Action
      let result = await flow.invoke({
        user_message: '',
      });

      // Invalid
      result = await flow.invoke({
        user_message: 'WRONG',
      });

      expect(result.messages).toContain('Wrong code');
      expect(flow.isDone).toBe(false);

      // Valid
      result = await flow.invoke({
        user_message: 'SECRET',
      });

      expect((flow.state as any).code).toBe('SECRET');
      expect(flow.isDone).toBe(true);
    });
  });

  describe('Flow Chaining', () => {
    it('should chain method calls fluently', () => {
      const builder = createGraph();

      const result = builder
        .addNode({ id: 'a', action: { message: 'A' }, noUserInput: true })
        .addNode({ id: 'b', action: { message: 'B' }, noUserInput: true })
        .addEdge(START, 'a')
        .addEdge('a', 'b')
        .addEdge('b', END);

      expect(result).toBe(builder);
    });
  });

  describe('Nodes Without User Input', () => {
    it('should auto-progress through noUserInput nodes', async () => {
      const flow = createGraph()
        .addNode({
          id: 'step1',
          action: { message: 'Step 1' },
          noUserInput: true,
        })
        .addNode({
          id: 'step2',
          action: { message: 'Step 2' },
          noUserInput: true,
        })
        .addNode({
          id: 'step3',
          action: { message: 'Step 3' },
          noUserInput: true,
        })
        .addEdge(START, 'step1')
        .addEdge('step1', 'step2')
        .addEdge('step2', 'step3')
        .addEdge('step3', END)
        .build({ id: 'test' });

      const result = await flow.invoke({
        user_message: '',
      });

      // When nodes auto-progress, only the last message is returned in the result
      // because invoke is called recursively
      expect(result.messages).toContain('Step 3');
      expect(flow.isDone).toBe(true);
    });
  });
});
