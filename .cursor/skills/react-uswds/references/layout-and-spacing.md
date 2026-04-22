# Layout and Spacing (React USWDS)

Guidance for consistent margins, padding, and alignment when building React UIs with USWDS and @trussworks/react-uswds.

## Do not reset USWDS spacing

- **Avoid** a universal reset that removes all margins and padding: `* { margin: 0; padding: 0 }`. USWDS components and utility classes (e.g. `margin-top-2`, `padding-x-3`) rely on their own defaults. A global reset makes layouts look cramped and misaligned.
- **Do** use `box-sizing: border-box` (e.g. on `html` with `* { box-sizing: inherit }`) so padding and borders don’t break grid calculations.

## Page structure

- **Main content:** Use `usa-section` for vertical rhythm and add horizontal padding with USWDS utilities, e.g. `padding-x-2` and `desktop:padding-x-4` (or your theme’s site margins).
- **Content width:** Use `GridContainer` as the main content wrapper so max-width and horizontal padding follow the design system.
- **Headings and blocks:** Use USWDS spacing utilities (`margin-bottom-2`, `margin-top-4`, etc.) for consistent vertical rhythm between title, description, and cards.

## Cards and content blocks

- **Card padding:** Apply explicit padding to `CardHeader` and `CardBody` when needed (e.g. `padding-x-3 padding-top-3 padding-bottom-2` on header, `padding-x-3 padding-bottom-3` on body) for a clean, consistent look.
- **Card headings:** Use `font-heading-md` and `margin-0` on card headings so they align with the card’s padding and don’t show unwanted list markers or bullets (override `.usa-card__heading::before` in CSS if the default accent doesn’t fit the design).
- **Grid gap:** Use `gap={4}` (or equivalent) on the grid row that contains cards to create clear separation between columns.

## Headers and navigation

- **Alignment:** Use flexbox with `flex-align-center` on the header row so logo, nav links, and user controls share a single baseline.
- **Spacing:** Use `gap-2` or `gap-3` between nav items and `padding-left` + `border-left` to separate the user section from the main nav.
- **Compact controls:** Keep dev/user switchers compact (e.g. small label, constrained select width) so the header doesn’t feel crowded.

## Error and message blocks

- **Spacing:** Add `margin-top` above and `margin-bottom` below alerts so they don’t touch adjacent form controls or buttons (e.g. `margin-top-3` above the alert, `margin-top-3` on the button wrapper below).
- **Readability:** For API error messages that may be JSON, parse and show a short user-friendly summary when possible; display longer or raw messages in a monospace, word-wrapping block so they stay readable.

## Quick reference

| Need              | Use |
|-------------------|-----|
| Main content pad  | `usa-section padding-y-4 padding-x-2 desktop:padding-x-4` |
| Section spacing   | `margin-top-4`, `margin-bottom-2` |
| Card inner space  | `padding-x-3 padding-top-3 padding-bottom-2` (header), same padding-x/bottom on body |
| Grid column gap   | `<Grid row gap={4}>` or `gap` utility |
| No global reset   | Omit `* { margin: 0; padding: 0 }`; use box-sizing only |
