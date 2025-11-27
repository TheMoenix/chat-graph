import { Flow, START, END } from '../src';
import type { State } from '../src';

describe('Integration Tests', () => {
  describe('Complete Onboarding Flow', () => {
    it('should complete full onboarding conversation', async () => {
      const flow = new Flow('onboarding');

      flow
        .addNode('greet', {
          action: { message: "Hi! What's your name?" },
          validate: [
            { regex: '\\w+', errorMessage: 'Name required' },
            { regex: '.{2,}', errorMessage: 'Min 2 chars' },
          ],
          targetField: 'name',
        })
        .addNode('askEmail', {
          action: { message: 'Nice to meet you, {name}! Email?' },
          validate: {
            regex: '^\\S+@\\S+\\.\\S+$',
            errorMessage: 'Invalid email',
          },
          targetField: 'email',
        })
        .addNode('askAge', {
          action: { message: 'How old are you?' },
          validate: {
            regex: '^\\d+$',
            errorMessage: 'Enter a number',
          },
          targetField: 'age',
        })
        .addNode('processAge', (state) => ({
          messages: [],
          updates: { age: parseInt(state.age) },
        }))
        .addNode('adult', {
          action: { message: "Welcome, {name}! You're {age}." },
        })
        .addNode('minor', {
          action: { message: 'Sorry {name}, must be 18+.' },
        })
        .addEdge(START, 'greet')
        .addEdge('greet', 'askEmail')
        .addEdge('askEmail', 'askAge')
        .addEdge('askAge', 'processAge')
        .addConditionalEdge('processAge', (state) =>
          state.age >= 18 ? 'adult' : 'minor'
        )
        .addEdge('adult', END)
        .addEdge('minor', END);

      const state: State = {
        __currentNodeId: '',
        __flowId: 'onboarding',
      };

      // Step 1: Greet action
      let result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      expect(result.messages).toContain("Hi! What's your name?");
      expect(result.done).toBe(false);

      // Step 2: Name validation (fail)
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'A',
      });

      expect(result.messages).toContain('Min 2 chars');
      expect(result.done).toBe(false);

      // Step 3: Name validation (success) - should auto-progress to email
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'Alice',
      });

      expect(result.state.name).toBe('Alice');
      expect(result.messages).toContain('Nice to meet you, Alice! Email?');
      expect(result.done).toBe(false);

      // Step 4: Email validation (fail)
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'notanemail',
      });

      expect(result.messages).toContain('Invalid email');
      expect(result.done).toBe(false);

      // Step 5: Email validation (success) - should auto-progress to age
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'alice@example.com',
      });

      expect(result.state.email).toBe('alice@example.com');
      expect(result.messages).toContain('How old are you?');
      expect(result.done).toBe(false);

      // Step 6: Age validation (success) - should complete flow
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: '25',
      });

      expect(result.state.age).toBe(25);
      expect(result.messages).toContain("Welcome, Alice! You're 25.");
      expect(result.done).toBe(true);

      // Verify final state
      expect(result.state.name).toBe('Alice');
      expect(result.state.email).toBe('alice@example.com');
      expect(result.state.age).toBe(25);
    });

    it('should handle minor path correctly', async () => {
      const flow = new Flow('age-check');

      flow
        .addNode('askAge', {
          action: { message: 'Age?' },
          validate: { regex: '^\\d+$', errorMessage: 'Number only' },
          targetField: 'age',
        })
        .addNode('convert', (state) => ({
          messages: [],
          updates: { age: parseInt(state.age) },
        }))
        .addNode('minor', {
          action: { message: 'Under 18: {age}' },
        })
        .addEdge(START, 'askAge')
        .addEdge('askAge', 'convert')
        .addConditionalEdge('convert', (state) =>
          state.age >= 18 ? 'adult' : 'minor'
        )
        .addNode('adult', {
          action: { message: 'Over 18: {age}' },
        })
        .addEdge('adult', END)
        .addEdge('minor', END);

      const state: State = {
        __currentNodeId: '',
        __flowId: 'age-check',
      };

      let result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });

      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: '16',
      });

      expect(result.messages).toContain('Under 18: 16');
      expect(result.done).toBe(true);
    });
  });

  describe('Complex Branching', () => {
    it('should handle multiple conditional branches', async () => {
      const flow = new Flow('quiz');

      flow
        .addNode('askScore', {
          action: { message: 'Enter score (0-100):' },
          validate: {
            regex: '^\\d+$',
            errorMessage: 'Number required',
          },
          targetField: 'score',
        })
        .addNode('convert', (state) => ({
          messages: [],
          updates: { score: parseInt(state.score) },
        }))
        .addNode('excellent', {
          action: { message: 'Excellent! {score}%' },
        })
        .addNode('good', {
          action: { message: 'Good job! {score}%' },
        })
        .addNode('fail', {
          action: { message: 'Failed: {score}%' },
        })
        .addEdge(START, 'askScore')
        .addEdge('askScore', 'convert')
        .addConditionalEdge('convert', (state) => {
          if (state.score >= 90) {
            return 'excellent';
          }
          if (state.score >= 60) {
            return 'good';
          }
          return 'fail';
        })
        .addEdge('excellent', END)
        .addEdge('good', END)
        .addEdge('fail', END);

      // Test excellent path
      let state: State = { __currentNodeId: '', __flowId: 'quiz' };
      let result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: '95',
      });
      expect(result.messages).toContain('Excellent! 95%');

      // Test good path
      state = { __currentNodeId: '', __flowId: 'quiz' };
      result = await flow.compile(state, { type: 'user_message', payload: '' });
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: '75',
      });
      expect(result.messages).toContain('Good job! 75%');

      // Test fail path
      state = { __currentNodeId: '', __flowId: 'quiz' };
      result = await flow.compile(state, { type: 'user_message', payload: '' });
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: '45',
      });
      expect(result.messages).toContain('Failed: 45%');
    });
  });

  describe('State Persistence', () => {
    it('should maintain state across multiple steps', async () => {
      const flow = new Flow('survey');

      flow
        .addNode('q1', {
          action: { message: 'Question 1?' },
          validate: { regex: '.+', errorMessage: 'Required' },
          targetField: 'answer1',
        })
        .addNode('q2', {
          action: { message: 'Question 2?' },
          validate: { regex: '.+', errorMessage: 'Required' },
          targetField: 'answer2',
        })
        .addNode('summary', {
          action: { message: 'Q1: {answer1}, Q2: {answer2}' },
        })
        .addEdge(START, 'q1')
        .addEdge('q1', 'q2')
        .addEdge('q2', 'summary')
        .addEdge('summary', END);

      const state: State = { __currentNodeId: '', __flowId: 'survey' };

      let result = await flow.compile(state, {
        type: 'user_message',
        payload: '',
      });
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'First',
      });
      result = await flow.compile(result.state, {
        type: 'user_message',
        payload: 'Second',
      });

      expect(result.messages).toContain('Q1: First, Q2: Second');
      expect(result.state.answer1).toBe('First');
      expect(result.state.answer2).toBe('Second');
      expect(result.done).toBe(true);
    });
  });
});
