# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`chat-graph` is a published npm library (not an app): a code-first, graph-based chat flow engine
with Zod state schemas, reducers, and pluggable persistence. It is inspired by LangGraph but has no
LangChain/LangGraph dependency. `zod` is a peer dependency; `mongodb` is optional.

## Commands

```bash
npm test                          # jest (tests/ only)
npx jest tests/edges.test.ts      # single test file
npm test -- -t "routes to END"    # single test by name
npm run test:coverage             # enforces 80% global thresholds (branches/functions/lines/statements)

npm run lint                      # eslint (src only — tests/examples/docs are ignored)
npm run typecheck                 # tsc --noEmit; tsconfig excludes tests/ and examples/, so this does NOT typecheck them
npm run format                    # prettier

npm run build                     # types → esm → cjs, all into dist/ (cjs runs last and wins)
npm run example                   # interactive CLI demo (examples/interactive.ts)
npm run dev                       # same, with ts-node-dev respawn
npm run docs:dev                  # VitePress docs site (docs/)
```

Mongo tests use `mongodb-memory-server` and self-skip if it cannot start — no external Mongo needed.
`prepublishOnly` runs clean → lint → typecheck → build → test.

## Architecture

Source is small (~1.7k lines); read [src/graph.ts](src/graph.ts) first — it holds both the builder
and the runtime.

**Builder → compiled graph.** `ChatGraphBuilder` (`.addNode().addEdge().compile({id})`) accumulates
plain config and hands it to `ChatGraph`. The builder's type parameter accumulates node literals
(`[...Nodes, NewNode]`), which is what makes edge endpoints, router `goto`s, and `answerKey` fields
type-safe against actual node IDs and schema keys.

**Normalization at construction.** `ChatGraph`'s constructor converts every declarative form into a
function once: `createAction` turns `{ message }` into a state update writing `messages`,
`createValidate` turns `{ rules, answerKey }` into a validator, `createRouter` turns a
`StaticRouter` (`{conditions, default}`, evaluated in order by `evaluateCondition`) into a routing
function. The `Runnable extends boolean` type parameter on `Node`/`NodeAction`/`NodeValidate`
distinguishes the public (config-or-function) form from the internal normalized (function-only)
form. Everything downstream deals only with functions.

**Two-phase node execution.** Each node has an _action_ phase and a _validation_ phase, driven by
the `Tracker` (`__currentNodeId`, `__isActionTaken`, `__isResponseValid`, `__isDone`). One
`invoke(event)` runs `subInvoke`, which executes one phase per pass and recurses only when both
flags are true — so the graph naturally halts mid-node waiting for the next user message. Nodes
with `autoAdvance: true` set `__isResponseValid` immediately and cannot have `validate` (the type
union `NodeWithUserInput | NodeWithoutUserInput` enforces this).

**Per-turn state vs persisted state.** One `invoke()` is a _turn_, and three things live only for
its duration, deliberately never persisted: `emitted` (exposed as `emittedMessages` — what the turn
produced, which is what a host sends), `turnPath` (nodes executed, bounded by `maxNodesPerTurn`,
default 50, throwing `TurnLimitExceededError`), and `ChatEvent.payload` (structured channel input,
opaque to the engine). All three reset at the top of `invoke()`. `state.messages` is by contrast the
accumulated history, shaped by whatever reducer the schema registers — it cannot answer "what did
this turn produce", which is why `emittedMessages` exists.

**Optimistic concurrency.** `ChatGraph` tracks `loadedVersion` — the snapshot version the current
turn loaded — and every save writes `loadedVersion + 1` via `persistSnapshot()`. Adapters must
reject a duplicate `(flowId, version)` with `VersionConflictError`; the engine never retries and
lets it propagate out of `invoke()`. Deriving the version from the turn's load — not from a re-read
at save time, and not from process memory — is what makes a concurrent writer detectable.

**State merging** ([src/schema/state-schema.ts](src/schema/state-schema.ts)). The schema must be a
`z.ZodObject` containing `messages: z.array(z.string())` — static `{ message }` actions and
validation error messages both write there. Per-field reducers are registered via
`registry.registerField` / the `.registerReducer(registry, {reducer, default})` method that
`extendZodWithRegister()` patches onto `z.ZodType.prototype` (auto-run on import, with a `declare
module 'zod'` augmentation). Metadata is stored on the Zod schema _instance_ under a symbol.
`mergeState` looks up `schema.shape[key]` and applies the reducer if one is registered, else
shallow-merges. With no schema/registry it falls back to concatenating arrays and shallow-merging
everything else, so multi-node `autoAdvance` turns don't lose messages.

**Persistence** ([src/persistence/](src/persistence/), [src/state-manager.ts](src/state-manager.ts)).
`StorageAdapter` is an abstract class (extend it for custom backends — see
[tests/custom-adapter.test.ts](tests/custom-adapter.test.ts)); Memory and Mongo implementations
ship. `StateManager` wraps an adapter and numbers `StateSnapshot`s (state + tracker); its `save`
takes an optional `baseVersion` and reads the current latest only when that is omitted. `ChatGraph`
only creates a `StateManager` when a `storageAdapter` is passed to `compile`; `autoSave` defaults to
true but is a no-op without one. Note that `invoke()` _reloads the latest snapshot from storage at
the start of every call_ — that is the stateless-host design, where a fresh graph object per turn is
expected.

An adapter must also never hand back stored objects by reference: the engine mutates `state` and
`tracker` in place, so two graphs loading one snapshot would share and corrupt it.
`MemoryStorageAdapter` copies on the way in and out for exactly this reason.

## Gotchas

- Reducer metadata is bound to a specific Zod schema instance. Chaining after registration
  (`z.array(z.string()).registerReducer(...).optional()`) yields a new wrapper instance whose config
  won't be found by `mergeState`. Register last.
- Message interpolation is `{{key}}` (`interpolate` in graph.ts), not `{key}` — some JSDoc says
  otherwise.
- `createInitialState` swallows Zod parse failures and returns the unparsed object, so a bad
  `initialState` fails silently rather than throwing.
- `MemoryStorageAdapter.sharedStorage` is `static`, so every instance in a process shares data.
  Tests call `clearAll()` in `beforeEach`.
- `MemoryStorageAdapter.loadSnapshot` treats the _last pushed_ entry as "latest", while
  `pruneHistory` leaves the array sorted newest-first — so a load after a prune returns the oldest
  kept snapshot. Nothing in the engine calls `pruneHistory`, so this is unreachable from `ChatGraph`
  today.
- ESLint on `src/` is strict: explicit return types on exported functions, no `any`, no unsafe
  member access, `strict-boolean-expressions` (hence the verbose `!== undefined` / `=== true`
  comparisons throughout — match that style), and a `naming-convention` rule that only permits
  non-camelCase properties when they start with `__` (the tracker fields).
- `npm run format` runs prettier over `**/*.{ts,json,md}`, which reformats embedded code inside
  markdown fences. Prefer `npx prettier --write <files>` on what you actually touched.
