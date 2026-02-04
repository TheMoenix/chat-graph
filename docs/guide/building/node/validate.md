# Validate

The part of the node that handle user input.
It decides whether to accept the input and advance the graph, or reject it and ask the user again.
It also defines where to store the accepted answer in state by `answerKey`.
This only can be used with nodes that expect user input (i.e., `autoAdvance` set to false).

## Two Forms

- Function: `(state, event) => ({ isValid, state?, errorMessage? })`
- Rules object: `{ rules: [{ regex, errorMessage }], answerKey?: string }`

## Examples

```typescript
// Function-based validation
{
  id: 'age',
  action: { message: 'Enter age:' },
  validate: (s, e) => {
    const n = Number(e.user_message);
    if (!Number.isFinite(n) || n < 0) return { isValid: false, errorMessage: 'Enter a valid age' };
    else if (n > 120) return { isValid: false, errorMessage: 'Age must be <= 120' };
    return { isValid: true, state: { age: n } };
  },
}

// Rules-based validation (regex)
{
  id: 'age',
  action: { message: 'Your age?' },
  validate: {
    rules: [
      { regex: "^\d+$", errorMessage: 'Enter a number for age' },
      { regex: "^(?:1[01][0-9]|120|[1-9]?[0-9])$", errorMessage: 'Enter an age between 0 and 120' }
    ],
    answerKey: 'age' // the accepted age will be stored in state.age
  },
}
```

Validation does not enforce schema at runtime — add checks you need.
