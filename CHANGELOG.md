# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-08-30

### Fixed

- `0.6.0` was published without rebuilding `dist/`, so the tarball carried `0.5.1` compiled output: none of the features listed under `0.6.0` below existed at runtime, and importing `VersionConflictError`, `TurnLimitExceededError` or reading `emittedMessages` yielded `undefined`. `0.6.1` ships the code `0.6.0` described — upgrade if you installed `0.6.0`
- `mergeState`'s schemaless branch no longer violates the project's own `no-unsafe-assignment` rule. `npm run lint` had been failing, which meant the `prepublishOnly` guard (clean → lint → typecheck → build → test) could not complete

## [0.6.0] - 2026-08-30

### Added

- `ChatGraph.emittedMessages` — the messages produced by the most recent `invoke()`, in order. Cleared at the start of every turn and never persisted, so a restored snapshot starts empty and a replayed turn does not re-send old text. `state.messages` keeps its existing behaviour; hosts should send `emittedMessages` instead
- `ChatEvent.payload?: Record<string, unknown>` — structured input alongside the message (a button's stable id, a selected row, coordinates). Passed through untouched to node actions, validators and router functions; never read by the engine and never persisted
- Router functions now receive the `ChatEvent` as a second argument: `(state, event) => nodeId`. Existing `(state) => nodeId` routers are unaffected
- `VersionConflictError` — thrown when a snapshot is saved at a version that already exists, so a host can tell "another process advanced this conversation" apart from a storage failure. The engine never retries; the error propagates out of `invoke()`
- `TurnLimitExceededError` and the `maxNodesPerTurn` option (default `50`) — a cycle of `autoAdvance` nodes previously exhausted the heap and killed the process. The bound is per turn and resets each turn, so cycles through nodes that wait for input still run indefinitely. The error's `path` names the nodes executed during the failed turn

### Fixed

- `MemoryStorageAdapter` stored and returned snapshots by reference, so two graphs that loaded the same snapshot shared one mutable `tracker` and overwrote each other's execution position. Snapshots are now copied in and out
- `MemoryStorageAdapter.saveSnapshot` pushed blindly; it now rejects a `(flowId, version)` that already exists
- `MongoStorageAdapter` now creates a unique index on `{ flowId, version }` and translates duplicate-key errors (code `11000`) into `VersionConflictError` instead of leaking a driver-shaped error

### Changed

- `StorageAdapter.saveSnapshot` now documents that implementations MUST reject a duplicate `(flowId, version)` by throwing `VersionConflictError`
- `StateManager.save` accepts an optional `baseVersion` and derives the next version from it, rather than from an in-process counter map. Omitting it reads the current latest from storage

### Removed

- `StateManager.initializeVersionCounter()` — it existed only to prime the in-process version counter map, which no longer exists

## [0.5.1] - 2026-07-15

### Fixed

- `mergeState` without a schema now concatenates arrays instead of replacing them, ensuring messages from intermediate `autoAdvance` nodes are not overwritten within a single `invoke()` call

## [0.5.0] - 2026-03-10

### Breaking

- `ChatEvent.user_message` renamed to `ChatEvent.userMessage` — update all `invoke()` calls and event handlers to use `userMessage`

### Fixed

- Fixed bug where nodes without a `validate` function could skip the validation phase under certain conditions
- `mergeState` is now always applied after a node action — previously it was skipped if the action returned a falsy value
- Fixed edge routing to gracefully handle undefined edge targets instead of throwing
- Removed spurious `console.warn` when `stateManager` is not configured on the graph
- `restoreFromSnapshot()` no longer logs a warning when called without a `stateManager`

### Added

- Router functions used in edges can now be `async` (return a `Promise<nodeId>`)
- `NodeId`, `EdgeTo`, and `RunnableEdgeTo` types are now exported for library consumers

### Changed

- `RouterCondition.value` is now typed against the schema state instead of `any`, improving type safety in static routers
- Generic defaults for `ValidationResult`, `NodeValidate`, `RouterCondition`, `StaticRouter`, and related types changed from `any` to `StateSchema`

## [0.4.1] - 2026-03-10

### Removed

- Removed `/tests` and `/examples` directories from the published package to reduce bundle size (these are still available in the GitHub repository)

### Fixed

- Fixed broken documentation link for the Node page

### Changed

- Restructured documentation: Action and Validate pages are now nested under the Node section for better organization

## [0.4.0] - 2026-02-04

### Changed

- rename `noUserInput` to `autoAdvance` to avoid double negation
- rename `targetField` to `answerKey` in validation to better reflect purpose
- updated the docs to reflect these changes and improve clarity

## [0.3.2] - 2025-12-20

### Fixed

- build the package correctly with all files included

## [0.3.1] - 2025-12-20

### Changed

- **MongoStorageAdapter Auto-Connection**: `MongoStorageAdapter` now automatically connects on first use
  - Users no longer need to manually call `.connect()` before using the adapter

## [0.3.0] - 2025-12-18

### Added

- **JSON-based Conditional Routing**: Edges now support declarative conditional routing via JSON configuration
  - New `StaticRouter` type for defining routing conditions without functions
  - Support for 11 comparison operators: `equals`, `not_equals`, `gt`, `gte`, `lt`, `lte`, `contains`, `not_contains`, `regex`, `in`, `not_in`
  - Type-safe `field` parameter (validated against schema keys) and `goto` parameter (validated against node IDs)
  - Multiple conditions evaluated in order with first-match semantics
  - Fallback `default` route when no conditions match
  - Enables fully JSON-serializable graph definitions for database storage
- Comprehensive test suite for JSON routing covering all operators and edge cases
- Full backward compatibility with function-based and string-based routing

### Changed

- `EdgeTo` type now accepts `StaticRouter<Nodes, Schema>` in addition to functions and strings
- Internal edge processing converts `StaticRouter` objects to executable functions during graph initialization

## [0.2.5] - 2025-12-18

### Changed

- Refactored `MemoryStorageAdapter` to use static shared storage, enabling data persistence across multiple instances within the same process
- All instances of `MemoryStorageAdapter` now share the same underlying storage Map, acting like an internal Redis

### Added

- Comprehensive test suite for `MemoryStorageAdapter` covering all operations and shared storage behavior

## [0.2.4] - 2025-12-18

### Fixed

- zod import in all files was incorrect

## [0.2.3] - 2025-12-18

### Fixed

- export everything

## [0.2.2] - 2025-12-18

### Fixed

- export directory issue in `package.json`

## [0.2.1] - 2025-12-18

### Added

- Zod-based state schema with reducer support via `StateRegistry` and `registry` singleton
- `ChatGraphBuilder` with strongly-typed state derived from Zod schemas
- Pluggable persistence layer with versioned snapshots
  - `MemoryStorageAdapter` for development/testing
  - `MongoStorageAdapter` for production (optional `mongodb` peer)
- `StateManager` with history, restore, prune, and global singleton helpers
- New examples: interactive builder usage and MongoDB adapter test script
- Comprehensive MongoDB adapter tests using `mongodb-memory-server`

### Changed

- Public exports consolidated in `src/index.ts` to expose builder, schema helpers, persistence, and `z`
- Internal types reorganized under `src/types/`
- Examples and docs updated to schema-first builder and state system

### Breaking

- Removed `createGraph()` in favor of `ChatGraphBuilder`
- Getting started and persistence usage now pass a Zod schema and use the exported `registry`

## [0.1.3] - 2025-12-09

### Added

- Documentation site with VitePress (deployed to GitHub Pages)
- Support for nodes without user input (`noUserInput` property)
- `__isDone` property to Tracker type for flow completion tracking
- Auto-progression through nodes that don't require user input

### Changed

- Split state from internal class tracker to prevent accidental internal variable modifications
- Refactored node structure with `NodeWithUserInput` and `NodeWithoutUserInput` types
- Updated state management to use `state` property instead of `updates` in result types
- Enhanced test coverage for new node types and state handling

### Fixed

- Message carryover when auto-progressing through `noUserInput` nodes
- VitePress base path configuration for correct deployment

## [0.1.2] - 2025-12-08

### Changed

- Refactored node and edge types for improved flexibility and clarity
- Renamed Flow to Graph (ChatGraph) for better semantic clarity
- Split Flow into 2 classes for better implementation with generics
- Improved type safety to avoid casting at user end
- package.json keywords and description updated
- README updated to reflect changes

### Added

- Function-based flow creation with `createGraph()` builder API
- JSON-based flow configuration support

## [0.1.1] - 2025-12-06

### Changed

- Refactored action and validate types to be more abstracted

## [0.1.0] - 2025-11-27

### Added

- Initial beta release
- Core Flow class with builder API
- Two-phase node model (action + validation phases)
- Support for JSON-based node configuration
- Support for function-based node definitions
- Multiple regex validators per node
- Conditional routing based on state
- Template variable interpolation in messages
- Automatic recursive flow execution
- TypeScript support with full type definitions
- Comprehensive test suite with Jest
- Interactive CLI example
- ESM and CommonJS module support
- Example onboarding flow
- Full API documentation
- MIT license

[0.1.0]: https://github.com/TheMoenix/chat-graph/releases/tag/v0.1.0
