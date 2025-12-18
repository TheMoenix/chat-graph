# State & Zod

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

// 2) Build a small flow
const flow = new ChatGraphBuilder({ schema: State })
  .addNode({ id: 'greet', action: () => ({ messages: ['Hello!'] }) })
  .addNode({ id: 'count', action: (s) => ({ count: s.count + 1 }) })
  .addEdge(START, 'greet')
  .addEdge('greet', 'count')
  .addEdge('count', END)
  .compile({ id: 'state-demo' });

await flow.invoke({ user_message: '' });
console.log(flow.state);
```

## Reducers (Merging)

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

- Type safety is for developer experience; runtime does not enforce schema.
- If you bypass types, execution continues (prefer custom validation if needed).

```typescript
// No runtime crash; types are for DX
const bad = { unknown: 'x' } as any;
```

## Tips

- Prefer small, composable reducers.
- Keep state minimal; derive display strings in actions.
- Use `registry` singleton or your own `StateRegistry`.
