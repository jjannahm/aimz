import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { registerToastHost } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/** Long enough to read a short line, short enough not to sit in the way. */
const VISIBLE_MS = 2_600;

/**
 * The app's confirmation of good news.
 *
 * Mounted once at the root, beside DialogHost, so it outlives the screen that
 * raised it — a save that navigates away can still say it worked. It never
 * takes a press: it fades in, holds, and goes.
 */
export function ToastHost() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => registerToastHost(setMessage), []);

  // It appears and it goes, without a fade. An animated opacity was tried and
  // sat at nil on web, which is a worse toast than a plain one: the whole job
  // here is being seen.
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite" pointerEvents="none" style={styles.toast}>
      <Ionicons accessibilityElementsHidden color={colors.live} name="checkmark-circle" size={20} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  toast: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    bottom: theme.spacing.xxl,
    elevation: 12,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    maxWidth: 420,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    zIndex: 100,
  },
  message: { color: colors.textPrimary, flexShrink: 1, fontFamily: theme.font.semibold },
});
