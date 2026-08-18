# AIMZ Egypt Mobile Design System

The user's AIMZ brand brief overrides generic sports-palette recommendations. This is the implementation source of truth for every app screen.

## Direction

- Dark navy, clean, energetic, and information-dense without feeling cramped.
- Scores and live status carry the strongest visual hierarchy.
- Flat touch-first surfaces; no decorative glass effects or layout-shifting animations.
- Subtle 160–240ms opacity/color feedback. Respect reduced motion.
- English first, with copy centralized for future Arabic and RTL support.

## Tokens

| Role | Value |
| --- | --- |
| Primary navy | `#16225A` |
| Deep navy | `#0F1A45` |
| App background | `#09112F` |
| Accent blue | `#3D9BE9` |
| Light blue | `#6FC5F0` |
| Primary text | `#FFFFFF` |
| Secondary text | `#C9D4F2` |
| Muted text | `#97A6D1` |
| Live | `#22C55E` |
| Warning | `#F59E0B` |
| Error | `#EF4444` |

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
- Confirm dark-mode text contrast, safe-area clearance, and that keyboard/scroll content is not obscured.
- Confirm reduced motion, retryable error states, offline messaging, empty states, and destructive confirmations.
- Replace placeholder branding only with official AIMZ assets, preserving proportions and clear space.
