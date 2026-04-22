---
title: Prefer @trussworks/react-uswds components
impact: HIGH
impactDescription: consistency, accessibility, and alignment with USWDS
tags: react-uswds, components, Button, Alert, Card, trussworks
---

## Prefer @trussworks/react-uswds components

When building React (web) UIs that follow USWDS, prefer components from **@trussworks/react-uswds** (e.g. `Button`, `Alert`, `Card`, `Accordion`, form controls, `Modal`, `Table`) over custom markup that reimplements USWDS patterns. Use component props for variants and content; avoid wrappers that replace or duplicate USWDS structure.

**Incorrect (custom markup duplicating USWDS):**

```tsx
<button className="usa-button usa-button--primary" style={{ borderRadius: 6 }}>
  Submit
</button>
```

**Correct (library component):**

```tsx
import { Button } from '@trussworks/react-uswds';

<Button type="button" onClick={onSubmit}>
  Submit
</Button>
```

**Incorrect (wrapper that reimplements structure):**

```tsx
function MyAlert({ children }) {
  return (
    <div className="usa-alert">
      <div className="usa-alert__body"><h4 className="usa-alert__heading">Alert</h4>{children}</div>
    </div>
  );
}
```

**Correct (library component with props):**

```tsx
import { Alert } from '@trussworks/react-uswds';

<Alert type="info" heading="Alert" headingLevel="h4">
  {children}
</Alert>
```

**Note:** Use [Storybook](https://trussworks.github.io/react-uswds/) for component APIs and examples. For layout/utilities not in the library, use USWDS CSS classes or compile USWDS Sass with your theme.
