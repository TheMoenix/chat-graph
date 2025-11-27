import * as readline from 'readline';
import { Flow } from '../src/flow';
import { START, END } from '../src/constants';
import type { State, StepResult } from '../src/types';

/**
 * Interactive demo of the chat flow engine
 * Demonstrates two-phase nodes, validation, and conditional routing
 */
async function demo() {
  console.log('=== Chat Flow Interactive Demo ===\n');

  const flow = new Flow('onboarding', 'User Onboarding');

  flow
    .addNode('greet', {
      action: { message: "👋 Hi! What's your name?" },
      validate: [
        { regex: '\\w+', errorMessage: 'Please enter a valid name.' },
        { regex: '.{2,}', errorMessage: 'Name must be at least 2 characters.' },
      ],
      targetField: 'name',
    })
    .addNode('askEmail', {
      action: { message: "Nice to meet you, {name}! What's your email?" },
      validate: {
        regex: '^\\S+@\\S+\\.\\S+$',
        errorMessage: "That doesn't look like a valid email.",
      },
      targetField: 'email',
    })
    .addNode('askAge', {
      action: { message: 'How old are you?' },
      validate: {
        regex: '^\\d+$',
        errorMessage: 'Please enter a valid age.',
      },
      targetField: 'age',
    })
    .addNode('processAge', {
      action: (state: State) => {
        // Convert age to number
        state.age = parseInt(state.age);
        return { messages: [], updates: { age: state.age } };
      },
    })
    .addNode('adult', {
      action: { message: "Great! You're {age}. Welcome aboard! 🎉" },
    })
    .addNode('minor', {
      action: { message: "You're {age}. Sorry, you must be 18+." },
    })
    .addEdge(START, 'greet')
    .addEdge('greet', 'askEmail')
    .addEdge('askEmail', 'askAge')
    .addEdge('askAge', 'processAge')
    .addConditionalEdge('processAge', (state: State) => {
      return state.age >= 18 ? 'adult' : 'minor';
    })
    .addEdge('adult', END)
    .addEdge('minor', END);

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
      type: 'user_message',
      payload: userInput,
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
