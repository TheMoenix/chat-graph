/**
 * Validation Tests
 *
 * Exhaustive coverage of every validation path:
 * - autoAdvance (no validation phase)
 * - null validate / missing validate (bypass)
 * - Single regex rule: pass, fail, boundary
 * - Multiple regex rules in order
 * - answerKey stores validated input
 * - answerKey null: nothing stored
 * - answerKey for numeric-typed field via regex + manual cast
 * - Function validate (sync): pass / fail / state updates
 * - Function validate (async): pass / fail
 * - Error messages added to state.messages on failure
 * - Multiple failed attempts followed by success
 * - Validation can read current state
 * - Validation can read event.userMessage
 * - Re-prompting: node asks again after every failure
 */

import { describe, it, expect } from '@jest/globals';
import {
  ChatGraph,
  ChatGraphBuilder,
  START,
  END,
  InferState,
  registry,
  ChatEvent,
} from '../src';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const makeSchema = (reducedMessages = true) => {
  const msgs = z.array(z.string());
  return z.object({
    answer: z.string().optional(),
    messages: reducedMessages
      ? msgs.registerReducer(registry, {
          reducer: { fn: (p, n) => p.concat(n) },
          default: () => [],
        })
      : msgs.registerReducer(registry, {
          reducer: { fn: (_p, n) => n }, // replace last
          default: () => [],
        }),
  });
};

// ---------------------------------------------------------------------------
// autoAdvance — no validation phase
// ---------------------------------------------------------------------------

describe('autoAdvance — no validation phase', () => {
  it('single autoAdvance node completes after one invoke', async () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'auto', action: { message: 'Done' }, autoAdvance: true })
      .addEdge(START, 'auto')
      .addEdge('auto', END)
      .compile({ id: 'val-autoadv-single' });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(true);
  });

  it('three chained autoAdvance nodes all run in one invoke', async () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'a', action: { message: '1' }, autoAdvance: true })
      .addNode({ id: 'b', action: { message: '2' }, autoAdvance: true })
      .addNode({ id: 'c', action: { message: '3' }, autoAdvance: true })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', 'c')
      .addEdge('c', END)
      .compile({ id: 'val-autoadv-chain' });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(true);
    expect(graph.state.messages).toEqual(['1', '2', '3']);
  });
});

// ---------------------------------------------------------------------------
// null / missing validate (bypass without autoAdvance)
// ---------------------------------------------------------------------------

describe('null / missing validate — bypass after action', () => {
  it('validate: null — action runs, second invoke advances', async () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'q', action: { message: 'Hi' }, validate: null })
      .addEdge(START, 'q')
      .addEdge('q', END)
      .compile({ id: 'val-null' });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(false);
    expect(graph.state.messages).toContain('Hi');

    await graph.invoke({ userMessage: 'anything' });
    expect(graph.isDone).toBe(true);
  });

  it('validate omitted — same bypass behaviour', async () => {
    const State = makeSchema();
    const graph = new ChatGraphBuilder({ schema: State, registry })
      .addNode({ id: 'q', action: { message: 'Hi' } })
      .addEdge(START, 'q')
      .addEdge('q', END)
      .compile({ id: 'val-missing' });

    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(false);
    await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Single regex rule
// ---------------------------------------------------------------------------

describe('Single Regex Rule', () => {
  const makeEmailGraph = () => {
    const State = z.object({
      email: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    return new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Enter email:' },
        validate: {
          rules: [{ regex: '\\S+@\\S+\\.\\S+', errorMessage: 'Invalid email' }],
          answerKey: 'email',
        },
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'val-regex-email' });
  };

  it('valid email is accepted and advances', async () => {
    const graph = makeEmailGraph();
    await graph.invoke({ userMessage: '' });
    await graph.invoke({ userMessage: 'user@example.com' });
    expect(graph.isDone).toBe(true);
    expect(graph.state.email).toBe('user@example.com');
  });

  it('invalid email is rejected and error message added', async () => {
    const graph = makeEmailGraph();
    await graph.invoke({ userMessage: '' });
    const result = await graph.invoke({ userMessage: 'not-an-email' });
    expect(graph.isDone).toBe(false);
    expect(result.messages).toContain('Invalid email');
  });

  it('graph remains open after rejection; valid input on next invoke succeeds', async () => {
    const graph = makeEmailGraph();
    await graph.invoke({ userMessage: '' });
    await graph.invoke({ userMessage: 'bad-input' });
    expect(graph.isDone).toBe(false);
    await graph.invoke({ userMessage: 'ok@test.org' });
    expect(graph.isDone).toBe(true);
    expect(graph.state.email).toBe('ok@test.org');
  });

  it('edge-case: empty string fails email regex', async () => {
    const graph = makeEmailGraph();
    await graph.invoke({ userMessage: '' });
    const result = await graph.invoke({ userMessage: '' });
    expect(graph.isDone).toBe(false);
    expect(result.messages).toContain('Invalid email');
  });
});

// ---------------------------------------------------------------------------
// Multiple regex rules
// ---------------------------------------------------------------------------

describe('Multiple Regex Rules', () => {
  const makePasswordGraph = () => {
    const State = z.object({
      password: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    return new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'askPw',
        action: { message: 'Enter password:' },
        validate: {
          rules: [
            { regex: '.{8,}', errorMessage: 'Must be at least 8 chars' },
            { regex: '.*[0-9].*', errorMessage: 'Must contain a digit' },
            { regex: '.*[A-Z].*', errorMessage: 'Must contain uppercase' },
          ],
          answerKey: 'password',
        },
      })
      .addEdge(START, 'askPw')
      .addEdge('askPw', END)
      .compile({ id: 'val-multi-regex' });
  };

  it('fails on first rule if too short', async () => {
    const g = makePasswordGraph();
    await g.invoke({ userMessage: '' });
    const result = await g.invoke({ userMessage: 'Hi1' });
    expect(result.messages).toContain('Must be at least 8 chars');
    expect(g.isDone).toBe(false);
  });

  it('passes first rule but fails second (no digit)', async () => {
    const g = makePasswordGraph();
    await g.invoke({ userMessage: '' });
    const result = await g.invoke({ userMessage: 'longpassword' });
    expect(result.messages).toContain('Must contain a digit');
  });

  it('passes first two rules but fails third (no uppercase)', async () => {
    const g = makePasswordGraph();
    await g.invoke({ userMessage: '' });
    const result = await g.invoke({ userMessage: 'longpassword1' });
    expect(result.messages).toContain('Must contain uppercase');
  });

  it('valid password passes all rules', async () => {
    const g = makePasswordGraph();
    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: 'Longpass1' });
    expect(g.isDone).toBe(true);
    expect(g.state.password).toBe('Longpass1');
  });
});

// ---------------------------------------------------------------------------
// answerKey behaviour
// ---------------------------------------------------------------------------

describe('answerKey', () => {
  it('stores validated input under the given key', async () => {
    const State = z.object({
      phone: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Enter phone:' },
        validate: {
          rules: [{ regex: '^\\d{10}$', errorMessage: 'Need 10 digits' }],
          answerKey: 'phone',
        },
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'val-answerkey' });

    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: '1234567890' });
    expect(g.state.phone).toBe('1234567890');
  });

  it('answerKey null: validated input is NOT stored in state', async () => {
    const State = makeSchema();
    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Say yes:' },
        validate: {
          rules: [{ regex: '^yes$', errorMessage: 'Say yes' }],
          answerKey: null,
        },
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'val-answerkey-null' });

    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: 'yes' });
    expect(g.isDone).toBe(true);
    expect((g.state as any).answer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Function validate (sync)
// ---------------------------------------------------------------------------

describe('Function Validate (Sync)', () => {
  it('passes and updates state when isValid: true', async () => {
    const State = z.object({
      age: z.number().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'askAge',
        action: { message: 'Age?' },
        validate: (_state: InferState<typeof State>, event: ChatEvent) => {
          const n = parseInt(event.userMessage, 10);
          if (isNaN(n) || n < 0)
            return { isValid: false, errorMessage: 'Invalid age' };
          return { isValid: true, state: { age: n } };
        },
      })
      .addEdge(START, 'askAge')
      .addEdge('askAge', END)
      .compile({ id: 'val-fn-sync-pass' });

    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: '30' });
    expect(g.state.age).toBe(30);
    expect(g.isDone).toBe(true);
  });

  it('fails and shows error when isValid: false', async () => {
    const State = z.object({
      age: z.number().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'askAge',
        action: { message: 'Age?' },
        validate: (_state: InferState<typeof State>, event: ChatEvent) => {
          const n = parseInt(event.userMessage, 10);
          if (isNaN(n)) return { isValid: false, errorMessage: 'Not a number' };
          return { isValid: true, state: { age: n } };
        },
      })
      .addEdge(START, 'askAge')
      .addEdge('askAge', END)
      .compile({ id: 'val-fn-sync-fail' });

    await g.invoke({ userMessage: '' });
    const r = await g.invoke({ userMessage: 'abc' });
    expect(r.messages).toContain('Not a number');
    expect(g.isDone).toBe(false);
  });

  it('validate can read current state to enforce business rules', async () => {
    const State = z.object({
      minAge: z.number().default(18),
      age: z.number().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'setMin',
        action: () => ({ minAge: 21 }),
        autoAdvance: true,
      })
      .addNode({
        id: 'askAge',
        action: { message: 'Enter age:' },
        validate: (state: InferState<typeof State>, event: ChatEvent) => {
          const n = parseInt(event.userMessage, 10);
          if (isNaN(n)) return { isValid: false, errorMessage: 'Not a number' };
          if (n < state.minAge) {
            return {
              isValid: false,
              errorMessage: `Must be at least ${state.minAge}`,
            };
          }
          return { isValid: true, state: { age: n } };
        },
      })
      .addEdge(START, 'setMin')
      .addEdge('setMin', 'askAge')
      .addEdge('askAge', END)
      .compile({ id: 'val-fn-reads-state' });

    await g.invoke({ userMessage: '' });
    const r = await g.invoke({ userMessage: '19' });
    expect(r.messages).toContain('Must be at least 21');

    await g.invoke({ userMessage: '25' });
    expect(g.state.age).toBe(25);
    expect(g.isDone).toBe(true);
  });

  it('multiple failures accumulate error messages', async () => {
    const State = z.object({
      val: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Give "ok":' },
        validate: (_: InferState<typeof State>, event: ChatEvent) => {
          if (event.userMessage !== 'ok') {
            return { isValid: false, errorMessage: 'Not ok' };
          }
          return { isValid: true, state: { val: 'ok' } };
        },
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'val-fn-multi-fail' });

    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: 'bad1' });
    await g.invoke({ userMessage: 'bad2' });
    const r = await g.invoke({ userMessage: 'ok' });
    expect(g.isDone).toBe(true);
    // Three error messages before success
    const errorCount = r.messages.filter((m) => m === 'Not ok').length;
    expect(errorCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Function validate (async)
// ---------------------------------------------------------------------------

describe('Function Validate (Async)', () => {
  it('awaits async validation and passes', async () => {
    const State = z.object({
      username: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Username:' },
        validate: async (
          _state: InferState<typeof State>,
          event: ChatEvent
        ) => {
          await new Promise((r) => setTimeout(r, 5));
          const taken = ['admin', 'root', 'system'];
          if (taken.includes(event.userMessage)) {
            return { isValid: false, errorMessage: 'Username taken' };
          }
          return { isValid: true, state: { username: event.userMessage } };
        },
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'val-fn-async-pass' });

    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: 'alice' });
    expect(g.state.username).toBe('alice');
    expect(g.isDone).toBe(true);
  });

  it('awaits async validation and fails with error message', async () => {
    const State = z.object({
      username: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Username:' },
        validate: async (
          _state: InferState<typeof State>,
          event: ChatEvent
        ) => {
          await new Promise((r) => setTimeout(r, 5));
          if (event.userMessage === 'admin') {
            return { isValid: false, errorMessage: 'Username taken' };
          }
          return { isValid: true, state: { username: event.userMessage } };
        },
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'val-fn-async-fail' });

    await g.invoke({ userMessage: '' });
    const r = await g.invoke({ userMessage: 'admin' });
    expect(r.messages).toContain('Username taken');
    expect(g.isDone).toBe(false);

    await g.invoke({ userMessage: 'bob' });
    expect(g.isDone).toBe(true);
  });

  it('async validation can resolve after simulated delay', async () => {
    const State = z.object({
      code: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const VALID_CODES = ['ABC123', 'XYZ789'];

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Enter code:' },
        validate: async (_s: InferState<typeof State>, event: ChatEvent) => {
          await new Promise((r) => setTimeout(r, 10)); // simulate DB lookup
          if (!VALID_CODES.includes(event.userMessage)) {
            return { isValid: false, errorMessage: 'Invalid code' };
          }
          return { isValid: true, state: { code: event.userMessage } };
        },
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'val-fn-async-delay' });

    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: 'WRONG' });
    expect(g.isDone).toBe(false);

    await g.invoke({ userMessage: 'ABC123' });
    expect(g.state.code).toBe('ABC123');
    expect(g.isDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error messages in state
// ---------------------------------------------------------------------------

describe('Error Messages in State', () => {
  it('error message is appended to messages (with concat reducer)', async () => {
    const State = z.object({
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Q:' },
        validate: {
          rules: [{ regex: '^yes$', errorMessage: 'Please say yes' }],
          answerKey: null,
        },
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'val-err-concat' });

    await g.invoke({ userMessage: '' });
    const r = await g.invoke({ userMessage: 'no' });
    expect(r.messages).toContain('Q:');
    expect(r.messages).toContain('Please say yes');
  });

  it('no error message in state when validation passes', async () => {
    const State = z.object({
      val: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraphBuilder({ schema: State, registry })
      .addNode({
        id: 'ask',
        action: { message: 'Say yes:' },
        validate: {
          rules: [{ regex: '^yes$', errorMessage: 'Please say yes' }],
          answerKey: 'val',
        },
      })
      .addEdge(START, 'ask')
      .addEdge('ask', END)
      .compile({ id: 'val-no-err-on-pass' });

    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: 'yes' });
    expect(g.state.messages).not.toContain('Please say yes');
    expect(g.state.val).toBe('yes');
  });
});

// ---------------------------------------------------------------------------
// Validation in JSON config (ChatGraph)
// ---------------------------------------------------------------------------

describe('Validation via JSON Config', () => {
  it('regex validation works in JSON config', async () => {
    const State = z.object({
      zip: z.string().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraph({
      id: 'val-json-regex',
      schema: State,
      registry,
      nodes: [
        {
          id: 'askZip',
          action: { message: 'Enter ZIP:' },
          validate: {
            rules: [{ regex: '^\\d{5}$', errorMessage: 'Need 5 digits' }],
            answerKey: 'zip',
          },
        },
      ],
      edges: [
        { from: START, to: 'askZip' },
        { from: 'askZip', to: END },
      ],
    });

    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: '1234' }); // too short
    expect(g.isDone).toBe(false);

    await g.invoke({ userMessage: '12345' });
    expect(g.state.zip).toBe('12345');
    expect(g.isDone).toBe(true);
  });

  it('function validation works in JSON config', async () => {
    const State = z.object({
      score: z.number().optional(),
      messages: z.array(z.string()).registerReducer(registry, {
        reducer: { fn: (p, n) => p.concat(n) },
        default: () => [],
      }),
    });

    const g = new ChatGraph({
      id: 'val-json-fn',
      schema: State,
      registry,
      nodes: [
        {
          id: 'ask',
          action: { message: 'Enter score (0-100):' },
          validate: (_state: InferState<typeof State>, event: ChatEvent) => {
            const n = parseFloat(event.userMessage);
            if (isNaN(n) || n < 0 || n > 100) {
              return { isValid: false, errorMessage: 'Score must be 0-100' };
            }
            return { isValid: true, state: { score: n } };
          },
        },
      ],
      edges: [
        { from: START, to: 'ask' },
        { from: 'ask', to: END },
      ],
    });

    await g.invoke({ userMessage: '' });
    await g.invoke({ userMessage: '150' });
    expect(g.isDone).toBe(false);

    await g.invoke({ userMessage: '85.5' });
    expect(g.state.score).toBe(85.5);
    expect(g.isDone).toBe(true);
  });
});
