---
title: Import @trussworks/react-uswds CSS and USWDS styles as documented
impact: MEDIUM
impactDescription: correct appearance and layout
tags: css, import, react-uswds, uswds
---

## Import @trussworks/react-uswds CSS and USWDS styles as documented

Import the **@trussworks/react-uswds** library CSS (and any USWDS base styles it depends on) exactly as documented by the library—typically once at app entry (e.g. root Sass/JS file). Ensure USWDS base styles are present when the library expects them (e.g. via the library’s bundled CSS or your own Sass `@forward 'uswds'`). Wrong order or missing imports cause broken layout and components.

**Incorrect (no library CSS):**

```tsx
// Only importing components; no CSS
import { Button, Alert } from '@trussworks/react-uswds';
```

**Incorrect (wrong path or duplicate imports in many files):**

```tsx
// In every component file
import '@trussworks/react-uswds/lib/index.css';
```

**Correct (single import at app entry):**

```tsx
// App.tsx or main.tsx / index.js
import '@trussworks/react-uswds/lib/index.css';
import { Button, Alert } from '@trussworks/react-uswds';
```

**When compiling USWDS from Sass:** Keep `@use "uswds-core" with()"` and `@forward 'uswds'` in your Sass entry so that the compiled CSS includes USWDS. Then import that compiled CSS (and any react-uswds CSS) in the order recommended by [references/react-uswds-usage.md](../references/react-uswds-usage.md) or the react-uswds README.

**Note:** Check the [react-uswds README](https://github.com/trussworks/react-uswds) for the current recommended CSS setup and peer dependency on USWDS.
