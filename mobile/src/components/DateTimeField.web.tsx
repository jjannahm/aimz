import { StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import { fromEgyptInputValue, toEgyptInputValue } from '@/src/lib/egyptTime';

type Props = { label: string; value: string; onChange: (iso: string) => void; error?: string };

/**
 * The browser's own date and time picker.
 *
 * `datetime-local` carries no zone, so its reading is an Egypt wall clock and is
 * converted to a UTC instant before it leaves the field — the same contract the
 * native field keeps.
 */
export function DateTimeField({ label, value, onChange, error }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <input
        aria-label={label}
        onChange={(event) => { const iso = fromEgyptInputValue(event.target.value); if (iso) onChange(iso); }}
        style={{ backgroundColor: colors.surface, border: `1px solid ${error ? colors.error : colors.border}`, borderRadius: theme.radius.md, color: colors.textPrimary, colorScheme: 'inherit', fontFamily: 'inherit', fontSize: theme.type.body, minHeight: 52, paddingLeft: theme.spacing.md, paddingRight: theme.spacing.md, width: '100%' }}
        type="datetime-local"
        value={toEgyptInputValue(value)}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  group: { flex: 1, gap: theme.spacing.xs },
  label: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' },
  error: { color: colors.errorText, fontSize: theme.type.caption },
});
