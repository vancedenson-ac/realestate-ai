---
name: react-uswds
description: Build or modify React (web) applications using the U.S. Web Design System (USWDS). Use when (1) implementing UI with @trussworks/react-uswds or USWDS CSS/JS in a React app, (2) configuring USWDS theme settings (Sass @use "uswds-core" with()), (3) choosing or styling USWDS components (Button, Alert, Card, form controls, Modal, Table, etc.), (4) theming or customizing design tokens (color, spacing, typography), or (5) ensuring accessibility and government-style consistency on React web screens.
---

# React USWDS

Build React (web) UIs that follow the [U.S. Web Design System (USWDS)](https://designsystem.digital.gov) using **@trussworks/react-uswds** (React components for USWDS 3.0) and/or **@uswds/uswds** (Sass/CSS/JS). Token and component behavior align with the official system and with [trussworks/react-uswds](https://github.com/trussworks/react-uswds).

## Official USWDS references

- **Design system site**: [designsystem.digital.gov](https://designsystem.digital.gov) — components, guidance, examples.
- **GitHub (source)**: [github.com/uswds/uswds](https://github.com/uswds/uswds) — Sass/CSS/JS, packages, tokens.
- **Design tokens**: [designsystem.digital.gov/design-tokens/](https://designsystem.digital.gov/design-tokens/) — color, spacing, typesetting, shadow, z-index.
- **Settings (theme)**: [designsystem.digital.gov/documentation/settings/](https://designsystem.digital.gov/documentation/settings/) — `$theme-*` Sass variables, `@use "uswds-core" with()`.
- **Components overview**: [designsystem.digital.gov/components/overview/](https://designsystem.digital.gov/components/overview/) — full component list (~47).
- **React USWDS (Trussworks)**: [github.com/trussworks/react-uswds](https://github.com/trussworks/react-uswds) — React components; [Storybook](https://trussworks.github.io/react-uswds/); npm: `@trussworks/react-uswds`.

For a curated link list and when to use each, see [references/official-links.md](references/official-links.md).

## When this skill applies

- App uses or will use **@trussworks/react-uswds** and/or **@uswds/uswds** in a React (web) project.
- Tasks involve **theme/tokens** (Sass settings, design tokens), **component selection** (Button, Alert, Card, Accordion, form controls, Modal, Table, Breadcrumb, Pagination, etc.), or **integration** (CSS import, peer deps, version alignment).

## Core conventions

- **Theme (Sass)**: Configure USWDS via `@use "uswds-core" with ($theme-*: ...)` in your Sass entry point, **above** `@forward 'uswds'`. Use design tokens for values, not raw hex or px. See [references/tokens-and-settings.md](references/tokens-and-settings.md).
- **React components**: Prefer **@trussworks/react-uswds** exports (e.g. `Alert`, `Button`, `Card`) when using React. Import library CSS: `@import '~@trussworks/react-uswds/lib/index.css';` (and USWDS styles if not already present). See [references/react-uswds-usage.md](references/react-uswds-usage.md).
- **No USWDS JS with react-uswds**: Do not import USWDS JavaScript (e.g. `import 'uswds'`) when using @trussworks/react-uswds — components that need JS (e.g. ComboBox) initialize twice otherwise.
- **Version alignment**: Use the same major/minor **@uswds/uswds** version that the installed **@trussworks/react-uswds** version was built with (see react-uswds package.json devDependency) to avoid markup/CSS mismatch.
- **Layout and spacing**: Do not use a universal `* { margin: 0; padding: 0 }` reset; it breaks USWDS spacing and alignment. Use `usa-section`, `GridContainer`, and USWDS margin/padding utility classes for consistent layout. See [references/layout-and-spacing.md](references/layout-and-spacing.md).

## Quick reference

| Need | Use |
|------|-----|
| React components | `@trussworks/react-uswds` — `Alert`, `Button`, `Card`, `Accordion`, form controls, `Modal`, `Table`, etc. |
| USWDS CSS/tokens | `@uswds/uswds` — Sass entry with `@use "uswds-core" with()"; @forward 'uswds';` |
| Theme (colors, spacing) | Sass: `$theme-color-primary`, `$theme-site-margins-width`, etc. in `@use "uswds-core" with(...)` |
| Component demos | [Storybook](https://trussworks.github.io/react-uswds/) |
| Accessibility | USWDS targets WCAG 2.0 AA / Section 508; use semantic markup and preserve ARIA when wrapping. |

## Rules

| Rule | Impact | Description |
|------|--------|-------------|
| [theme-use-tokens](rules/theme-use-tokens.md) | HIGH | Use USWDS design tokens and $theme-* settings; never hardcode colors/spacing. |
| [components-library](rules/components-library.md) | HIGH | Prefer @trussworks/react-uswds components over custom markup when using React. |
| [no-uswds-js-with-react-uswds](rules/no-uswds-js-with-react-uswds.md) | HIGH | Do not import USWDS JS when using @trussworks/react-uswds. |
| [sass-config-before-forward](rules/sass-config-before-forward.md) | MEDIUM | Put @use "uswds-core" with() above @forward 'uswds' in Sass entry. |
| [accessibility-semantics](rules/accessibility-semantics.md) | HIGH | Preserve semantic markup, ARIA, and focus behavior when wrapping components. |
| [css-import-react-uswds](rules/css-import-react-uswds.md) | MEDIUM | Import @trussworks/react-uswds CSS and USWDS styles as documented. |
| [version-match-uswds](rules/version-match-uswds.md) | MEDIUM | Match @uswds/uswds version to react-uswds peer/devDependency. |

For full rule text and incorrect/correct examples, see each rule file under `rules/`. For a single compiled guide for agents/LLMs, see [AGENTS.md](AGENTS.md).

## Resources

- **Agent guide**: [AGENTS.md](AGENTS.md) — compiled rules, refs, quick reference for automation.
- **Official links**: [references/official-links.md](references/official-links.md) — when to use each doc/site.
- **Tokens and settings**: [references/tokens-and-settings.md](references/tokens-and-settings.md) — Sass theme variables and structure.
- **React USWDS usage**: [references/react-uswds-usage.md](references/react-uswds-usage.md) — install, CSS, peer deps, version.
- **Layout and spacing**: [references/layout-and-spacing.md](references/layout-and-spacing.md) — margins, padding, page structure, cards, headers, error blocks.
