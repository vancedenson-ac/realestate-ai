---
title: Do not import USWDS JavaScript when using @trussworks/react-uswds
impact: HIGH
impactDescription: avoids double initialization and broken behavior
tags: react-uswds, uswds, javascript, ComboBox, no-js
---

## Do not import USWDS JavaScript when using @trussworks/react-uswds

When the app uses **@trussworks/react-uswds**, do **not** load the USWDS JavaScript bundle (e.g. `import 'uswds'` or the USWDS JS entry). React USWDS components that need JS (e.g. ComboBox, Modal, Accordion) implement behavior in React; loading USWDS JS can attach a second set of behaviors to the same DOM and cause double init, focus traps, or other bugs.

**Incorrect (USWDS JS + React USWDS):**

```tsx
// App.tsx or main entry
import 'uswds/js/uswds';  // or similar USWDS JS entry
import '@trussworks/react-uswds/lib/index.css';
```

```html
<!-- Or in HTML -->
<script src="node_modules/uswds/dist/js/uswds.min.js"></script>
```

**Correct (React USWDS only; CSS only from USWDS):**

```tsx
// Load only USWDS CSS (via your Sass build or the library CSS)
import '@trussworks/react-uswds/lib/index.css';
// If you compile USWDS from Sass, your entry has @use/@forward and no USWDS JS
```

**Note:** Use **@trussworks/react-uswds** components for interactive behavior. For custom components that rely on USWDS JS (e.g. a one-off that isn’t in react-uswds), consider reimplementing the behavior in React or using the library’s nearest equivalent.
