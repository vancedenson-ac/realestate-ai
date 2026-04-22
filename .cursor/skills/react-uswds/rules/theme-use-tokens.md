---
title: Use USWDS design tokens and theme settings
impact: HIGH
impactDescription: keeps design consistent and themable
tags: theme, tokens, sass, uswds-core, design-tokens
---

## Use USWDS design tokens and theme settings

Use USWDS design tokens and `$theme-*` Sass settings for colors, spacing, typography, and component overrides. Do not hardcode hex colors or raw px/rem values for USWDS-derived styles so that theming and consistency are preserved.

**Incorrect (hardcoded values):**

```scss
.my-banner {
  background-color: #1b1b1b;
  padding: 1rem 1.5rem;
}
.my-button {
  border-radius: 4px;
}
```

**Correct (theme tokens / settings):**

```scss
@use "uswds-core" with (
  $theme-banner-background-color: "ink",
  $theme-button-border-radius: "md",
);
@forward 'uswds';

// In custom styles, use USWDS functions/mixins or token-based utilities
.usa-banner { /* uses theme via USWDS */ }
```

**Correct (custom Sass using tokens):**

Use USWDS functions (e.g. `color()`, `units()`) and theme tokens in your Sass after loading USWDS; see [references/tokens-and-settings.md](../references/tokens-and-settings.md).

**Note:** Token names and settings come from [Design tokens](https://designsystem.digital.gov/design-tokens/) and [Settings](https://designsystem.digital.gov/documentation/settings/). Values in `@use "uswds-core" with()` must be valid token names or types listed in the settings tables.
