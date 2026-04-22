---
title: Preserve semantic markup and ARIA when wrapping components
impact: HIGH
impactDescription: WCAG 2.0 AA and Section 508 alignment
tags: accessibility, semantics, ARIA, heading, button, focus
---

## Preserve semantic markup and ARIA when wrapping components

When wrapping or extending **@trussworks/react-uswds** components (or USWDS-style markup), preserve semantic structure and ARIA. Use the correct element for the role (e.g. `button` for actions, heading levels for document structure), forward or set ARIA attributes where needed, and do not remove or break focus behavior. USWDS targets WCAG 2.0 AA and Section 508.

**Incorrect (generic div for button):**

```tsx
<div className="usa-button usa-button--primary" onClick={onClick}>
  Submit
</div>
```

**Correct (use library Button or native button):**

```tsx
<Button type="button" onClick={onClick}>Submit</Button>
```

**Incorrect (skipping heading level or hiding heading from screen readers):**

```tsx
<Alert type="warning">
  <p className="usa-alert__heading" role="heading" aria-level={4}>Warning</p>
  <span>{message}</span>
</Alert>
```

**Correct (use component props for heading level):**

```tsx
<Alert type="warning" heading="Warning" headingLevel="h4">
  {message}
</Alert>
```

**Incorrect (removing focus outline):**

```scss
.usa-button:focus {
  outline: none;
}
```

**Correct (use USWDS focus token or leave default):**

Configure focus via `$theme-focus-*` if needed; do not remove visible focus for keyboard users.

**Note:** Use semantic HTML (e.g. `nav`, `main`, `header`, `button`, `a`) and expose state/roles via ARIA when necessary. See [USWDS Accessibility](https://designsystem.digital.gov/documentation/accessibility/).
