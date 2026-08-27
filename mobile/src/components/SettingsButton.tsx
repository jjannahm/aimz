import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
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
  return (
    <Pressable
      accessibilityLabel="Settings"
      accessibilityRole="button"
      hitSlop={10}
      onPress={() => router.push('/settings')}
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
