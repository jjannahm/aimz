# AIMZ branding assets

The official AIMZ artwork is prepared for each supported surface:

- `logo.png` preserves the supplied artwork for in-app use.
- `icon.png` is the 1024×1024 native app icon.
- `icon-192.png`, `icon-512.png`, and `favicon.png` support the website and installed web app.
- `adaptive-icon-foreground.png` is the mark on transparency, inset to 55% of a
  1024px canvas. Android masks an adaptive icon to a circle or squircle and
  clips whatever falls outside roughly the middle 60%, so `icon.png` cannot be
  used there directly — its mark runs to the edges and would lose the `z`. The
  navy field comes from `backgroundColor` (`#283662`, sampled from `icon.png`)
  in `android.adaptiveIcon`, so the two can never disagree at the seam.
- `splash-icon.png` is the same mark at 84% of a 1024px canvas, for the
  `expo-splash-screen` plugin. The splash needs its own, looser inset because
  Android's splash-screen API insets the image again; reusing the launcher
  foreground here leaves the mark inset twice and reading as a small stamp.

Do not redraw, recolor, or crop the official mark. `placeholder-logo.svg` remains only as historical reference and is not used by the app.
