import type { ErrorBoundaryProps } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { sessionStore } from '@/src/lib/session';

/**
 * What the app shows instead of nothing when a screen throws.
 *
 * A render that throws used to leave a bare page: no message, no way back, and
 * nothing to tell it apart from a slow load or a server that was down. That is
 * not a state anybody can report usefully — "the site doesn't work" is where it
 * ends — so this says what happened and offers the two ways out.
 *
 * Deliberately built from nothing but React Native primitives and literal
 * colours: the theme provider, the fonts and the query client all sit inside the
 * tree this catches, so anything reached for here could be the very thing that
 * failed. It reads in the system face for the same reason.
 */
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const dark = useColorScheme() !== 'light';
  const styles = sheet(dark);

  /**
   * The stored session is the state most likely to be behind a crash that
   * survives a reload — a token the API will not take, read back on every
   * start. Clearing it lands the reader on sign-in, which works.
   */
  const reset = async () => {
    await sessionStore.clear().catch(() => undefined);
    if (Platform.OS === 'web') {
      try { window.localStorage.clear(); } catch { /* a private window may refuse */ }
      window.location.replace('/');
      return;
    }
    await retry();
  };

  return <View style={styles.page}>
    <ScrollView contentContainerStyle={styles.middle}>
      <Text style={styles.title}>This screen stopped working</Text>
      <Text style={styles.body}>
        Something went wrong while drawing this page. Trying again is usually enough. If it keeps
        happening, resetting signs you out and clears what the app has saved on this device.
      </Text>
      {/* The message verbatim, because it is the only thing anybody reporting
        * this can pass on, and a minified React error still names its number. */}
      <View style={styles.detail}><Text style={styles.detailText}>{error?.message ?? 'No message was given.'}</Text></View>
      <Pressable accessibilityRole="button" onPress={() => retry()} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={reset} style={({ pressed }) => [styles.button, styles.quiet, pressed && styles.pressed]}>
        <Text style={[styles.buttonText, styles.quietText]}>Reset the app and sign in again</Text>
      </Pressable>
    </ScrollView>
  </View>;
}

/** The two palettes, written out rather than read from the theme. See above. */
const sheet = (dark: boolean) => {
  const background = dark ? '#08080C' : '#A6C4E8';
  const surface = dark ? '#121216' : '#FFFFFF';
  const border = dark ? '#2C2B32' : '#CBD5E1';
  const primary = dark ? '#F5F3F7' : '#111827';
  const muted = dark ? '#94909A' : '#4B5563';
  return StyleSheet.create({
    page: { backgroundColor: background, flex: 1 },
    middle: { flexGrow: 1, gap: 16, justifyContent: 'center', maxWidth: 520, padding: 24, width: '100%' },
    title: { color: primary, fontSize: 24, fontWeight: '700' },
    body: { color: muted, fontSize: 15, lineHeight: 22 },
    detail: { backgroundColor: surface, borderColor: border, borderRadius: 12, borderWidth: 1, padding: 12 },
    detailText: { color: muted, fontSize: 13, lineHeight: 19 },
    button: { alignItems: 'center', backgroundColor: '#3B82F6', borderRadius: 999, justifyContent: 'center', minHeight: 44, paddingHorizontal: 20 },
    quiet: { backgroundColor: 'transparent', borderColor: border, borderWidth: 1 },
    buttonText: { color: '#08080C', fontSize: 15, fontWeight: '700' },
    quietText: { color: primary },
    pressed: { opacity: 0.7 },
  });
};
