import { createGraph, START, END } from '../src';
import { State } from '../src/types/state.types';

describe('Integration Tests', () => {
  describe('Complete Onboarding Flow', () => {
    it('should complete full onboarding conversation', async () => {
      const flow = createGraph()
        .addNode({
          id: 'greet',
          action: { message: "Hi! What's your name?" },
          validate: {
            rules: [
              { regex: '\\w+', errorMessage: 'Name required' },
              { regex: '.{2,}', errorMessage: 'Min 2 chars' },
            ],
            targetField: 'name',
          },
        })
        .addNode({
          id: 'askEmail',
          action: (state: State) => ({
            messages: [`Nice to meet you, ${state.name}! What's your email?`],
          }),
          validate: {
            rules: [
              { regex: '^\\S+@\\S+\\.\\S+$', errorMessage: 'Invalid email' },
            ],
            targetField: 'email',
          },
        })
        .addNode({
          id: 'askAge',
          action: { message: 'How old are you?' },
          validate: {
            rules: [{ regex: '^\\d+$', errorMessage: 'Enter a number' }],
            targetField: 'age',
          },
        })
        .addNode({
          id: 'processAge',
          action: (state: State) => ({
            messages: [],
            state: { age: parseInt(state.age as string) },
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'adult',
          action: (state: State) => ({
            messages: [`Welcome, ${state.name}! You're ${state.age}.`],
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'minor',
          action: (state: State) => ({
            messages: [`Sorry ${state.name}, must be 18+.`],
          }),
          noUserInput: true,
        })
        .addEdge(START, 'greet')
        .addEdge('greet', 'askEmail')
        .addEdge('askEmail', 'askAge')
        .addEdge('askAge', 'processAge')
        .addEdge('processAge', (state: State) =>
          (state.age as number) >= 18 ? 'adult' : 'minor'
        )
        .addEdge('adult', END)
        .addEdge('minor', END)
        .build({ id: 'onboarding' });

      // Step 1: Greet action
      let result = await flow.invoke({
        user_message: '',
      });

      expect(result.messages).toContain("Hi! What's your name?");
      expect(flow.isDone).toBe(false);

      // Step 2: Name validation (fail)
      result = await flow.invoke({
        user_message: 'A',
      });

      expect(result.messages).toContain('Min 2 chars');
      expect(flow.isDone).toBe(false);

      // Step 3: Name validation (success) - should auto-progress to email
      result = await flow.invoke({
        user_message: 'Alice',
      });

      expect((flow.state as any).name).toBe('Alice');
      expect(result.messages).toContain(
        "Nice to meet you, Alice! What's your email?"
      );
      expect(flow.isDone).toBe(false);

      // Step 4: Email validation (fail)
      result = await flow.invoke({
        user_message: 'notanemail',
      });

      expect(result.messages).toContain('Invalid email');
      expect(flow.isDone).toBe(false);

      // Step 5: Email validation (success) - should auto-progress to age
      result = await flow.invoke({
        user_message: 'alice@example.com',
      });

      expect((flow.state as any).email).toBe('alice@example.com');
      expect(result.messages).toContain('How old are you?');
      expect(flow.isDone).toBe(false);

      // Step 6: Age validation (success) - should complete flow
      result = await flow.invoke({
        user_message: '25',
      });

      expect((flow.state as any).age).toBe(25);
      expect(result.messages).toContain("Welcome, Alice! You're 25.");
      expect(flow.isDone).toBe(true);

      // Verify final state
      expect((flow.state as any).name).toBe('Alice');
      expect((flow.state as any).email).toBe('alice@example.com');
      expect((flow.state as any).age).toBe(25);
    });

    it('should handle minor path correctly', async () => {
      const flow = createGraph()
        .addNode({
          id: 'askAge',
          action: { message: 'Age?' },
          validate: {
            rules: [{ regex: '^\\d+$', errorMessage: 'Number only' }],
            targetField: 'age',
          },
        })
        .addNode({
          id: 'convert',
          action: (state: State) => ({
            messages: [],
            state: { age: parseInt(state.age as string) },
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'minor',
          action: { message: 'Under 18: {age}' },
          noUserInput: true,
        })
        .addNode({
          id: 'adult',
          action: { message: 'Over 18: {age}' },
          noUserInput: true,
        })
        .addEdge(START, 'askAge')
        .addEdge('askAge', 'convert')
        .addEdge('convert', (state: State) =>
          (state.age as number) >= 18 ? 'adult' : 'minor'
        )
        .addEdge('adult', END)
        .addEdge('minor', END)
        .build({ id: 'age-check' });

      let result = await flow.invoke({
        user_message: '',
      });

      result = await flow.invoke({
        user_message: '16',
      });

      expect(result.messages).toContain('Under 18: 16');
      expect(flow.isDone).toBe(true);
    });
  });

  describe('Complex Branching', () => {
    it('should handle multiple conditional branches', async () => {
      const flow = createGraph()
        .addNode({
          id: 'askScore',
          action: { message: 'Enter score (0-100):' },
          validate: {
            rules: [{ regex: '^\\d+$', errorMessage: 'Number required' }],
            targetField: 'score',
          },
        })
        .addNode({
          id: 'convert',
          action: (state: State) => ({
            messages: [],
            state: { score: parseInt(state.score as string) },
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'excellent',
          action: { message: 'Excellent! {score}%' },
          noUserInput: true,
        })
        .addNode({
          id: 'good',
          action: { message: 'Good job! {score}%' },
          noUserInput: true,
        })
        .addNode({
          id: 'fail',
          action: { message: 'Failed: {score}%' },
          noUserInput: true,
        })
        .addEdge(START, 'askScore')
        .addEdge('askScore', 'convert')
        .addEdge('convert', (state: State) => {
          if ((state.score as number) >= 90) {
            return 'excellent';
          }
          if ((state.score as number) >= 60) {
            return 'good';
          }
          return 'fail';
        })
        .addEdge('excellent', END)
        .addEdge('good', END)
        .addEdge('fail', END)
        .build({ id: 'quiz' });

      // Test excellent path
      let flow1 = createGraph()
        .addNode({
          id: 'askScore',
          action: { message: 'Enter score (0-100):' },
          validate: {
            rules: [{ regex: '^\\d+$', errorMessage: 'Number required' }],
            targetField: 'score',
          },
        })
        .addNode({
          id: 'convert',
          action: (state: State) => ({
            messages: [],
            state: { score: parseInt(state.score as string) },
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'excellent',
          action: { message: 'Excellent! {score}%' },
          noUserInput: true,
        })
        .addNode({
          id: 'good',
          action: { message: 'Good job! {score}%' },
          noUserInput: true,
        })
        .addNode({
          id: 'fail',
          action: { message: 'Failed: {score}%' },
          noUserInput: true,
        })
        .addEdge(START, 'askScore')
        .addEdge('askScore', 'convert')
        .addEdge('convert', (state: State) => {
          if ((state.score as number) >= 90) {
            return 'excellent';
          }
          if ((state.score as number) >= 60) {
            return 'good';
          }
          return 'fail';
        })
        .addEdge('excellent', END)
        .addEdge('good', END)
        .addEdge('fail', END)
        .build({ id: 'quiz1' });

      let result = await flow1.invoke({ user_message: '' });
      result = await flow1.invoke({ user_message: '95' });
      expect(result.messages).toContain('Excellent! 95%');

      // Test good path
      let flow2 = createGraph()
        .addNode({
          id: 'askScore',
          action: { message: 'Enter score (0-100):' },
          validate: {
            rules: [{ regex: '^\\d+$', errorMessage: 'Number required' }],
            targetField: 'score',
          },
        })
        .addNode({
          id: 'convert',
          action: (state: State) => ({
            messages: [],
            state: { score: parseInt(state.score as string) },
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'excellent',
          action: { message: 'Excellent! {score}%' },
          noUserInput: true,
        })
        .addNode({
          id: 'good',
          action: { message: 'Good job! {score}%' },
          noUserInput: true,
        })
        .addNode({
          id: 'fail',
          action: { message: 'Failed: {score}%' },
          noUserInput: true,
        })
        .addEdge(START, 'askScore')
        .addEdge('askScore', 'convert')
        .addEdge('convert', (state: State) => {
          if ((state.score as number) >= 90) {
            return 'excellent';
          }
          if ((state.score as number) >= 60) {
            return 'good';
          }
          return 'fail';
        })
        .addEdge('excellent', END)
        .addEdge('good', END)
        .addEdge('fail', END)
        .build({ id: 'quiz2' });

      result = await flow2.invoke({ user_message: '' });
      result = await flow2.invoke({ user_message: '75' });
      expect(result.messages).toContain('Good job! 75%');

      // Test fail path
      let flow3 = createGraph()
        .addNode({
          id: 'askScore',
          action: { message: 'Enter score (0-100):' },
          validate: {
            rules: [{ regex: '^\\d+$', errorMessage: 'Number required' }],
            targetField: 'score',
          },
        })
        .addNode({
          id: 'convert',
          action: (state: State) => ({
            messages: [],
            state: { score: parseInt(state.score as string) },
          }),
          noUserInput: true,
        })
        .addNode({
          id: 'excellent',
          action: { message: 'Excellent! {score}%' },
          noUserInput: true,
        })
        .addNode({
          id: 'good',
          action: { message: 'Good job! {score}%' },
          noUserInput: true,
        })
        .addNode({
          id: 'fail',
          action: { message: 'Failed: {score}%' },
          noUserInput: true,
        })
        .addEdge(START, 'askScore')
        .addEdge('askScore', 'convert')
        .addEdge('convert', (state: State) => {
          if ((state.score as number) >= 90) {
            return 'excellent';
          }
          if ((state.score as number) >= 60) {
            return 'good';
          }
          return 'fail';
        })
        .addEdge('excellent', END)
        .addEdge('good', END)
        .addEdge('fail', END)
        .build({ id: 'quiz3' });

      result = await flow3.invoke({ user_message: '' });
      result = await flow3.invoke({ user_message: '45' });
      expect(result.messages).toContain('Failed: 45%');
    });
  });

  describe('State Persistence', () => {
    it('should maintain state across multiple steps', async () => {
      const flow = createGraph()
        .addNode({
          id: 'q1',
          action: { message: 'Question 1?' },
          validate: {
            rules: [{ regex: '.+', errorMessage: 'Required' }],
            targetField: 'answer1',
          },
        })
        .addNode({
          id: 'q2',
          action: { message: 'Question 2?' },
          validate: {
            rules: [{ regex: '.+', errorMessage: 'Required' }],
            targetField: 'answer2',
          },
        })
        .addNode({
          id: 'summary',
          action: { message: 'Q1: {answer1}, Q2: {answer2}' },
          noUserInput: true,
        })
        .addEdge(START, 'q1')
        .addEdge('q1', 'q2')
        .addEdge('q2', 'summary')
        .addEdge('summary', END)
        .build({ id: 'survey' });

      let result = await flow.invoke({
        user_message: '',
      });
      result = await flow.invoke({
        user_message: 'First',
      });
      result = await flow.invoke({
        user_message: 'Second',
      });

      expect(result.messages).toContain('Q1: First, Q2: Second');
      expect((flow.state as any).answer1).toBe('First');
      expect((flow.state as any).answer2).toBe('Second');
      expect(flow.isDone).toBe(true);
    });
  });

  describe('Looping Flow', () => {
    it('should handle looping back to previous nodes', async () => {
      const flow = createGraph()
        .addNode({
          id: 'greet',
          action: { message: "Hi! What's your name?" },
          validate: {
            rules: [
              { regex: '\\w+', errorMessage: 'Please enter a valid name.' },
            ],
            targetField: 'name',
          },
        })
        .addNode({
          id: 'ask_email',
          action: (state: State) => ({
            messages: [`Nice to meet you, ${state.name}! What's your email?`],
            state: { just_testing: 'yeah' },
          }),
          validate: {
            rules: [
              {
                regex: '\\S+@\\S+\\.\\S+',
                errorMessage: 'Please enter a valid email.',
              },
            ],
            targetField: 'email',
          },
        })
        .addNode({
          id: 'confirm',
          action: (state: State) => ({
            messages: [
              `Thanks ${state.name}! We've recorded your email as ${state.email}.`,
              'Do you want to submit or start over? (Type "submit" or "restart")',
            ],
          }),
          validate: {
            rules: [],
            targetField: 'submit_choice',
          },
        })
        .addNode({
          id: 'thanks',
          action: { message: 'Thank you!' },
          noUserInput: true,
        })
        .addEdge(START, 'greet')
        .addEdge('greet', 'ask_email')
        .addEdge('ask_email', 'confirm')
        .addEdge('confirm', (state: State) => {
          if (
            state.submit_choice &&
            (state.submit_choice as string).toLowerCase() === 'submit'
          ) {
            return 'thanks';
          } else {
            return 'greet';
          }
        })
        .addEdge('thanks', END)
        .build({ id: 'onboarding-loop' });

      // Initial greeting
      let result = await flow.invoke({ user_message: '' });
      expect(result.messages).toContain("Hi! What's your name?");

      // Provide name
      result = await flow.invoke({ user_message: 'Alice' });
      expect(result.messages).toContain(
        "Nice to meet you, Alice! What's your email?"
      );

      // Provide email
      result = await flow.invoke({ user_message: 'alice@example.com' });
      expect(result.messages).toContain(
        "Thanks Alice! We've recorded your email as alice@example.com."
      );

      // Choose to restart
      result = await flow.invoke({ user_message: 'restart' });
      expect(result.messages).toContain("Hi! What's your name?");
      expect(flow.isDone).toBe(false);

      // Provide new name
      result = await flow.invoke({ user_message: 'Bob' });
      expect(result.messages).toContain(
        "Nice to meet you, Bob! What's your email?"
      );

      // Provide email
      result = await flow.invoke({ user_message: 'bob@example.com' });
      expect(result.messages).toContain(
        "Thanks Bob! We've recorded your email as bob@example.com."
      );

      // Submit this time
      result = await flow.invoke({ user_message: 'submit' });
      expect(result.messages).toContain('Thank you!');
      expect(flow.isDone).toBe(true);
    });
  });
});
