import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

import { darkColors, lightColors } from '@/src/theme';

/**
 * Document shell for static rendering.
 *
 * Without this the document itself grows with the page, so scrolling moves the
 * whole app and the tab bar travels off the bottom of the window. Pinning the
 * root to the viewport height keeps scrolling inside each screen's own
 * container, which leaves the tab bar fixed where it belongs.
 *
 * Expo only reads this file when `web.output` is `static`. This app ships
 * `single`, so today the shipped shell comes from Expo's own template plus
 * `scripts/inject-web-branding.mjs`, and the two are kept in step by hand. The
 * body colour shows only before the app paints, so it follows the system
 * preference; `ThemeProvider` overwrites it once a saved Light / Dark choice is
 * known.
 */
const resetScroll = `
html, body, #root {
  height: 100%;
}
body {
  overflow: hidden;
  overscroll-behavior-y: none;
  background-color: ${lightColors.background};
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: ${darkColors.background};
  }
}
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: resetScroll }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
