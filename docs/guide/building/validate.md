# Validate

Check user input and optionally write values into state.

## Two Forms

- Function: `(state, event) => ({ isValid, state?, errorMessage? })`
- Rules object: `{ rules: [{ regex, errorMessage }], targetField?: string }`

## Examples

```typescript
// Function-based validation
{
  id: 'age',
  action: { message: 'Enter age:' },
  validate: (s, e) => {
    const n = Number(e.user_message);
    if (!Number.isFinite(n) || n < 0) return { isValid: false, errorMessage: 'Enter a valid age' };
    return { isValid: true, state: { age: n } };
  },
}

// Rules-based validation (regex)
{
  id: 'name',
  action: { message: 'Your name?' },
  validate: { rules: [{ regex: "^\\w+$", errorMessage: 'Use letters/numbers' }], targetField: 'name' },
}
```

Validation does not enforce schema at runtime — add checks you need.
