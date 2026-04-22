---
title: Match @uswds/uswds version to react-uswds
impact: MEDIUM
impactDescription: avoids markup/CSS mismatch and broken styles
tags: version, uswds, react-uswds, peer dependency
---

## Match @uswds/uswds version to react-uswds

Use the **same major/minor** **@uswds/uswds** version that the installed **@trussworks/react-uswds** version was built with. Check the react-uswds repo `package.json` (e.g. devDependency or peer dependency on `@uswds/uswds`). A mismatch can cause class names, structure, or token output to differ and break layout or components.

**Incorrect (mismatched versions):**

```json
{
  "dependencies": {
    "@trussworks/react-uswds": "^3.0.0",
    "@uswds/uswds": "^3.9.0"
  }
}
```

(If react-uswds 3.x was built against USWDS 3.6.x, using 3.9.x may be acceptable for patch/minor; confirm with repo. Using USWDS 2.x with react-uswds 3.x is wrong.)

**Correct (aligned versions):**

```json
{
  "dependencies": {
    "@trussworks/react-uswds": "^3.0.0",
    "@uswds/uswds": "^3.6.0"
  }
}
```

Verify against [trussworks/react-uswds](https://github.com/trussworks/react-uswds) package.json and release notes. After upgrading either package, re-check peer/optional dependencies and test components in Storybook or your app.

**Note:** See [references/react-uswds-usage.md](../references/react-uswds-usage.md) for version alignment guidance.
