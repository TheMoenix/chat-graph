# Contributing to chat-graph

Thank you for considering contributing to this project!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/TheMoenix/chat-graph.git
cd chat-graph# Install dependencies
npm install

# Run tests
npm test

# Run example
npm run example

# Build
npm run build
```

## Project Structure

```
chat-graph/
├── src/              # Source code
│   ├── index.ts      # Main exports
│   ├── flow.ts       # Flow class implementation
│   ├── types.ts      # TypeScript type definitions
│   └── constants.ts  # Constants (START, END)
├── tests/            # Test files
│   ├── flow.test.ts  # Unit tests
│   └── integration.test.ts  # Integration tests
├── examples/         # Example usage
│   └── interactive.ts  # Interactive CLI demo
└── dist/             # Build output (generated)
```

## Development Workflow

1. **Create a branch** for your feature or bugfix
2. **Write tests** for your changes
3. **Ensure tests pass**: `npm test`
4. **Check TypeScript**: `npm run lint`
5. **Build successfully**: `npm run build`
6. **Submit a pull request**

## Testing

All new features should include tests. We use Jest for testing:

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## Code Style

- Use TypeScript with strict mode
- Follow existing code patterns
- Add JSDoc comments for public APIs
- Keep functions focused and testable

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add support for async validators
fix: resolve infinite loop in validation
docs: update README examples
test: add integration tests for branching
```

## Pull Request Process

1. Update README.md if adding new features
2. Add tests for any new functionality
3. Ensure all tests pass
4. Update CHANGELOG.md (if applicable)
5. Request review from maintainers

## Questions?

Open an issue or reach out to the maintainers.

Thank you for contributing! 🎉
