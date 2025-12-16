import * as readline from 'readline';
import { END, InferState, registry, START, z } from '../src';
import { ChatGraph } from '../src/graph';

/**
 * Interactive demo of the chat flow engine
 * Demonstrates two-phase nodes, validation, and conditional routing
 */
async function demo() {
  console.log('=== Chat Flow Interactive Demo ===\n');

  // Define the state schema using Zod with reducer support
  const WorkflowState = z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    submit_choice: z.string().optional(),
    just_testing: z.string().optional(),

    // Array field with reducer that concatenates arrays
    messages: z.array(z.string()).registerReducer(registry, {
      reducer: {
        fn: (prev, next) => next, // Replace previous messages with new ones
      },
      default: () => [] as string[],
    }),
  });
  const flow = new ChatGraph({
    id: 'test_flow',
    schema: WorkflowState,
    nodes: [
      {
        id: 'greet',
        action: { message: "Hi! What's your name?" },
        validate: {
          rules: [
            { regex: '\\w+', errorMessage: 'Please enter a valid name.' },
          ],
          targetField: 'name',
        },
      },
      {
        id: 'ask_email',
        action: {
          message: "Nice to meet you, {{name}}! What's your email",
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
      },
    ],
    edges: [
      { from: START, to: 'greet' },
      { from: 'greet', to: 'ask_email' },
      { from: 'ask_email', to: END },
    ],
  });

  // const flow = new ChatGraphBuilder({
  //   schema: WorkflowState,
  // })
  //   .addNode({
  //     id: 'greet',
  //     action: { message: "Hi! What's your name?" },
  //     validate: {
  //       rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name.' }],
  //       targetField: 'name',
  //     },
  //   })
  //   .addNode({
  //     id: 'ask_email',
  //     action: (state: State) => {
  //       return {
  //         messages: [`Nice to meet you, ${state.name}! What's your email?`],
  //         just_testing: 'yeah',
  //       };
  //     },
  //     validate: {
  //       rules: [
  //         {
  //           regex: '\\S+@\\S+\\.\\S+',
  //           errorMessage: 'Please enter a valid email.',
  //         },
  //       ],
  //       targetField: 'email',
  //     },
  //   })
  //   .addNode({
  //     id: 'confirm',
  //     action: (state: State) => {
  //       return {
  //         messages: [
  //           `Thanks ${state.name}! We've recorded your email as ${state.email}.`,
  //           'Do you want to submit or start over? (Type "submit" or "restart", default is restart)',
  //         ],
  //       };
  //     },
  //     validate: {
  //       rules: [],
  //       targetField: 'submit_choice',
  //     },
  //   })
  //   .addNode({
  //     id: 'thanks',
  //     action: { message: 'Thank you!' },
  //     noUserInput: true,
  //   })
  //   .addEdge(START, 'greet')
  //   .addEdge('greet', 'ask_email')
  //   .addEdge('ask_email', 'confirm')
  //   .addEdge('confirm', (state: State) => {
  //     if (
  //       state.submit_choice &&
  //       state.submit_choice.toLowerCase() === 'submit'
  //     ) {
  //       return 'thanks';
  //     } else {
  //       return 'greet';
  //     }
  //   })
  //   .addEdge('thanks', END)
  //   .compile({ id: 'onboarding' });

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
  let result: InferState<typeof WorkflowState> = {
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
