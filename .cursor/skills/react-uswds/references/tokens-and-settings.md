# USWDS Tokens and Settings (Sass)

Reference for configuring USWDS theme in React web projects via Sass. Full tables: [designsystem.digital.gov/documentation/settings/](https://designsystem.digital.gov/documentation/settings/).

## Table of contents

1. [Configuration rule and order](#configuration-rule-and-order)
2. [Where to put config](#where-to-put-config)
3. [Theme variable families](#theme-variable-families)
4. [Common settings](#common-settings)

---

## Configuration rule and order

- **Rule:** `@use "uswds-core" with ($theme-*: ...);`
- **Order:** This `@use` must appear **above** `@forward 'uswds'` in your Sass entry point. Otherwise settings are ignored or cause "module already loaded" errors.

**Example (in entry point):**

```scss
@use "uswds-core" with (
  $theme-color-primary: "blue-60v",
  $theme-site-margins-width: 4,
  $theme-banner-background-color: "ink",
  $theme-banner-link-color: "primary-light",
);
@forward 'uswds';
```

**Example (separate theme file):**

```scss
/* _uswds-theme.scss */
@use "uswds-core" with (
  $theme-show-compile-warnings: false,
  $theme-banner-background-color: "base-darkest",
);

/* styles.scss */
@forward 'uswds-theme';
@forward 'uswds';
```

---

## Theme variable families

- **Color:** `$theme-color-primary`, `$theme-color-primary-light`, `$theme-color-base`, `$theme-color-base-ink`, `$theme-color-error`, `$theme-color-success`, etc. Values are **token names** (e.g. `"blue-60v"`, `"ink"`), not hex.
- **Spacing/layout:** `$theme-site-margins-width`, `$theme-site-margins-mobile-width`, `$theme-grid-container-max-width`, `$theme-column-gap-*`. Values use **spacing/breakpoint tokens** (e.g. `4`, `"desktop"`).
- **Typography:** `$theme-font-role-body`, `$theme-body-font-size`, `$theme-h1-font-size`, `$theme-type-scale-*`, etc.
- **Component overrides:** e.g. `$theme-button-border-radius`, `$theme-card-border-color`, `$theme-alert-bar-width`. See Settings page for full list.

---

## Common settings

| Variable | Example value | Notes |
|----------|---------------|--------|
| `$theme-color-primary` | `"blue-60v"` | Primary brand color token |
| `$theme-color-base-ink` | `"gray-90"` | Body text color |
| `$theme-body-background-color` | `"white"` | Page background |
| `$theme-site-margins-width` | `4` | Outer margin (units) |
| `$theme-focus-color` | `"blue-40v"` | Focus outline color |
| `$theme-banner-background-color` | `"base-lightest"` or `"ink"` | Banner background |
| `$theme-namespace` | `(grid: (namespace: "custom-grid-"))` | Map; dot notation in docs |

**Settings maps:** Include only keys you change. Example:

```scss
@use "uswds-core" with (
  $background-color-settings: (focus: true, hover: false)
);
```

Use design token names from [Design tokens](https://designsystem.digital.gov/design-tokens/) and [Settings](https://designsystem.digital.gov/documentation/settings/); avoid raw hex or px in theme config.
