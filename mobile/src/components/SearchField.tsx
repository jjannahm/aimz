import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { noFocusRingText, theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/** A search box, with a clear control that only appears once there is something to clear. */
export function SearchField({ value, onChange, placeholder = 'Search', label = 'Search', resultCount }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  /** Announced to a screen reader as the list narrows. */
  resultCount?: number;
}) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.group}>
    <View style={styles.field}>
      <Ionicons accessibilityElementsHidden color={colors.textMuted} name="search" size={18} />
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        style={styles.input}
        testID="search-input"
        value={value}
      />
      {value ? <Pressable
        accessibilityLabel="Clear search"
        accessibilityRole="button"
        hitSlop={theme.spacing.sm}
        onPress={() => onChange('')}
        style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        testID="search-clear"
      >
        <Ionicons accessibilityElementsHidden color={colors.textMuted} name="close-circle" size={18} />
      </Pressable> : null}
    </View>
    {value && resultCount !== undefined ? <Text accessibilityLiveRegion="polite" style={styles.count}>
      {resultCount === 0 ? 'No matches' : `${resultCount} ${resultCount === 1 ? 'match' : 'matches'}`}
    </Text> : null}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  group: { gap: theme.spacing.xs },
  field: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md },
  // The field draws its own border; the browser's focus outline on web would
  // put a second, blue one inside it.
  input: { ...noFocusRingText, color: colors.textPrimary, flex: 1, fontSize: theme.type.body, paddingVertical: theme.spacing.sm },
  clear: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  count: { color: colors.textMuted, fontSize: theme.type.caption },
});
