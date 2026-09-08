import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { formatEgp } from '@/src/lib/money';
import { positionName } from '@/src/lib/positions';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { SharedReport } from '@/src/types/api';

/** `2026-09-01` reads as `1 September 2026`. */
const readable = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * A report, as it is read.
 *
 * The same component behind all three ways of reading one: the coach's preview
 * while writing it, the parent's copy in the app, and the page a link opens.
 * It takes a plain report and nothing else — no hooks, no queries, no account —
 * because the last of those three has no session to read anything with.
 */
export function ReportCard({ report }: { report: SharedReport }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const snapshot = report.snapshot;

  return <View style={styles.stack}>
    <FlatCard radius={theme.radius.lg} style={styles.head}>
      <Text accessibilityRole="header" style={styles.title}>{report.title}</Text>
      {snapshot ? <Text style={styles.who}>
        {snapshot.player.name}
        {snapshot.player.position ? ` · ${positionName(snapshot.player.position)}` : ''}
        {snapshot.player.team_name ? ` · ${snapshot.player.team_name}` : ''}
      </Text> : null}
      <Text style={styles.period}>{readable(report.period_start)} to {readable(report.period_end)}</Text>
    </FlatCard>

    {snapshot ? <>
      <Text accessibilityRole="header" style={styles.heading}>Training</Text>
      <FlatCard radius={theme.radius.md} style={styles.block}>
        {snapshot.attendance.expected === 0
          // A zero would read as never turning up, when it means nobody kept a
          // register over these weeks.
          ? <Text style={styles.muted}>No register was taken over this period.</Text>
          : <View style={styles.figures}>
            <Figure label="Attended" value={`${snapshot.attendance.attended} of ${snapshot.attendance.expected}`} />
            <Figure label="Attendance" tone={colors.accentSoft} value={`${snapshot.attendance.pct}%`} />
          </View>}
      </FlatCard>

      <Text accessibilityRole="header" style={styles.heading}>Matches</Text>
      <FlatCard radius={theme.radius.md} style={styles.block}>
        {snapshot.matches.appearances === 0
          ? <Text style={styles.muted}>No matches played over this period.</Text>
          : <View style={styles.figures}>
            <Figure label="Appearances" value={snapshot.matches.appearances} />
            <Figure label="Minutes" value={snapshot.matches.minutes} />
            <Figure label="Goals" value={snapshot.matches.goals} />
            <Figure label="Assists" value={snapshot.matches.assists} />
            {snapshot.matches.yellow_cards + snapshot.matches.red_cards > 0
              ? <Figure label="Cards" value={snapshot.matches.yellow_cards + snapshot.matches.red_cards} /> : null}
          </View>}
      </FlatCard>

      <Text accessibilityRole="header" style={styles.heading}>Fees</Text>
      <FlatCard radius={theme.radius.md} style={styles.block}>
        {snapshot.fees.charged_piastres === 0
          ? <Text style={styles.muted}>Nothing has been charged.</Text>
          : <View style={styles.figures}>
            <Figure label="Charged" value={formatEgp(snapshot.fees.charged_piastres)} />
            <Figure label="Received" tone={colors.live} value={formatEgp(snapshot.fees.paid_piastres)} />
            <Figure
              label={snapshot.fees.overdue > 0 ? 'Outstanding, overdue' : 'Outstanding'}
              tone={snapshot.fees.outstanding_piastres > 0 ? colors.error : undefined}
              value={formatEgp(snapshot.fees.outstanding_piastres)}
            />
          </View>}
      </FlatCard>
    </> : null}

    {report.coach_feedback.trim() ? <>
      <Text accessibilityRole="header" style={styles.heading}>From the coach</Text>
      <FlatCard radius={theme.radius.md} style={styles.block}>
        <Text style={styles.feedback}>{report.coach_feedback.trim()}</Text>
      </FlatCard>
    </> : null}

    {report.published_at ? <Text style={styles.footnote}>
      Written by {report.published_by_name ?? 'an AIMZ coach'} on {readable(report.published_at.slice(0, 10))}.
    </Text> : null}
  </View>;
}

function Figure({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.figure}>
    <Text style={[styles.figureValue, tone ? { color: tone } : null]}>{value}</Text>
    <Text style={styles.figureLabel}>{label}</Text>
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.sm },
  head: { gap: 4, padding: theme.spacing.md },
  title: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  who: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  period: { color: colors.textMuted, fontSize: theme.type.label },

  heading: { color: colors.textSecondary, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 1, marginTop: theme.spacing.xs, textTransform: 'uppercase' },
  block: { padding: theme.spacing.md },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
  figure: { gap: 2, minWidth: 84 },
  figureValue: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.body, fontVariant: ['tabular-nums'] },
  figureLabel: { color: colors.textMuted, fontSize: theme.type.caption },

  feedback: { color: colors.textPrimary, fontFamily: theme.font.regular, lineHeight: 22 },
  muted: { color: colors.textMuted },
  footnote: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: theme.spacing.xs },
});
