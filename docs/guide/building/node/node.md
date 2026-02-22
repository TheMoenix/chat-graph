# Node

A node is the building block of the graph.
It starts with a message to be sent to the user ([action](./action.md)), then either it auto-advances to the next node, or waits for user input which can be [validated](./validate.md) and used to update the state before advancing to the next node.

## Structure

Every node has four key properties:

- **`id`**: A unique identifier for the node
- **`action`**: What the node does (sends a message, updates state) — see [Action](./action.md)
- **`validate`** (optional): How to handle user input — see [Validate](./validate.md)
- **`autoAdvance`** (optional): Whether to skip waiting for user input

## Two Types of Nodes

### 1. Nodes That Wait for User Input

These nodes send a message and wait for the user to respond. The response is validated before advancing.

```typescript
{
  id: 'ask_name',
  action: { message: "What's your name?" },
  validate: {
    rules: [{ regex: '\\w+', errorMessage: 'Please enter a valid name' }],
    answerKey: 'name'
  }
}
```

### 2. Nodes That Auto-Advance

These nodes execute their action and immediately move to the next node without waiting for input.

```typescript
{
  id: 'welcome',
  action: (state) => ({
    messages: [`Welcome to our service, ${state.name}!`]
  }),
  autoAdvance: true
}
```

## Complete Examples

### Example 1: Simple Q&A Node

```typescript
{
  id: 'ask_email',
  action: { message: 'What is your email address?' },
  validate: {
    rules: [
      {
        regex: '\\S+@\\S+\\.\\S+',
        errorMessage: 'Please enter a valid email address'
      }
    ],
    answerKey: 'email'
  }
}
```

### Example 2: Dynamic Action with Function

```typescript
{
  id: 'gold_price',
  action: async (state) => {
    const price = await getCurrentGoldPrice(); // could be an API call or some logic to fetch the price
    return {
      messages: [`Hello, ${state.name}! The current gold price is $${price}.`]
    };
  },
  autoAdvance: true
}
```

### Example 3: Custom Function Validation

```typescript
{
  id: 'ask_age',
  action: { message: 'How old are you?' },
  validate: (state, event) => {
    const age = Number(event.user_message);

    if (!Number.isFinite(age) || age < 0) {
      return {
        isValid: false,
        errorMessage: 'Please enter a valid age'
      };
    }

    if (age < 18) {
      return {
        isValid: false,
        errorMessage: 'You must be 18 or older'
      };
    }

    return {
      isValid: true,
      state: { age, isAdult: true }
    };
  }
}
```

### Example 4: Multi-Step Flow

```typescript
const flow = new ChatGraph({
  id: 'user_onboarding',
  schema: UserSchema,
  nodes: [
    {
      id: 'greet',
      action: { message: "Hi! What's your name?" },
      validate: {
        rules: [{ regex: '\\w+', errorMessage: 'Enter a valid name' }],
        answerKey: 'name',
      },
    },
    {
      id: 'personalized_message',
      action: { message: 'Great to meet you, {{name}}!' },
      autoAdvance: true,
    },
    {
      id: 'ask_email',
      action: { message: 'What is your email?' },
      validate: {
        rules: [
          {
            regex: '\\S+@\\S+\\.\\S+',
            errorMessage: 'Enter a valid email',
          },
        ],
        answerKey: 'email',
      },
    },
    {
      id: 'confirmation',
      action: async (state) => {
        await sendEmail(state.email); // some async operation to send an email
        return {
          messages: [
            `Perfect! We have sent a confirmation email to ${state.email}.`,
          ],
        };
      },
      autoAdvance: true,
    },
  ],
  edges: [
    { from: START, to: 'greet' },
    { from: 'greet', to: 'personalized_message' },
    { from: 'personalized_message', to: 'ask_email' },
    { from: 'ask_email', to: 'confirmation' },
    { from: 'confirmation', to: END },
  ],
});
```

### Example 5: Complex State Updates

```typescript
{
  id: 'process_order',
  action: (state, event) => {
    const items = state.cartItems || [];
    const total = items.reduce((sum, item) => sum + item.price, 0);

    return {
      messages: [
        `Your order total is $${total.toFixed(2)}`,
        'Confirm with "yes" or "no"'
      ],
      orderTotal: total,
      orderDate: new Date().toISOString()
    };
  },
  validate: (state, event) => {
    const answer = event.user_message.toLowerCase();

    if (answer === 'yes') {
      return {
        isValid: true,
        state: { orderConfirmed: true }
      };
    } else if (answer === 'no') {
      return {
        isValid: true,
        state: { orderConfirmed: false }
      };
    }

    return {
      isValid: false,
      errorMessage: 'Please answer "yes" or "no"'
    };
  }
}
```

## Best Practices

1. **Use descriptive IDs**: Choose clear, meaningful node identifiers
2. **Keep actions focused**: Each node should do one thing well
3. **Validate thoroughly**: Don't assume user input will be in the expected format
4. **Provide clear error messages**: Help users understand what went wrong
5. **Use autoAdvance for info messages**: If no input is needed, set `autoAdvance: true`
6. **Store validated data**: Use `answerKey` or return state updates to persist user input

## See Also

- [Action](./action.md) — Deep dive into node actions
- [Validate](./validate.md) — Complete validation guide
- [Graph](../../graph.md) — How to connect nodes with edges
