# P0 Fix: React.lazy Resolves to Undefined

## Symptom
- Crash / red screen:
  - `Error: Element type is invalid. Received a promise that resolves to: undefined. Lazy element type must resolve to a class or function.`

## Observed context
- In logs, the error occurs when navigating to the live streaming route (`LiveStreamScreen`).

## Fix
P0 mitigation: import `LiveStreamScreen` eagerly (not via `React.lazy`).
This removes React.lazy’s dynamic import resolution path (which in these runs was producing an invalid resolved value).

P1 follow-up (preferred long-term): restore lazy loading once the underlying cause is identified:
- Ensure the module has a correct default export, or
- Use a `then(...)` wrapper if the screen is a named export, or
- Bypass any barrel export and import the file directly.

## Change
- Updated: App.js
  - `LiveStreamScreen` is now a normal import instead of `React.lazy(() => import(...))`

## Verification
Expected: no further occurrences of:
- `Received a promise that resolves to: undefined. Lazy element type must resolve...`
