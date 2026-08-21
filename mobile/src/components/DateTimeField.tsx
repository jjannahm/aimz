import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import { formatEgyptDateTime, fromEgyptWallClock, toEgyptWallClock } from '@/src/lib/egyptTime';

type Props = { label: string; value: string; onChange: (iso: string) => void; error?: string };

/**
 * A kickoff time, picked rather than typed.
 *
 * The admin only ever sees Egypt local time. The picker itself speaks the
 * device's own zone, so its reading is treated as an Egypt wall clock on the
 * way in and out; what leaves the field is always a UTC instant.
 */
export function DateTimeField({ label, value, onChange, error }: Props) {
  const styles = useThemedStyles(stylesheet);
  const [open, setOpen] = useState<'date' | 'time' | null>(null);
  const parsed = new Date(value);
  const wall = toEgyptWallClock(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
  const shown = new Date(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const commit = (picked: Date) => onChange(fromEgyptWallClock({ year: picked.getFullYear(), month: picked.getMonth() + 1, day: picked.getDate(), hour: picked.getHours(), minute: picked.getMinutes() }).toISOString());
  const handle = (mode: 'date' | 'time') => (event: DateTimePickerEvent, picked?: Date) => {
    // Android's dialog closes itself; iOS keeps the spinner until it is dismissed.
    if (Platform.OS === 'android') setOpen(mode === 'date' && event.type === 'set' ? 'time' : null);
    if (event.type === 'dismissed' || !picked) return;
    commit(picked);
  };
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityHint="Opens a date and time picker" accessibilityLabel={label} accessibilityRole="button" onPress={() => setOpen(open ? null : 'date')} style={({ pressed }) => [styles.shell, error && styles.shellError, pressed && styles.pressed]}>
        <Text style={styles.value}>{formatEgyptDateTime(value)}</Text>
      </Pressable>
      {open === 'date' ? <DateTimePicker display={Platform.OS === 'ios' ? 'spinner' : 'default'} mode="date" onChange={handle('date')} value={shown} /> : null}
      {open === 'time' || (Platform.OS === 'ios' && open === 'date') ? <DateTimePicker display={Platform.OS === 'ios' ? 'spinner' : 'default'} mode="time" onChange={handle('time')} value={shown} /> : null}
      {open && Platform.OS === 'ios' ? <Pressable accessibilityRole="button" onPress={() => setOpen(null)} style={styles.done}><Text style={styles.doneText}>Done</Text></Pressable> : null}
      {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  group: { flex: 1, gap: theme.spacing.xs },
  label: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' },
  shell: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, justifyContent: 'center', minHeight: 52, paddingHorizontal: theme.spacing.md },
  shellError: { borderColor: colors.error },
  pressed: { opacity: 0.7 },
  value: { color: colors.textPrimary, fontSize: theme.type.body },
  done: { alignItems: 'center', minHeight: theme.touch.minimum, justifyContent: 'center' },
  doneText: { color: colors.accentSoft, fontWeight: '800' },
  error: { color: colors.errorText, fontSize: theme.type.caption },
});
