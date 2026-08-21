# AIMZ Egypt Mobile Design System

The user's AIMZ brand brief overrides generic sports-palette recommendations. This is the implementation source of truth for every app screen.

## Direction

- Two themes, both clean, energetic, and information-dense without feeling cramped: Azure Pro in dark, Vercel remix in light.
- The app follows the device appearance by default; Settings can pin Light or Dark.
- Scores and live status carry the strongest visual hierarchy.
- Flat touch-first surfaces; no decorative glass effects or layout-shifting animations.
- Subtle 160–240ms opacity/color feedback. Respect reduced motion.
- English first, with copy centralized for future Arabic and RTL support.

## Tokens

Colour is the only thing that changes with the mode. Spacing, radii, the type
scale, touch targets, and motion are shared, and live on the `theme` export in
`mobile/src/theme/index.ts`. Colours live in `darkColors` / `lightColors` there
and reach components through `useColors` and `useThemedStyles` — never through a
module-scope constant, which would capture one mode's values forever.

| Role | Dark (Azure Pro) | Light (Vercel remix) |
| --- | --- | --- |
| App background | `#020817` | `#A6C4E8` |
| Card surface | `#020817` | `#F9FCFF` |
| Raised surface | `#1E293B` | `#E7EDF6` |
| Border | `#1E293B` | `#D8DFE9` |
| Accent | `#3B82F6` | `#101723` |
| On accent | `#0F172A` | `#FAFAFA` |
| Soft accent | `#0EA2E7` | `#1E40AF` |
| Primary text | `#F8FAFC` | `#060A12` |
| Secondary text | `#CBD5E1` | `#334155` |
| Muted text | `#94A3B8` | `#4B5563` |
| Live | `#22C55E` | `#166534` |
| Warning | `#F59E0B` | `#92400E` |
| Error | `#EF4444` | `#B91C1C` |
| Destructive fill / ink | `#7F1D1D` / `#F8FAFC` | `#E7000A` / `#FFFFFF` |
| Leader row / accent | `#4A3A12` / `#FCAF45` | `#FEF3C7` / `#A16207` |

Dark cards deliberately share the app background and separate by their border;
light cards are near-white on saturated blue. Both come straight from the
published themes.

Where a role has no shadcn token — live, warning, and the leader gold — the AIMZ
hue is kept and darkened for light mode until it clears WCAG AA against that blue
background. The pitch greens in `FormationPitch` stay fixed in both modes.

Use the magenta → orange → yellow brand gradient only for rare brand moments, never as a score or validation state.

## Component rules

- Use the system sans-serif until AIMZ supplies its official font.
- Scores use tabular numerals, bold weight, and 36–48pt sizing.
- Maintain a 4/8pt spacing rhythm and tokenized radii.
- Every tappable control is at least 44×44pt on iOS and has pressed feedback.
- Use one outlined Ionicons family; never use emoji as interface icons.
- Form fields have persistent labels, inline errors, password-manager-compatible semantics, and visible disabled/loading states.
- Bottom navigation contains at most five destinations and always respects the safe area.
- Do not use color as the only indicator: accompany live, card, error, and selected states with text or iconography.

## Required QA

- Test 375px and large-phone widths, portrait and landscape, largest Dynamic Type, and VoiceOver ordering.
- Confirm text contrast in both themes, safe-area clearance, and that keyboard/scroll content is not obscured.
- Confirm the Settings appearance control and that Match system follows a live device appearance change.
- Confirm reduced motion, retryable error states, offline messaging, empty states, and destructive confirmations.
- Replace placeholder branding only with official AIMZ assets, preserving proportions and clear space.
