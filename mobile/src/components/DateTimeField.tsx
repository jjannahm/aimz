import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import { formatEgyptDateTime, fromEgyptWallClock, toEgyptWallClock, type WallClock } from '@/src/lib/egyptTime';

type Props = { label: string; value: string; onChange: (isoOrDate: string) => void; error?: string; dateOnly?: boolean };

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Kickoffs are called on the quarter hour, so nothing else is reachable. */
const QUARTER = 15;

/** The nearest quarter to a reading, in minutes since midnight, wrapping the day. */
const toQuarter = (hour: number, minute: number) => (Math.round((hour * 60 + minute) / QUARTER) * QUARTER) % 1440;

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
/** Monday-first index of the 1st, which is the column the month starts in. */
const startColumn = (year: number, month: number) => (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;

/**
 * A kickoff time, picked rather than typed.
 *
 * The panel opens in normal flow directly beneath the field, so the form moves
 * down rather than being covered. It is built from the same Text and Pressable
 * the rest of the app uses, which is why it carries the app's own typography —
 * the browser's `datetime-local` control it replaces rendered in the document
 * font and sat a few pixels out of line with every field around it.
 *
 * The admin sees Egypt local time throughout; what leaves the field is the UTC
 * instant that reading names.
 */
export function DateTimeField({ label, value, onChange, error, dateOnly = false }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const [open, setOpen] = useState(false);
  const parsed = new Date(value);
  const wall = toEgyptWallClock(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
  const [view, setView] = useState({ year: wall.year, month: wall.month });

  const commit = (next: Partial<WallClock>) => {
    const reading = { ...wall, ...next };
    onChange(dateOnly
      ? `${reading.year}-${String(reading.month).padStart(2, '0')}-${String(reading.day).padStart(2, '0')}`
      : fromEgyptWallClock(reading).toISOString());
  };
  const shiftMonth = (by: number) => setView((current) => {
    const month = current.month + by;
    if (month < 1) return { year: current.year - 1, month: 12 };
    if (month > 12) return { year: current.year + 1, month: 1 };
    return { ...current, month };
  });
  const shiftMinutes = (by: number) => {
    // Stepping from a quarter keeps landing on one, whichever button is used.
    const total = toQuarter(wall.hour, wall.minute) + by;
    const wrapped = ((total % 1440) + 1440) % 1440;
    commit({ hour: Math.floor(wrapped / 60), minute: wrapped % 60 });
  };
  // A kickoff arriving off the quarter — the form opens on the current time —
  // is pulled onto the nearest one, so the field never shows or stores a
  // minute the picker cannot reach.
  useEffect(() => {
    if (dateOnly || wall.minute % QUARTER === 0) return;
    const wrapped = toQuarter(wall.hour, wall.minute);
    onChange(fromEgyptWallClock({ ...wall, hour: Math.floor(wrapped / 60), minute: wrapped % 60 }).toISOString());
  }, [dateOnly, onChange, wall]);
  const total = daysInMonth(view.year, view.month);
  const cells: (number | null)[] = [
    ...Array.from({ length: startColumn(view.year, view.month) }, () => null),
    ...Array.from({ length: total }, (unused, index) => index + 1),
  ];
  const hour12 = wall.hour % 12 === 0 ? 12 : wall.hour % 12;
  const meridiem = wall.hour < 12 ? 'AM' : 'PM';

  return (
    // An open panel has to paint over the fields after it. Later siblings win
    // the stacking order by default, so the whole field is lifted while it is
    // open and dropped back afterwards, which keeps it out of everything else's
    // way when it is closed.
    <View style={[styles.group, open && styles.groupOpen]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityHint="Opens a date and time picker below this field"
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.shell, open && styles.shellOpen, error && styles.shellError, pressed && styles.pressed]}
      >
        <Text style={styles.value}>{dateOnly ? (value ? `${MONTHS[wall.month - 1]} ${wall.day}, ${wall.year}` : 'Not set') : formatEgyptDateTime(value)}</Text>
        <Ionicons accessibilityElementsHidden color={colors.textSecondary} name={open ? 'chevron-up' : 'calendar-outline'} size={20} />
      </Pressable>

      {open ? <View style={styles.panel}>
        <View style={styles.monthRow}>
          <Pressable accessibilityLabel="Previous month" accessibilityRole="button" hitSlop={8} onPress={() => shiftMonth(-1)} style={({ pressed }) => [styles.step, pressed && styles.pressed]}>
            <Ionicons color={colors.accentSoft} name="chevron-back" size={18} />
          </Pressable>
          <Text style={styles.monthLabel}>{MONTHS[view.month - 1]} {view.year}</Text>
          <Pressable accessibilityLabel="Next month" accessibilityRole="button" hitSlop={8} onPress={() => shiftMonth(1)} style={({ pressed }) => [styles.step, pressed && styles.pressed]}>
            <Ionicons color={colors.accentSoft} name="chevron-forward" size={18} />
          </Pressable>
        </View>

        <View style={styles.week}>{WEEKDAYS.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
        <View style={styles.grid}>{cells.map((day, index) => {
          if (day === null) return <View key={`pad-${index}`} style={styles.day} />;
          const selected = day === wall.day && view.year === wall.year && view.month === wall.month;
          return <Pressable
            accessibilityLabel={`${day} ${MONTHS[view.month - 1]} ${view.year}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={day}
            onPress={() => commit({ year: view.year, month: view.month, day })}
            style={({ pressed }) => [styles.day, selected && styles.daySelected, pressed && styles.pressed]}
          >
            <Text style={[styles.dayText, selected && styles.daySelectedText]}>{day}</Text>
          </Pressable>;
        })}</View>

        {!dateOnly ? <View style={styles.timeRow}>
          <Pressable accessibilityLabel="Earlier hour" accessibilityRole="button" onPress={() => shiftMinutes(-60)} style={({ pressed }) => [styles.step, pressed && styles.pressed]}>
            <Ionicons color={colors.accentSoft} name="remove" size={18} />
          </Pressable>
          <Text accessibilityLabel={`Kickoff time ${hour12}:${String(wall.minute).padStart(2, '0')} ${meridiem}`} style={styles.time}>{hour12}:{String(wall.minute).padStart(2, '0')} {meridiem}</Text>
          <Pressable accessibilityLabel="Later hour" accessibilityRole="button" onPress={() => shiftMinutes(60)} style={({ pressed }) => [styles.step, pressed && styles.pressed]}>
            <Ionicons color={colors.accentSoft} name="add" size={18} />
          </Pressable>
          <View style={styles.minuteGroup}>
            <Pressable accessibilityLabel={`${QUARTER} minutes earlier`} accessibilityRole="button" onPress={() => shiftMinutes(-QUARTER)} style={({ pressed }) => [styles.minuteStep, pressed && styles.pressed]}>
              <Text style={styles.minuteStepText}>−{QUARTER}</Text>
            </Pressable>
            <Pressable accessibilityLabel={`${QUARTER} minutes later`} accessibilityRole="button" onPress={() => shiftMinutes(QUARTER)} style={({ pressed }) => [styles.minuteStep, pressed && styles.pressed]}>
              <Text style={styles.minuteStepText}>+{QUARTER}</Text>
            </Pressable>
          </View>
        </View> : null}

        <Pressable accessibilityLabel="Done choosing the date and time" accessibilityRole="button" onPress={() => setOpen(false)} style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View> : null}

      {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  group: { flex: 1, gap: theme.spacing.xs },
  groupOpen: { elevation: 8, zIndex: 10 },
  label: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' },
  shell: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between', minHeight: 52, paddingHorizontal: theme.spacing.md },
  shellOpen: { borderColor: colors.accent },
  shellError: { borderColor: colors.error },
  pressed: { opacity: 0.7 },
  value: { color: colors.textPrimary, flex: 1, fontSize: theme.type.body },
  panel: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, elevation: 8, gap: theme.spacing.sm, padding: theme.spacing.md, shadowColor: colors.background, shadowOffset: { height: 6, width: 0 }, shadowOpacity: 0.4, shadowRadius: 12, zIndex: 10 },
  monthRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  monthLabel: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '800' },
  step: { alignItems: 'center', borderRadius: theme.radius.sm, height: theme.touch.minimum, justifyContent: 'center', width: theme.touch.minimum },
  week: { flexDirection: 'row' },
  weekday: { color: colors.textMuted, flexBasis: '14.28%', fontSize: theme.type.caption, fontWeight: '800', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  day: { alignItems: 'center', borderRadius: theme.radius.sm, flexBasis: '14.28%', justifyContent: 'center', minHeight: 38 },
  daySelected: { backgroundColor: colors.accent },
  dayText: { color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  daySelectedText: { color: colors.onAccent, fontWeight: '900' },
  timeRow: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, paddingTop: theme.spacing.sm },
  time: { color: colors.textPrimary, flex: 1, fontSize: theme.type.heading, fontVariant: ['tabular-nums'], fontWeight: '900', textAlign: 'center' },
  minuteGroup: { flexDirection: 'row', gap: theme.spacing.xs },
  minuteStep: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.sm },
  minuteStepText: { color: colors.accentSoft, fontSize: theme.type.label, fontWeight: '800' },
  done: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: theme.radius.md, justifyContent: 'center', minHeight: theme.touch.minimum },
  doneText: { color: colors.onAccent, fontWeight: '900' },
  error: { color: colors.errorText, fontSize: theme.type.caption },
});
