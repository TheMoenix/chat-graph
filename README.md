# chat-graph

A conversational flow engine with two-phase nodes (action + validation) and support for both JSON configuration and function-based definitions.

## Features

- 🎯 **Two-Phase Node Model**: Every node executes an action (send message) then validates user response
- 🔄 **Recursive Flow**: Automatic progression after validation passes
- 📝 **Dual API**: JSON configuration or function-based definitions
- ✅ **Multiple Validators**: Chain multiple regex validators per node
- 🔀 **Conditional Routing**: Route based on state with conditional edges
- 🎨 **Template Interpolation**: Use `{variable}` syntax in messages
- 📦 **TypeScript First**: Full type safety and IntelliSense support

## Installation

```bash
npm install chat-graph
```

## Quick Start

```typescript
import { Flow, START, END } from "chat-graph";

const flow = new Flow("onboarding", "User Onboarding");

flow
  .addNode("greet", {
    action: { message: "Hi! What's your name?" },
    validate: { regex: "\\w+", errorMessage: "Enter a valid name" },
    targetField: "name",
  })
  .addNode("farewell", {
    action: { message: "Nice to meet you, {name}!" },
  })
  .addEdge(START, "greet")
  .addEdge("greet", "farewell")
  .addEdge("farewell", END);

// Execute the flow
let state = { __currentNodeId: "", __flowId: "onboarding" };

const result = await flow.compile(state, {
  type: "user_message",
  payload: "John",
});

console.log(result.messages); // ["Nice to meet you, John!"]
```

## API Reference

### Flow

The main class for creating conversational flows.

#### `new Flow(id: string, name?: string)`

Creates a new flow instance.

```typescript
const flow = new Flow("my-flow", "My Flow");
```

#### `addNode(id: string, config: NodeConfig)`

Adds a node to the flow. Nodes have two phases:

1. **Action Phase**: Sends a message or performs logic
2. **Validation Phase**: Validates user response (optional)

**JSON Configuration:**

```typescript
flow.addNode("askEmail", {
  action: { message: "What's your email?" },
  validate: {
    regex: "^\\S+@\\S+\\.\\S+$",
    errorMessage: "Invalid email format",
  },
  targetField: "email",
});
```

**Multiple Validators:**

```typescript
flow.addNode("askName", {
  action: { message: "What's your name?" },
  validate: [
    { regex: "\\w+", errorMessage: "Name is required" },
    { regex: ".{2,}", errorMessage: "Name must be 2+ characters" },
  ],
  targetField: "name",
});
```

**Function-Based:**

```typescript
flow.addNode("process", async (state, event) => ({
  messages: ["Processing..."],
  updates: { processed: true },
}));
```

#### `addEdge(from: string, to: string)`

Adds a directed edge between nodes.

```typescript
flow.addEdge(START, "greet");
flow.addEdge("greet", "askEmail");
flow.addEdge("askEmail", END);
```

#### `addConditionalEdge(from: string, router: (state: State) => string)`

Adds conditional routing based on state.

```typescript
flow.addConditionalEdge("checkAge", (state) =>
  state.age >= 18 ? "adult" : "minor"
);
```

#### `compile(state: State, event: ChatEvent): Promise<StepResult>`

Executes the flow recursively until waiting for user input.

```typescript
const result = await flow.compile(state, {
  type: "user_message",
  payload: "user input",
});
```

### Types

```typescript
interface State {
  [key: string]: any;
  __currentNodeId?: string;
  __flowId?: string;
  __isActionTaken?: boolean;
  __isResponseValid?: boolean;
}

interface ChatEvent {
  type: "user_message" | "system_event";
  payload: any;
}

interface StepResult {
  state: State;
  messages: string[];
  done: boolean;
}
```

### Constants

```typescript
import { START, END } from "chat-graph";

flow.addEdge(START, "firstNode");
flow.addEdge("lastNode", END);
```

## Examples

### Age Verification Flow

```typescript
const flow = new Flow("age-check");

flow
  .addNode("askAge", {
    action: { message: "How old are you?" },
    validate: { regex: "^\\d+$", errorMessage: "Enter a number" },
    targetField: "age",
  })
  .addNode("convertAge", (state) => ({
    messages: [],
    updates: { age: parseInt(state.age) },
  }))
  .addNode("adult", {
    action: { message: "Welcome! You're {age}." },
  })
  .addNode("minor", {
    action: { message: "Sorry, must be 18+." },
  })
  .addEdge(START, "askAge")
  .addEdge("askAge", "convertAge")
  .addConditionalEdge("convertAge", (state) =>
    state.age >= 18 ? "adult" : "minor"
  )
  .addEdge("adult", END)
  .addEdge("minor", END);
```

### Custom Validation

```typescript
flow.addNode("customValidate", {
  action: { message: "Enter your code:" },
  validate: async (state, event) => {
    const isValid = await checkCode(event.payload);
    return {
      isValid,
      errorMessage: isValid ? undefined : "Invalid code",
      updates: isValid ? { code: event.payload } : {},
    };
  },
});
```

## Development

```bash
# Install dependencies
npm install

# Run example
npm run example

# Run tests
npm test

# Build
npm run build
```

## License

MIT © TheMoenix
