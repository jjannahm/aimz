import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { theme } from '@/src/theme';

type Props = TextInputProps & { label: string; error?: string; hint?: string };

export function FormField({ label, error, hint, secureTextEntry, style, ...props }: Props) {
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputShell, error && styles.inputError]}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={theme.colors.textMuted}
          secureTextEntry={Boolean(secureTextEntry) && !revealed}
          selectionColor={theme.colors.accent}
          style={[styles.input, props.multiline && styles.multiline, style]}
          {...props}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            accessibilityRole="button"
            hitSlop={4}
            onPress={() => setRevealed((current) => !current)}
            style={({ pressed }) => [styles.reveal, pressed && styles.pressed]}
          >
            <Ionicons
              color={theme.colors.textSecondary}
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={22}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flex: 1, gap: theme.spacing.xs },
  label: { color: theme.colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' },
  inputShell: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', minHeight: 52 },
  input: { color: theme.colors.textPrimary, flex: 1, fontSize: theme.type.body, minHeight: 50, paddingHorizontal: theme.spacing.md },
  multiline: { minHeight: 96, paddingTop: theme.spacing.md, textAlignVertical: 'top' },
  inputError: { borderColor: theme.colors.error },
  reveal: { alignItems: 'center', height: 44, justifyContent: 'center', marginRight: theme.spacing.xs, width: 44 },
  pressed: { opacity: 0.65 },
  error: { color: theme.colors.errorText, fontSize: theme.type.caption },
  hint: { color: theme.colors.textMuted, fontSize: theme.type.caption },
});
