import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { GlassSurface } from '@/src/components/GlassSurface';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { toEgyptWallClock } from '@/src/lib/egyptTime';
import { describeDuration, groupSessionsByMonth } from '@/src/lib/trainingSchedule';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { TrainingSession } from '@/src/types/api';

const inCairo = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-EG', { timeZone: 'Africa/Cairo', ...options });
const weekday = inCairo({ weekday: 'short' });
const dayNumber = inCairo({ day: '2-digit' });
const monthShort = inCairo({ month: 'short' });
const clock = inCairo({ hour: 'numeric', minute: '2-digit', hour12: true });

const spoken = (session: TrainingSession) => `Training at ${session.venue}, ${weekday.format(new Date(session.starts_at))} ${dayNumber.format(new Date(session.starts_at))} ${monthShort.format(new Date(session.starts_at))}, ${clock.format(new Date(session.starts_at))}`;
const open = (session: TrainingSession) => router.push({ pathname: '/training/[id]', params: { id: session.id } });

/**
 * The session to come next, given the room to be read at a glance rather than
 * buried at the top of a list of its equals.
 */
function NextTraining({ session }: { session: TrainingSession }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const when = new Date(session.starts_at);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>NEXT TRAINING</Text>
      <Pressable accessibilityLabel={spoken(session)} accessibilityRole="button" onPress={() => open(session)} style={({ pressed }) => pressed && styles.pressed}>
        <GlassSurface intensity={55} radius={22} style={styles.feature}>
          <View style={styles.featureTop}>
            <View>
              <Text style={styles.featureDay}>{weekday.format(when).toUpperCase()} {dayNumber.format(when)}</Text>
              <Text style={styles.featureMonth}>{monthShort.format(when).toUpperCase()}</Text>
            </View>
            <Text style={styles.featureTime}>{clock.format(when)}</Text>
          </View>
          <View style={styles.featureFoot}>
            <View style={styles.featureCopy}>
              <Text numberOfLines={1} style={styles.venue}>{session.venue}</Text>
              <Text style={styles.meta}>{describeDuration(session.duration_minutes)}</Text>
            </View>
            <Ionicons accessibilityElementsHidden color={colors.textMuted} name="chevron-forward" size={20} />
          </View>
        </GlassSurface>
      </Pressable>
    </View>
  );
}

/** One row of the schedule: a dot on the thread, the day, and where and when. */
function SessionRow({ session, last }: { session: TrainingSession; last: boolean }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const when = new Date(session.starts_at);
  return (
    <Pressable accessibilityLabel={spoken(session)} accessibilityRole="button" onPress={() => open(session)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {/* The thread the dots hang on, drawn per row so it stops at the last. */}
      <View style={styles.thread}>
        {/* On the last row the line stops at its dot instead of vanishing, or
          * the thread would end a whole row above the session it leads to. */}
        <View style={[styles.threadLine, last && styles.threadLineLast]} />
        <View style={styles.dot} />
      </View>
      <View style={styles.rowDate}>
        <Text style={styles.rowWeekday}>{weekday.format(when).toUpperCase()}</Text>
        <Text style={styles.rowDay}>{dayNumber.format(when)}</Text>
      </View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.venue}>{session.venue}</Text>
        <Text style={styles.meta}>{describeDuration(session.duration_minutes)}</Text>
      </View>
      <Text style={styles.rowTime}>{clock.format(when)}</Text>
      <Ionicons accessibilityElementsHidden color={colors.textMuted} name="chevron-forward" size={18} />
    </Pressable>
  );
}

export function ScheduleSection() {
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  // A parent has children rather than a player record of their own.
  const linked = user?.role === 'parent' || Boolean(user?.player_id);
  // No team is named: the server answers with the squad this account is on, or
  // with every squad a parent's children are on.
  const query = useQuery({ queryKey: ['training', 'mine', 'upcoming'], queryFn: () => api.trainingSessions(`?from=${encodeURIComponent(new Date().toISOString())}&limit=100`), enabled: linked });
  if (!linked) return <EmptyState body="Ask an AIMZ administrator to link your account to your squad player." title="Account not linked" />;
  if (query.isLoading) return <LoadingState label="Loading training schedule" />;
  if (query.isError) return <ErrorState message={(query.error as ApiError).message} onRetry={() => query.refetch()} />;
  if (!query.data?.items.length) return <EmptyState body="Your coach has not scheduled an upcoming training session." title="No training scheduled" />;

  const { next, months } = groupSessionsByMonth(query.data.items);
  return (
    <View style={styles.screen}>
      {next ? <NextTraining session={next} /> : null}
      {months.map((month) => (
        <View key={month.monthKey} style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionLabel}>{month.label.toUpperCase()}</Text>
          {/* One surface for the month, with the rows ruled inside it: a blur
            * apiece would cost as many as there are sessions. */}
          <GlassSurface radius={20} style={styles.monthCard}>
            {month.sessions.map((session, index) => (
              <View key={session.id}>
                {index ? <View style={styles.rule} /> : null}
                <SessionRow last={index === month.sessions.length - 1} session={session} />
              </View>
            ))}
          </GlassSurface>
        </View>
      ))}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  screen: { gap: theme.spacing.lg },
  section: { gap: theme.spacing.sm },
  // Said once, quietly, above what it names.
  sectionLabel: { color: colors.textMuted, fontSize: theme.type.caption, fontWeight: '700', letterSpacing: 1.1 },

  feature: { gap: theme.spacing.md, padding: theme.spacing.md },
  featureTop: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  featureDay: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '800', letterSpacing: -0.4 },
  featureMonth: { color: colors.textMuted, fontSize: theme.type.caption, fontWeight: '700', letterSpacing: 1 },
  featureTime: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '700' },
  featureFoot: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  featureCopy: { flex: 1, gap: 2 },

  monthCard: { paddingHorizontal: theme.spacing.md },
  // 64 points tall with the padding: a schedule, not a stack of cards.
  row: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 64, paddingVertical: theme.spacing.sm },
  rule: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginLeft: 34, opacity: 0.6 },

  thread: { alignItems: 'center', alignSelf: 'stretch', width: 10 },
  // The blue is a mark on the thread, not a fill behind the row.
  dot: { backgroundColor: colors.accent, borderRadius: 4, height: 8, marginTop: 22, width: 8 },
  // Runs the height of the row and on across the padding into the next, so the
  // thread reads as one line rather than a stub per row. Drawn before the dot,
  // which then sits on it. White rather than `border`, which on this glass is
  // the colour of the page behind it and so shows as nothing at all.
  threadLine: { backgroundColor: 'rgba(255, 255, 255, 0.16)', bottom: -theme.spacing.md, position: 'absolute', top: 0, width: 1 },
  // Down to the middle of the dot: 22 to its top, and half of its 8 points.
  threadLineLast: { bottom: undefined, height: 26 },

  rowDate: { alignItems: 'center', width: 40 },
  rowWeekday: { color: colors.textMuted, fontSize: theme.type.caption, fontWeight: '700', letterSpacing: 0.6 },
  rowDay: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '700', letterSpacing: -0.5 },
  rowCopy: { flex: 1, gap: 2 },
  rowTime: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700' },

  venue: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: theme.type.label },
  pressed: { opacity: 0.6 },
});
