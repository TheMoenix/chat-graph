# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
