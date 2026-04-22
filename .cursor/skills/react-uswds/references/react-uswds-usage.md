# @trussworks/react-uswds Usage

Guidance for installing and using the React USWDS library in a React web app.

## Table of contents

1. [Install and peer dependencies](#install-and-peer-dependencies)
2. [CSS import](#css-import)
3. [Using components](#using-components)
4. [Version alignment with USWDS](#version-alignment-with-uswds)

---

## Install and peer dependencies

- **Package:** `@trussworks/react-uswds`
- **Peer dependencies:** Typically `react`, `react-dom`; check package.json for required versions.
- **USWDS CSS:** You need USWDS styles. Either:
  - Use the library’s bundled CSS: `@import '~@trussworks/react-uswds/lib/index.css';` (and ensure USWDS Sass/CSS is available as expected by that bundle), or
  - Compile USWDS yourself with `@uswds/uswds` and import that compiled CSS plus any react-uswds overrides the library documents.

Check the [react-uswds README](https://github.com/trussworks/react-uswds) and [Storybook](https://trussworks.github.io/react-uswds/) for the current recommended setup.

---

## CSS import

- Import the library CSS **once** (e.g. in root Sass/JS entry):  
  `@import '~@trussworks/react-uswds/lib/index.css';`
- If you compile USWDS from Sass, your `@use "uswds-core" with()"` and `@forward 'uswds'` must run **before** or be combined in a way that the final CSS includes USWDS base styles. Do not rely on react-uswds CSS alone if the docs require full USWDS.
- Order: theme config → USWDS → react-uswds CSS (or as documented by Trussworks).

---

## Using components

- **Import by name:** `import { Button, Alert, Card, Modal } from '@trussworks/react-uswds';`
- **Props:** Follow [Storybook](https://trussworks.github.io/react-uswds/) and component prop types (e.g. `type`, `children`, `heading`, `variants`).
- **Semantics:** Use components as intended (e.g. `Button` as `button`, `Alert` with proper heading level). Preserve or forward ARIA and semantic markup when wrapping.

---

## Version alignment with USWDS

- **@trussworks/react-uswds** is built against a specific **@uswds/uswds** (or USWDS) version (see repo `package.json` devDependency).
- Use the **same major/minor** USWDS version in your app as the one react-uswds was built with to avoid markup/CSS mismatches.
- After upgrading either package, re-check peer/optional dependency notes and Storybook.
