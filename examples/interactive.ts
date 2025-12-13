import * as readline from 'readline';
import type { ChatEvent, State, StepResult } from '../src/types/graph.types';
import { createGraph } from '../src/graph';
import { END, START } from '../src';

/**
 * Interactive demo of the chat flow engine
 * Demonstrates two-phase nodes, validation, and conditional routing
 */
async function demo() {
  console.log('=== Chat Flow Interactive Demo ===\n');

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
          state: {
            just_testing: 'yeah',
          },
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
    .addNode({
      id: 'confirm',
      action: (state: State) => {
        return {
          messages: [
            `Thanks ${state.name}! We've recorded your email as ${state.email}.`,
            'Do you want to submit or start over? (Type "submit" or "restart", default is restart)',
          ],
        };
      },
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
        state.submit_choice.toLowerCase() === 'submit'
      ) {
        return 'thanks';
      } else {
        return 'greet';
      }
    })
    .addEdge('thanks', END)
    .build({ id: 'onboarding' });

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

  console.log('=== Flow Start ===\n');

  // Initial step
  let result: StepResult = {
    messages: [],
  };

  // Conversation loop
  while (!flow.isDone) {
    const userInput = await askUser('You: ');

    result = await flow.invoke({
      user_message: userInput,
    });

    // Display bot messages
    result.messages.forEach((msg: string) => console.log(`Bot: ${msg}`));
  }

  console.log('\n✅ Conversation complete!');
  console.log('Final state:', flow.state);

  rl.close();
}

demo();
