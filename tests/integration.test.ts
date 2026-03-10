/**
 * Integration Tests
 *
 * End-to-end flows that combine every feature together:
 * - Multi-step onboarding: ask name → ask age → route child/adult
 * - Contact form: email + phone + confirmation (JSON config + static router)
 * - Retry loop: node keeps re-asking until input meets all criteria
 * - Mixed autoAdvance + user-input + conditional routing + reducers
 * - Async actions + async validation in the same graph
 * - Persistence: save mid-flow, restore to new instance, continue
 * - Complex StaticRouter (JSON) driving multi-branch flows
 * - Builder + all reducer types + conditional routing
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  ChatGraph,
  ChatGraphBuilder,
  START,
  END,
  InferState,
  registry,
  ChatEvent,
} from '../src';
import { MemoryStorageAdapter } from '../src/persistence/memory-adapter';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. Multi-step onboarding — ask name → ask age → route based on age
// ---------------------------------------------------------------------------

describe('Integration: onboarding flow', () => {
  const makeOnboardingGraph = (id: string) => {
    const State = z.object({
      name: z.string().optional(),
      age: z.number().optional(),
      category: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    return {
      State,
      graph: new ChatGraphBuilder({ schema: State, registry })
        .addNode({
          id: 'askName',
          action: { message: 'What is your name?' },
          validate: (state: InferState<typeof State>, event: ChatEvent) => {
            if (!event.userMessage || event.userMessage.trim().length < 2) {
              return {
                isValid: false,
                errorMessage: 'Name must be at least 2 chars',
              };
            }
            return { isValid: true, state: { name: event.userMessage.trim() } };
          },
        })
        .addNode({
          id: 'askAge',
          action: (state: InferState<typeof State>) => ({
            messages: [`Nice to meet you, ${state.name}! How old are you?`],
          }),
          validate: (_state: InferState<typeof State>, event: ChatEvent) => {
            const n = parseInt(event.userMessage, 10);
            if (isNaN(n) || n < 0 || n > 150) {
              return {
                isValid: false,
                errorMessage: 'Please enter a valid age (0-150)',
              };
            }
            return { isValid: true, state: { age: n } };
          },
        })
        .addNode({
          id: 'child',
          action: (state: InferState<typeof State>) => ({
            category: 'child',
            messages: [`${state.name}, you are a child!`],
          }),
          autoAdvance: true,
        })
        .addNode({
          id: 'teen',
          action: (state: InferState<typeof State>) => ({
            category: 'teen',
            messages: [`${state.name}, you are a teenager!`],
          }),
          autoAdvance: true,
        })
        .addNode({
          id: 'adult',
          action: (state: InferState<typeof State>) => ({
            category: 'adult',
            messages: [`${state.name}, you are an adult!`],
          }),
          autoAdvance: true,
        })
        .addEdge(START, 'askName')
        .addEdge('askName', 'askAge')
        .addEdge('askAge', (state: InferState<typeof State>) => {
          if (state.age! < 13) return 'child';
          if (state.age! < 18) return 'teen';
          return 'adult';
        })
        .addEdge('child', END)
        .addEdge('teen', END)
        .addEdge('adult', END)
        .compile({ id }),
    };
  };

  it('routes to "adult" for age 25', async () => {
    const { graph } = makeOnboardingGraph('onboard-adult');
    await graph.invoke({ userMessage: '' });
    await graph.invoke({ userMessage: 'Alice' });
    await graph.invoke({ userMessage: '25' });

    expect(graph.state.name).toBe('Alice');
    expect(graph.state.age).toBe(25);
    expect(graph.state.category).toBe('adult');
    expect(graph.isDone).toBe(true);
  });

  it('routes to "teen" for age 15', async () => {
    const { graph } = makeOnboardingGraph('onboard-teen');
    await graph.invoke({ userMessage: '' });
    await graph.invoke({ userMessage: 'Bob' });
    await graph.invoke({ userMessage: '15' });

    expect(graph.state.category).toBe('teen');
    expect(graph.isDone).toBe(true);
  });

  it('routes to "child" for age 8', async () => {
    const { graph } = makeOnboardingGraph('onboard-child');
    await graph.invoke({ userMessage: '' });
    await graph.invoke({ userMessage: 'Charlie' });
    await graph.invoke({ userMessage: '8' });

    expect(graph.state.category).toBe('child');
    expect(graph.isDone).toBe(true);
  });

  it('rejects a name that is too short, then accepts a valid one', async () => {
    const { graph } = makeOnboardingGraph('onboard-name-retry');
    await graph.invoke({ userMessage: '' });

    const rejected = await graph.invoke({ userMessage: 'X' });
    expect(rejected.messages).toContain('Name must be at least 2 chars');
    expect(graph.isDone).toBe(false);

    await graph.invoke({ userMessage: 'Diana' });
    await graph.invoke({ userMessage: '30' });
    expect(graph.state.name).toBe('Diana');
    expect(graph.isDone).toBe(true);
  });

  it('rejects an invalid age, then accepts valid age', async () => {
    const { graph } = makeOnboardingGraph('onboard-age-retry');
    await graph.invoke({ userMessage: '' });
    await graph.invoke({ userMessage: 'Eve' });

    await graph.invoke({ userMessage: 'blah' }); // not a number
    expect(graph.isDone).toBe(false);

    await graph.invoke({ userMessage: '200' }); // out of range
    expect(graph.isDone).toBe(false);

    await graph.invoke({ userMessage: '22' });
    expect(graph.state.age).toBe(22);
    expect(graph.isDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Contact form — email + phone + thanks (JSON config + static router)
// ---------------------------------------------------------------------------

describe('Integration: contact form (JSON config)', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    storage.clearAll();
  });

  const makeContactGraph = (id: string, stor: MemoryStorageAdapter) => {
    const State = z.object({
      email: z.string().optional(),
      phone: z.string().optional(),
      plan: z.string().default(''),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    return new ChatGraph({
      id,
      schema: State,
      registry,
      storageAdapter: stor,
      autoSave: true,
      nodes: [
        {
          id: 'askEmail',
          action: { message: 'Enter your email:' },
          validate: {
            rules: [
              {
                regex: '\\S+@\\S+\\.\\S+',
                errorMessage: 'Invalid email address',
              },
            ],
            answerKey: 'email',
          },
        },
        {
          id: 'askPhone',
          action: { message: 'Enter your phone (10 digits):' },
          validate: {
            rules: [
              { regex: '^\\d{10}$', errorMessage: 'Phone must be 10 digits' },
            ],
            answerKey: 'phone',
          },
        },
        {
          id: 'askPlan',
          action: { message: 'Choose plan: basic or premium' },
          validate: {
            rules: [
              {
                regex: '^(basic|premium)$',
                errorMessage: 'Choose basic or premium',
              },
            ],
            answerKey: 'plan',
          },
        },
        {
          id: 'basic',
          action: { message: 'You chose the Basic plan. Thank you!' },
          autoAdvance: true,
        },
        {
          id: 'premium',
          action: { message: 'You chose the Premium plan. Thank you!' },
          autoAdvance: true,
        },
      ],
      edges: [
        { from: START, to: 'askEmail' },
        { from: 'askEmail', to: 'askPhone' },
        { from: 'askPhone', to: 'askPlan' },
        {
          from: 'askPlan',
          to: {
            conditions: [
              {
                field: 'plan',
                operator: 'equals',
                value: 'basic',
                goto: 'basic',
              },
              {
                field: 'plan',
                operator: 'equals',
                value: 'premium',
                goto: 'premium',
              },
            ],
            default: END,
          },
        },
        { from: 'basic', to: END },
        { from: 'premium', to: END },
      ],
    });
  };

  it('completes basic flow in minimum invocations', async () => {
    const g = makeContactGraph('contact-basic', storage);
    await g.invoke({ userMessage: '' }); // ask email
    await g.invoke({ userMessage: 'a@b.com' }); // valid email
    await g.invoke({ userMessage: '1234567890' }); // valid phone
    await g.invoke({ userMessage: 'basic' }); // choose plan

    expect(g.state.email).toBe('a@b.com');
    expect(g.state.phone).toBe('1234567890');
    expect(g.state.plan).toBe('basic');
    expect(g.state.messages).toContain('You chose the Basic plan. Thank you!');
    expect(g.isDone).toBe(true);
  });

  it('routes to premium node', async () => {
    const g = makeContactGraph('contact-premium', storage);
    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: 'x@y.com' });
    await g.invoke({ userMessage: '0987654321' });
    await g.invoke({ userMessage: 'premium' });

    expect(g.state.messages).toContain(
      'You chose the Premium plan. Thank you!'
    );
    expect(g.isDone).toBe(true);
  });

  it('rejects invalid email then proceeds with valid', async () => {
    const g = makeContactGraph('contact-email-retry', storage);
    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: 'bad-email' });
    expect(g.isDone).toBe(false);

    await g.invoke({ userMessage: 'valid@mail.com' });
    await g.invoke({ userMessage: '5551234567' });
    await g.invoke({ userMessage: 'basic' });
    expect(g.isDone).toBe(true);
  });

  it('rejects invalid phone, retries, then succeeds', async () => {
    const g = makeContactGraph('contact-phone-retry', storage);
    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: 'test@test.com' });
    await g.invoke({ userMessage: '123' }); // too short
    expect(g.isDone).toBe(false);

    await g.invoke({ userMessage: '1231231234' });
    await g.invoke({ userMessage: 'premium' });
    expect(g.isDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Mixed autoAdvance + user-input nodes + reducer
// ---------------------------------------------------------------------------

describe('Integration: mixed autoAdvance and user-input nodes', () => {
  it('autoAdvance nodes run before/after user-input nodes in one session', async () => {
    const State = z.object({
      steps: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
      answer: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'intro',
        action: () => ({ steps: ['intro'], messages: ['Welcome!'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'setup',
        action: () => ({ steps: ['setup'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'ask',
        action: () => ({ steps: ['ask'], messages: ['Tell me something:'] }),
        validate: (_s: InferState<typeof State>, e: ChatEvent) => ({
          isValid: e.userMessage.length > 0,
          errorMessage: 'Cannot be empty',
          state: { answer: e.userMessage },
        }),
      })
      .addNode({
        id: 'confirm',
        action: (state: InferState<typeof State>) => ({
          steps: ['confirm'],
          messages: [`You said: ${state.answer}`],
        }),
        autoAdvance: true,
      })
      .addNode({
        id: 'outro',
        action: () => ({ steps: ['outro'], messages: ['Goodbye!'] }),
        autoAdvance: true,
      })
      .addEdge(START, 'intro')
      .addEdge('intro', 'setup')
      .addEdge('setup', 'ask')
      .addEdge('ask', 'confirm')
      .addEdge('confirm', 'outro')
      .addEdge('outro', END)
      .compile({ id: 'mixed-flow' });

    // First invoke: runs intro + setup (autoAdvance), then stops at ask
    const r1 = await g.invoke({ userMessage: '' });
    expect(g.isDone).toBe(false);
    expect(r1.steps).toContain('intro');
    expect(r1.steps).toContain('setup');

    // Second invoke: validates ask, then runs confirm + outro
    await g.invoke({ userMessage: 'Hello world' });
    expect(g.isDone).toBe(true);
    expect(g.state.answer).toBe('Hello world');
    expect(g.state.steps).toEqual([
      'intro',
      'setup',
      'ask',
      'confirm',
      'outro',
    ]);
    expect(g.state.messages).toContain('You said: Hello world');
    expect(g.state.messages).toContain('Goodbye!');
  });
});

// ---------------------------------------------------------------------------
// 4. Async actions + async validation in one graph
// ---------------------------------------------------------------------------

describe('Integration: async actions and async validation', () => {
  it('completes a flow with async at every phase', async () => {
    const USERS_DB = new Map([
      ['alice', 'pass123'],
      ['bob', 'secret'],
    ]);

    const State = z.object({
      username: z.string().optional(),
      authenticated: z.boolean().default(false),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'loadConfig',
        action: async () => {
          await new Promise((r) => setTimeout(r, 5)); // simulate config load
          return { messages: ['Config loaded'] };
        },
        autoAdvance: true,
      })
      .addNode({
        id: 'askUsername',
        action: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return { messages: ['Enter username:'] };
        },
        validate: async (_s: InferState<typeof State>, e: ChatEvent) => {
          await new Promise((r) => setTimeout(r, 5));
          if (!USERS_DB.has(e.userMessage)) {
            return { isValid: false, errorMessage: 'Unknown user' };
          }
          return { isValid: true, state: { username: e.userMessage } };
        },
      })
      .addNode({
        id: 'done',
        action: async (state: InferState<typeof State>) => {
          await new Promise((r) => setTimeout(r, 5));
          return {
            authenticated: true,
            messages: [`Welcome, ${state.username}!`],
          };
        },
        autoAdvance: true,
      })
      .addEdge(START, 'loadConfig')
      .addEdge('loadConfig', 'askUsername')
      .addEdge('askUsername', 'done')
      .addEdge('done', END)
      .compile({ id: 'async-all' });

    await g.invoke({ userMessage: '' });

    // Unknown user
    await g.invoke({ userMessage: 'charlie' });
    expect(g.isDone).toBe(false);

    // Valid user
    await g.invoke({ userMessage: 'alice' });
    expect(g.state.username).toBe('alice');
    expect(g.state.authenticated).toBe(true);
    expect(g.isDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Persistence: save mid-flow, restore to new instance, continue
// ---------------------------------------------------------------------------

describe('Integration: save mid-flow and restore', () => {
  it('resumes a paused user-input flow from a restored snapshot', async () => {
    const storage = new MemoryStorageAdapter();
    storage.clearAll();

    const State = z.object({
      step1: z.string().optional(),
      step2: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const makeGraph = (id: string) =>
      new ChatGraph({
        id,
        schema: State,
        registry,
        storageAdapter: storage,
        autoSave: true,
        nodes: [
          {
            id: 'ask1',
            action: { message: 'Step 1:' },
            validate: {
              rules: [{ regex: '\\w+', errorMessage: 'Required' }],
              answerKey: 'step1',
            },
          },
          {
            id: 'ask2',
            action: { message: 'Step 2:' },
            validate: {
              rules: [{ regex: '\\w+', errorMessage: 'Required' }],
              answerKey: 'step2',
            },
          },
          {
            id: 'thanks',
            action: { message: 'All done!' },
            autoAdvance: true,
          },
        ],
        edges: [
          { from: START, to: 'ask1' },
          { from: 'ask1', to: 'ask2' },
          { from: 'ask2', to: 'thanks' },
          { from: 'thanks', to: END },
        ],
      });

    // First "session": provide step1 answer
    const g1 = makeGraph('restore-mid');
    await g1.invoke({ userMessage: '' }); // show step-1 prompt
    await g1.invoke({ userMessage: 'alpha' }); // answer step 1

    expect(g1.state.step1).toBe('alpha');
    expect(g1.isDone).toBe(false); // still on step 2

    // "New session": create a fresh graph pointing at the same storage
    const g2 = makeGraph('restore-mid');
    const restored = await g2.restoreFromSnapshot();
    expect(restored).toBe(true);
    expect(g2.state.step1).toBe('alpha');

    // Continue from where it left off
    await g2.invoke({ userMessage: 'beta' });
    expect(g2.state.step2).toBe('beta');
    expect(g2.isDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Builder + all reducer types + multi-branch routing
// ---------------------------------------------------------------------------

describe('Integration: builder + multiple reducers + routing', () => {
  it('accumulates diverse reducer types and routes correctly', async () => {
    const State = z.object({
      score: z.number().registerReducer(registry, {
        reducer: { fn: (p, n) => p + n },
        default: () => 0,
      }),
      log: z.string().registerReducer(registry, {
        reducer: { fn: (p, n) => `${p}${n}` },
        default: () => '',
      }),
      tags: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => Array.from(new Set([...p, ...n])) },
        default: () => [],
      }),
      grade: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'phase1',
        action: () => ({ score: 30, log: 'A', tags: ['alpha'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'phase2',
        action: () => ({ score: 45, log: 'B', tags: ['beta', 'alpha'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'phase3',
        action: () => ({ score: 25, log: 'C', tags: ['gamma'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'gradeA',
        action: () => ({ grade: 'A', messages: ['Grade: A'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'gradeB',
        action: () => ({ grade: 'B', messages: ['Grade: B'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'gradeC',
        action: () => ({ grade: 'C', messages: ['Grade: C'] }),
        autoAdvance: true,
      })
      .addEdge(START, 'phase1')
      .addEdge('phase1', 'phase2')
      .addEdge('phase2', 'phase3')
      .addEdge('phase3', (state: InferState<typeof State>) => {
        if (state.score >= 90) return 'gradeA';
        if (state.score >= 70) return 'gradeB';
        return 'gradeC';
      })
      .addEdge('gradeA', END)
      .addEdge('gradeB', END)
      .addEdge('gradeC', END)
      .compile({ id: 'multi-reducer-routing' });

    await g.invoke({ userMessage: '' });

    expect(g.state.score).toBe(100); // 30+45+25
    expect(g.state.log).toBe('ABC');
    expect(g.state.tags.sort()).toEqual(['alpha', 'beta', 'gamma']); // deduplicated
    expect(g.state.grade).toBe('A'); // score=100 >= 90
    expect(g.isDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Complex multi-step form with changing routing state
// ---------------------------------------------------------------------------

describe('Integration: quiz flow with scoring and routing', () => {
  it('builds score across questions and shows different ending based on result', async () => {
    const State = z.object({
      score: z.number().registerReducer(registry, {
        reducer: { fn: (p, n) => p + n },
        default: () => 0,
      }),
      answers: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const makeQuestion = (id: string, correct: string, points: number) => ({
      id,
      action: { message: `Q: what is "${id}"?` } as const,
      validate: (_s: InferState<typeof State>, e: ChatEvent) => {
        const isCorrect = e.userMessage.trim().toLowerCase() === correct;
        return {
          isValid: true, // always advance but score accordingly
          state: {
            score: isCorrect ? points : 0,
            answers: [e.userMessage],
          },
        };
      },
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode(makeQuestion('q1', 'paris', 10))
      .addNode(makeQuestion('q2', '42', 10))
      .addNode(makeQuestion('q3', 'h2o', 10))
      .addNode({
        id: 'pass',
        action: () => ({ messages: ['You passed!'] }),
        autoAdvance: true,
      })
      .addNode({
        id: 'fail',
        action: () => ({ messages: ['Try again!'] }),
        autoAdvance: true,
      })
      .addEdge(START, 'q1')
      .addEdge('q1', 'q2')
      .addEdge('q2', 'q3')
      .addEdge('q3', (state: InferState<typeof State>) =>
        state.score >= 20 ? 'pass' : 'fail'
      )
      .addEdge('pass', END)
      .addEdge('fail', END)
      .compile({ id: 'quiz-flow' });

    // Answer q1 (correct +10), q2 (wrong +0), q3 (correct +10)
    await g.invoke({ userMessage: '' }); // show q1
    await g.invoke({ userMessage: 'paris' }); // q1 correct → score: 10
    await g.invoke({ userMessage: 'wrong' }); // q2 wrong  → score: 10
    await g.invoke({ userMessage: 'h2o' }); // q3 correct → score: 20

    expect(g.state.score).toBe(20);
    expect(g.state.messages).toContain('You passed!');
    expect(g.state.answers).toHaveLength(3);
    expect(g.isDone).toBe(true);
  });
});
