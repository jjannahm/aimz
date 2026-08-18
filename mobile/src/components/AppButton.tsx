import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { theme } from '@/src/theme';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: ViewStyle;
};

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  compact = false,
  style,
}: Props) {
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
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? theme.colors.onAccent : theme.colors.textPrimary} />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: theme.touch.minimum,
    paddingHorizontal: theme.spacing.md,
  },
  primary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  secondary: { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border },
  danger: { backgroundColor: theme.colors.errorSurface, borderColor: theme.colors.error },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  compact: { minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.sm },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
  label: { fontSize: theme.type.label, fontWeight: '800' },
  primaryLabel: { color: theme.colors.onAccent },
  secondaryLabel: { color: theme.colors.textPrimary },
  dangerLabel: { color: theme.colors.errorText },
  ghostLabel: { color: theme.colors.lightBlue },
});
