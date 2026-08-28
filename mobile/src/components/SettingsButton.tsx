import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * The header's way into settings, which every screen carries now that the tab
 * bar no longer does. Matches `CloseButton`, since the two sit side by side.
 */
export function SettingsButton() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  // Where the gear was pressed, so closing settings comes back here. Moving
  // between tabs leaves no history to go back through, so the way back has to
  // be carried rather than popped.
  const from = usePathname();
  return (
    <Pressable
      accessibilityLabel="Settings"
      accessibilityRole="button"
      hitSlop={10}
      onPress={() => router.push({ pathname: '/settings', params: { from } })}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons color={colors.textPrimary} name="settings-outline" size={22} style={styles.icon} />
    </Pressable>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  button: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  // Ionicons' gear is optically top-heavy, so centre the glyph without moving
  // the button's 44-point hit area out of alignment with the header.
  icon: { transform: [{ translateY: 1 }] },
  pressed: { opacity: 0.7 },
});
