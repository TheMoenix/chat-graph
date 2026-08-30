# State Management

Define state with Zod, get type-safe updates, and use simple reducers for merging. Runtime stays flexible — no forced validation.

## Quick Start

```typescript
import { ChatGraphBuilder, START, END, z, registry } from 'chat-graph';

// 1) Define typed state
const State = z.object({
  name: z.string().default(''),
  count: z.number().default(0),
  messages: z.array(z.string()).registerReducer(registry, {
    reducer: { fn: (prev, next) => [...prev, ...next] },
    default: () => [],
  }),
});

// 2) Build a small flow.
// autoAdvance means neither node waits for input, so one invoke() runs both.
const flow = new ChatGraphBuilder({ schema: State })
  .addNode({
    id: 'greet',
    autoAdvance: true,
    action: () => ({ messages: ['Hello!'] }),
  })
  .addNode({
    id: 'count',
    autoAdvance: true,
    action: (s) => ({ count: s.count + 1 }),
  })
  .addEdge(START, 'greet')
  .addEdge('greet', 'count')
  .addEdge('count', END)
  .compile({ id: 'state-demo' });

await flow.invoke({ userMessage: '' });
console.log(flow.state); // { name: '', count: 1, messages: ['Hello!'] }
```

Without `autoAdvance` a node waits for the next `invoke()` before the flow moves on — that is
the point of the two-phase model, and it is why one turn can span several nodes.

## Reducers (Merging)

A reducer decides how a field's new value merges into the existing one. Without one, a field
is replaced outright.

- Arrays: concatenate new values into existing lists.
- Numbers: sum or accumulate.
- Objects: shallow merge with `{ ...prev, ...next }`.

```typescript
const S = z.object({
  items: z.array(z.string()).registerReducer(registry, {
    reducer: { fn: (prev, next) => [...(prev || []), ...next] },
    default: () => [],
  }),
  score: z.number().registerReducer(registry, {
    reducer: { fn: (prev, next) => (prev || 0) + next },
    default: () => 0,
  }),
});
```

::: warning Register the reducer last
Reducer config is attached to the exact Zod schema instance you call `registerReducer` on.
Chaining after it produces a **new** instance that carries no config, and the reducer is
silently ignored:

```typescript
// ✅ works
z.array(z.string()).optional().registerReducer(registry, { ... })

// ❌ silently ignored — .optional() returns a different instance
z.array(z.string()).registerReducer(registry, { ... }).optional()
```

:::

## `messages` and turn output

Every state schema must include `messages: z.array(z.string())`. It is the accumulated
conversation history, and its reducer shapes how that history is kept.

It is **not** what you send to the user. Read `graph.emittedMessages` for that — the
messages the current turn produced. A concatenating reducer would have you re-send the whole
conversation; a replacing one drops everything but the last node of a multi-node turn. See
[Turns](./turns).

## Defaults

- Use Zod `.default()` for simple fields.
- Use registry `default` for fields with reducers.

```typescript
const S = z.object({
  title: z.string().default(''),
  tags: z.array(z.string()).registerReducer(registry, {
    default: () => [],
    reducer: { fn: (prev, next) => [...prev, ...next] },
  }),
});
```

## Runtime Flexibility

Type safety here is for developer experience — the schema is not enforced at runtime, and
state updates are merged without validation. A field your schema does not declare is still
merged rather than rejected, and execution continues.

Two consequences worth knowing:

- Add your own checks in a `validate` function where correctness matters.
- `initialState` is parsed with Zod, but a parse failure is swallowed and the raw object is
  used as-is, so a malformed `initialState` fails quietly rather than throwing.

## Tips

- Prefer small, composable reducers.
- Keep state minimal; derive display strings in actions.
- Use the `registry` singleton, or your own `StateRegistry` for isolation between graphs.
- Constructing `ChatGraph` directly? Pass `registry` alongside `schema`, or reducers are
  ignored — see [The Graph](./graph).
