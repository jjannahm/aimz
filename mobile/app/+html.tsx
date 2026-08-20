import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

/**
 * Document shell for the web build.
 *
 * Without this the document itself grows with the page, so scrolling moves the
 * whole app and the tab bar travels off the bottom of the window. Pinning the
 * root to the viewport height keeps scrolling inside each screen's own
 * container, which leaves the tab bar fixed where it belongs.
 */
const resetScroll = `
html, body, #root {
  height: 100%;
}
body {
  overflow: hidden;
  overscroll-behavior-y: none;
  background-color: #09112F;
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
