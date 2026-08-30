# Validate

The part of the node that handle user input.
It decides whether to accept the input and advance the graph, or reject it and ask the user again.
It also defines where to store the accepted answer in state by `answerKey`.
This only can be used with nodes that expect user input (i.e., `autoAdvance` set to false).

## Two Forms

- Function: `(state, event) => ({ isValid, state?, errorMessage? })`
- Rules object: `{ rules: [{ regex, errorMessage }], answerKey?: string }`

`rules` is an **array**, evaluated in order; the first failing rule's `errorMessage` is
emitted and the node re-asks. Rule patterns are strings passed to `new RegExp()`, so
backslashes must be escaped: `'^\\d+$'`, not `'^\d+$'` (which is just `^d+$`).

## Examples

```typescript
// Function-based validation
{
  id: 'age',
  action: { message: 'Enter age:' },
  validate: (s, e) => {
    const n = Number(e.userMessage);
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
      { regex: '^\\d+$', errorMessage: 'Enter a number for age' },
      { regex: '^(?:1[01][0-9]|120|[1-9]?[0-9])$', errorMessage: 'Enter an age between 0 and 120' }
    ],
    answerKey: 'age' // the accepted age will be stored in state.age
  },
}
```

## Reading structured input

Validators receive the whole event, so a function validator can read `event.payload` — the
stable id behind a tapped button, a selected row, coordinates:

```typescript
{
  id: 'menu',
  action: { message: 'What do you need?' },
  validate: (s, e) => ({
    isValid: true,
    state: { choice: String(e.payload?.buttonId ?? '') },
  }),
}
```

`payload` lasts one turn only, so write anything you need later into state. See
[Turns](../../turns).

Validation does not enforce schema at runtime — add checks you need.
