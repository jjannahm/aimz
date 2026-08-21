import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  /** Glyph shown alongside — or instead of — the label. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Renders the icon alone in a square. `label` still names it for screen readers. */
  iconOnly?: boolean;
  style?: ViewStyle;
};

const inkFor = (colors: ThemeColors): Record<Variant, string> => ({
  primary: colors.onAccent,
  secondary: colors.textPrimary,
  danger: colors.onError,
  ghost: colors.accentSoft,
});

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  compact = false,
  icon,
  iconOnly = false,
  style,
}: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const ink = inkFor(colors)[variant];
  const showIconOnly = iconOnly && icon !== undefined;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        compact && styles.compact,
        showIconOnly && styles.square,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={ink} />
      ) : showIconOnly ? (
        <Ionicons accessibilityElementsHidden color={ink} name={icon} size={20} />
      ) : (
        <>
          {icon ? <Ionicons accessibilityElementsHidden color={ink} name={icon} size={18} /> : null}
          <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.xs,
    justifyContent: 'center',
    minHeight: theme.touch.minimum,
    paddingHorizontal: theme.spacing.md,
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  danger: { backgroundColor: colors.errorSurface, borderColor: colors.error },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  compact: { minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.sm },
  square: { paddingHorizontal: 0, width: theme.touch.minimum },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
  label: { fontSize: theme.type.label, fontWeight: '800' },
  primaryLabel: { color: colors.onAccent },
  secondaryLabel: { color: colors.textPrimary },
  dangerLabel: { color: colors.onError },
  ghostLabel: { color: colors.accentSoft },
});
