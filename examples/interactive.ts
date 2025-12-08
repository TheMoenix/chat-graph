import * as readline from 'readline';
import type { State, StepResult } from '../src/types';
import { createGraph } from '../src/graph';
import { END, START } from '../src';

/**
 * Interactive demo of the chat flow engine
 * Demonstrates two-phase nodes, validation, and conditional routing
 */
async function demo() {
  console.log('=== Chat Flow Interactive Demo ===\n');

  // Using the builder pattern (recommended for type safety)
  const flow = createGraph()
    .addNode({
      id: 'greet',
      action: { message: "Hi! What's your name?" },
      validate: {
        rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name.' }],
        targetField: 'name',
      },
    })
    .addNode({
      id: 'ask_email',
      action: (state: State) => {
        return {
          messages: [`Nice to meet you, ${state.name}! What's your email?`],
        };
      },
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
    .addEdge(START, 'greet')
    .addEdge('greet', 'ask_email')
    .addEdge('ask_email', END)
    .build({ id: 'onboarding', name: 'User Onboarding' });

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askUser = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  };

  // Interactive conversation
  let state: State = {
    __currentNodeId: '',
    __flowId: 'onboarding',
  };

  console.log('=== Flow Start ===\n');

  // Initial step
  let result: StepResult = {
    state,
    messages: [],
    done: false,
  };

  // Conversation loop
  while (!result.done) {
    const userInput = await askUser('You: ');

    result = await flow.compile(state, {
      user_message: userInput,
    });

    // Display bot messages
    result.messages.forEach((msg: string) => console.log(`Bot: ${msg}`));
    state = result.state;
  }

  console.log('\n✅ Conversation complete!');
  console.log('Final state:', {
    name: state.name,
    email: state.email,
    age: state.age,
  });

  rl.close();
}

demo();
