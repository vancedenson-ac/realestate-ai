# React USWDS — Agent Guide

**Version 1.0**  
Aligned with [USWDS](https://designsystem.digital.gov) and **@trussworks/react-uswds**  
January 2026

> **Note:**  
> This document is for agents and LLMs building or modifying React (web) UIs that use the U.S. Web Design System (USWDS) and/or @trussworks/react-uswds. Guidance is optimized for automation and consistency.

---

## Abstract

Guide for building and maintaining React web applications that follow the [U.S. Web Design System (USWDS)](https://designsystem.digital.gov) using **@trussworks/react-uswds** and/or USWDS Sass/CSS. Covers theme configuration (Sass `@use "uswds-core" with()`), component selection, CSS import, version alignment, and accessibility. Contains 7 rules across theme, components, integration, and accessibility.

---

## Table of contents

1. [Official USWDS references](#1-official-uswds-references)
2. [Implementation notes (React web)](#2-implementation-notes-react-web)
3. [Quick reference](#3-quick-reference)
4. [Rules](#4-rules)
   - 4.1 [Theme and Sass](#41-theme-and-sass)
   - 4.2 [Components and CSS](#42-components-and-css)
   - 4.3 [Accessibility](#43-accessibility)
   - 4.4 [Integration](#44-integration)

---

## 1. Official USWDS references

| Resource | URL | Use when |
|----------|-----|----------|
| Design system site | [designsystem.digital.gov](https://designsystem.digital.gov) | Components, guidance, examples |
| GitHub (source) | [github.com/uswds/uswds](https://github.com/uswds/uswds) | Sass/CSS/JS, packages, tokens |
| Design tokens | [designsystem.digital.gov/design-tokens/](https://designsystem.digital.gov/design-tokens/) | Token philosophy, keys vs values |
| Settings | [designsystem.digital.gov/documentation/settings/](https://designsystem.digital.gov/documentation/settings/) | **$theme-*** variables, `@use "uswds-core" with()` |
| Components overview | [designsystem.digital.gov/components/overview/](https://designsystem.digital.gov/components/overview/) | Full component list (~47) |
| React USWDS (Trussworks) | [github.com/trussworks/react-uswds](https://github.com/trussworks/react-uswds) | React API, install, version |
| Storybook | [trussworks.github.io/react-uswds](https://trussworks.github.io/react-uswds/) | Component demos and props |

Detailed link list: [references/official-links.md](references/official-links.md).

---

## 2. Implementation notes (React web)

- **Theme:** Configure USWDS via a single `@use "uswds-core" with ($theme-*: ...);` in the Sass entry point **above** `@forward 'uswds'`. Use design token names (e.g. `"ink"`, `"blue-60v"`), not hex or raw px.
- **React components:** Use **@trussworks/react-uswds** (Button, Alert, Card, Accordion, form controls, Modal, Table, etc.). Import library CSS once at app entry (e.g. `@import '~@trussworks/react-uswds/lib/index.css';`).
- **No USWDS JS with react-uswds:** Do not load USWDS JavaScript when using @trussworks/react-uswds; components that need JS are implemented in React. Loading both causes double init (e.g. ComboBox, Modal).
- **Version alignment:** Use the same major/minor **@uswds/uswds** version that the installed **@trussworks/react-uswds** was built with (see repo package.json).
- **Accessibility:** USWDS targets WCAG 2.0 AA and Section 508. Use semantic markup and preserve ARIA when wrapping components.

Tokens and settings: [references/tokens-and-settings.md](references/tokens-and-settings.md). React USWDS usage: [references/react-uswds-usage.md](references/react-uswds-usage.md).

---

## 3. Quick reference

| Need | Use |
|------|-----|
| React components | @trussworks/react-uswds — Alert, Button, Card, Accordion, form controls, Modal, Table, etc. |
| USWDS CSS/tokens | @uswds/uswds — Sass entry: `@use "uswds-core" with()"; @forward 'uswds';` |
| Theme (colors, spacing) | Sass: `$theme-color-primary`, `$theme-site-margins-width`, etc. in `@use "uswds-core" with(...)` |
| Component demos | [Storybook](https://trussworks.github.io/react-uswds/) |
| Accessibility | Semantic markup, preserve ARIA and focus; USWDS targets WCAG 2.0 AA / Section 508 |

---

## 4. Rules

### 4.1 Theme and Sass

| Rule | Impact | Description |
|------|--------|-------------|
| [theme-use-tokens](rules/theme-use-tokens.md) | HIGH | Use USWDS design tokens and $theme-* settings; never hardcode colors/spacing. |
| [sass-config-before-forward](rules/sass-config-before-forward.md) | MEDIUM | Put @use "uswds-core" with() above @forward 'uswds' in Sass entry. |

### 4.2 Components and CSS

| Rule | Impact | Description |
|------|--------|-------------|
| [components-library](rules/components-library.md) | HIGH | Prefer @trussworks/react-uswds components over custom markup. |
| [no-uswds-js-with-react-uswds](rules/no-uswds-js-with-react-uswds.md) | HIGH | Do not import USWDS JS when using @trussworks/react-uswds. |
| [css-import-react-uswds](rules/css-import-react-uswds.md) | MEDIUM | Import @trussworks/react-uswds CSS and USWDS styles as documented. |
| [version-match-uswds](rules/version-match-uswds.md) | MEDIUM | Match @uswds/uswds version to react-uswds peer/devDependency. |

### 4.3 Accessibility

| Rule | Impact | Description |
|------|--------|-------------|
| [accessibility-semantics](rules/accessibility-semantics.md) | HIGH | Preserve semantic markup, ARIA, and focus when wrapping components. |

### 4.4 Integration

- Peer dependencies: `react`, `react-dom`; check @trussworks/react-uswds package.json for required versions.
- Install @uswds/uswds at the version react-uswds expects; compile USWDS from Sass or use the library’s documented CSS setup.
- Do not load USWDS JavaScript in the app when using react-uswds.

---

For full rule text, incorrect/correct examples, and notes, open the linked rule file under `rules/`.
