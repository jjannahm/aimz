import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = {
  /** Defaults to popping the stack, which is what every screen header wants. */
  onPress?: () => void;
};

/** The round header dismiss control. An X reads as "close this", where the
 * chevron it replaced was mistaken for a step backwards through the app. */
export function CloseButton({ onPress }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  return (
    <Pressable
      accessibilityLabel="Close"
      accessibilityRole="button"
      hitSlop={10}
      onPress={onPress ?? (() => router.back())}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons color={colors.textPrimary} name="close" size={24} />
    </Pressable>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  button: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  pressed: { opacity: 0.7 },
});
