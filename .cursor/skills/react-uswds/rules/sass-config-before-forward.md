---
title: Put @use "uswds-core" with() above @forward 'uswds'
impact: MEDIUM
impactDescription: ensures theme settings are applied
tags: sass, uswds-core, forward, theme, entry-point
---

## Put @use "uswds-core" with() above @forward 'uswds'

In your Sass entry point, the USWDS settings configuration must appear **above** `@forward 'uswds'`. Use a single `@use "uswds-core" with (...)"` with the variables you want to override. If the config is below the forward or in the wrong order, settings may be ignored or you may see "This module was already loaded, so it can't be configured using with" errors.

**Incorrect (forward before config):**

```scss
@forward 'uswds';
@use "uswds-core" with ($theme-banner-background-color: "ink");
```

**Incorrect (config after forward in same file):**

```scss
@forward 'uswds';
@use "uswds-core" with ($theme-color-primary: "blue-60v");
```

**Correct (config first, then forward):**

```scss
@use "uswds-core" with (
  $theme-banner-background-color: "ink",
  $theme-site-margins-width: 4,
);
@forward 'uswds';
```

**Correct (theme in separate file, forwarded before uswds):**

```scss
/* _uswds-theme.scss */
@use "uswds-core" with ($theme-show-compile-warnings: false);

/* styles.scss */
@forward 'uswds-theme';
@forward 'uswds';
```

**Note:** See [Settings](https://designsystem.digital.gov/documentation/settings/) and [references/tokens-and-settings.md](../references/tokens-and-settings.md).
