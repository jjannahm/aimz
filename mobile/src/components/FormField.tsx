import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * `style` reaches the text input itself; `containerStyle` reaches the group
 * around it, which is what a row lays out. See the note on `group` below.
 */
type Props = TextInputProps & { label: string; error?: string; hint?: string; containerStyle?: StyleProp<ViewStyle> };

export function FormField({ label, error, hint, secureTextEntry, style, containerStyle, onBlur, onFocus, ...props }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.group, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputShell, props.multiline && styles.multilineShell, focused && styles.inputFocused, error && styles.inputError]} testID="form-field-shell">
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={Boolean(secureTextEntry) && !revealed}
          selectionColor={colors.accent}
          style={[styles.input, styles.webInput, props.multiline && styles.multiline, style]}
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
              color={colors.textSecondary}
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

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  // Deliberately not flexible. A flexible group takes a flex basis of zero, so
  // in a column it is handed an equal share of the free space rather than the
  // height its own contents need — which starves a tall field, and the overflow
  // then paints over whatever follows it. A row that wants two fields to share
  // its width passes `containerStyle` instead.
  group: { gap: theme.spacing.xs, minWidth: 0 },
  label: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' },
  inputShell: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', minHeight: 52, minWidth: 0, overflow: 'hidden', width: '100%' },
  inputFocused: { borderColor: colors.accent, borderWidth: 2 },
  // A single-line input is centred in the shell; a taller one fills it.
  multilineShell: { alignItems: 'stretch' },
  input: { color: colors.textPrimary, flex: 1, fontSize: theme.type.body, minHeight: 50, minWidth: 0, paddingHorizontal: theme.spacing.md },
  webInput: { outlineColor: 'transparent', outlineWidth: 0 },
  multiline: { minHeight: 96, paddingTop: theme.spacing.md, textAlignVertical: 'top' },
  inputError: { borderColor: colors.error, borderWidth: 2 },
  reveal: { alignItems: 'center', height: 44, justifyContent: 'center', marginRight: theme.spacing.xs, width: 44 },
  pressed: { opacity: 0.65 },
  error: { color: colors.errorText, fontSize: theme.type.caption },
  hint: { color: colors.textMuted, fontSize: theme.type.caption },
});
