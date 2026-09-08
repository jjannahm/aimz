import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { formatEgpRound } from '@/src/lib/money';
import { positionName } from '@/src/lib/positions';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { SharedReport } from '@/src/types/api';

/** `2026-09-01` reads as `1 September 2026`. */
const readable = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * How large the report is set.
 *
 * `panel` is a report inside something else — the coach's preview, three boxes
 * deep in Manage, and the copy in the Hub. `page` is the link a parent opens,
 * where the report is the only thing on the screen and the same sizes read as
 * small print marooned in the middle of it.
 */
export type ReportSize = 'panel' | 'page';

/** One step up the scale for each thing set on the page. */
const PAGE_TYPE = {
  title: theme.type.display,
  who: theme.type.heading,
  heading: theme.type.label,
  figureValue: theme.type.heading,
  figureLabel: theme.type.label,
  footnote: theme.type.label,
} as const;

/**
 * A report, as it is read.
 *
 * The same component behind all three ways of reading one: the coach's preview
 * while writing it, the parent's copy in the app, and the page a link opens.
 * It takes a plain report and nothing else — no hooks, no queries, no account —
 * because the last of those three has no session to read anything with.
 */
export function ReportCard({ report, size = 'page' }: { report: SharedReport; size?: ReportSize }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const snapshot = report.snapshot;
  // The sizes the page overrides, applied alongside the panel styles rather
  // than as a second copy of the whole sheet.
  const big = size === 'page';
  const at = (key: keyof typeof PAGE_TYPE) => (big ? { fontSize: PAGE_TYPE[key] } : null);

  return <View style={styles.stack}>
    <FlatCard radius={theme.radius.lg} style={styles.head}>
      <Text accessibilityRole="header" style={[styles.title, at('title')]}>{report.title}</Text>
      {snapshot ? <Text style={[styles.who, at('who')]}>
        {snapshot.player.name}
        {snapshot.player.position ? ` · ${positionName(snapshot.player.position)}` : ''}
        {snapshot.player.team_name ? ` · ${snapshot.player.team_name}` : ''}
      </Text> : null}
      <Text style={[styles.period, at('footnote')]}>{readable(report.period_start)} to {readable(report.period_end)}</Text>
    </FlatCard>

    {snapshot ? <>
      <Text accessibilityRole="header" style={[styles.heading, at('heading')]}>Training</Text>
      <FlatCard radius={theme.radius.md} style={styles.block}>
        {snapshot.attendance.expected === 0
          // A zero would read as never turning up, when it means nobody kept a
          // register over these weeks.
          ? <Text style={styles.muted}>No register was taken over this period.</Text>
          : <View style={styles.figures}>
            <Figure label="Attended" size={size} value={`${snapshot.attendance.attended} of ${snapshot.attendance.expected}`} />
            <Figure label="Attendance" size={size} tone={colors.accentSoft} value={`${snapshot.attendance.pct}%`} />
          </View>}
      </FlatCard>

      <Text accessibilityRole="header" style={[styles.heading, at('heading')]}>Matches</Text>
      <FlatCard radius={theme.radius.md} style={styles.block}>
        {snapshot.matches.appearances === 0
          ? <Text style={styles.muted}>No matches played over this period.</Text>
          : <View style={styles.figures}>
            <Figure label="Appearances" size={size} value={snapshot.matches.appearances} />
            <Figure label="Minutes" size={size} value={snapshot.matches.minutes} />
            <Figure label="Goals" size={size} value={snapshot.matches.goals} />
            <Figure label="Assists" size={size} value={snapshot.matches.assists} />
            {snapshot.matches.yellow_cards + snapshot.matches.red_cards > 0
              ? <Figure label="Cards" size={size} value={snapshot.matches.yellow_cards + snapshot.matches.red_cards} /> : null}
          </View>}
      </FlatCard>

      <Text accessibilityRole="header" style={[styles.heading, at('heading')]}>Fees</Text>
      <FlatCard radius={theme.radius.md} style={styles.block}>
        {snapshot.fees.charged_piastres === 0
          ? <Text style={styles.muted}>Nothing has been charged.</Text>
          : <View style={styles.figures}>
            <Figure dense label="Charged" size={size} value={formatEgpRound(snapshot.fees.charged_piastres)} />
            <Figure dense label="Received" size={size} tone={colors.live} value={formatEgpRound(snapshot.fees.paid_piastres)} />
            <Figure
              dense
              label={snapshot.fees.overdue > 0 ? 'Outstanding, overdue' : 'Outstanding'}
              size={size}
              tone={snapshot.fees.outstanding_piastres > 0 ? colors.error : undefined}
              value={formatEgpRound(snapshot.fees.outstanding_piastres)}
            />
          </View>}
      </FlatCard>
    </> : null}

    {report.coach_feedback.trim() ? <>
      <Text accessibilityRole="header" style={[styles.heading, at('heading')]}>From the coach</Text>
      <FlatCard radius={theme.radius.md} style={styles.block}>
        {/* Prose stays at reading size: a paragraph set at 22 on a phone reads
          * worse, not better. It gets the room instead. */}
        <Text style={[styles.feedback, big && styles.feedbackPage]}>{report.coach_feedback.trim()}</Text>
      </FlatCard>
    </> : null}

    {report.published_at ? <Text style={[styles.footnote, at('footnote')]}>
      Written by {report.published_by_name ?? 'an AIMZ coach'} on {readable(report.published_at.slice(0, 10))}.
    </Text> : null}
  </View>;
}

/**
 * `dense` is for a figure whose value is words wide rather than digits wide.
 * A fee amount at the figure size wraps inside a third of the card once the
 * report is nested in Manage, and a number broken across two lines is worse
 * than a slightly smaller one.
 */
function Figure({ label, value, tone, size, dense = false }: { label: string; value: string | number; tone?: string; size: ReportSize; dense?: boolean }) {
  const styles = useThemedStyles(stylesheet);
  const big = size === 'page';
  return <View style={styles.figure}>
    <Text style={[styles.figureValue, big && { fontSize: dense ? theme.type.body : PAGE_TYPE.figureValue }, tone ? { color: tone } : null]}>{value}</Text>
    <Text style={[styles.figureLabel, big && { fontSize: PAGE_TYPE.figureLabel }]}>{label}</Text>
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
  // Three to a row, in columns that line up whatever is in them, wrapping to
  // the next row past the third. A share of the width each rather than a gap
  // between them, the way the weekday picker fits seven across.
  //
  // Each figure is centred in its own third, which is what makes the grid read
  // as one: left-aligned, a narrow "5 Goals" beside a wide "Appearances" leaves
  // the card looking ragged even though the columns are exact. The squad
  // ledger's totals row is centred for the same reason.
  figures: { flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.spacing.md },
  figure: { alignItems: 'center', flexBasis: '33.33%', gap: 2, minWidth: 0, paddingHorizontal: theme.spacing.xs },
  figureValue: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.body, fontVariant: ['tabular-nums'], textAlign: 'center' },
  figureLabel: { color: colors.textMuted, fontSize: theme.type.caption, textAlign: 'center' },

  feedback: { color: colors.textPrimary, fontFamily: theme.font.regular, lineHeight: 22 },
  feedbackPage: { lineHeight: 26 },
  muted: { color: colors.textMuted },
  footnote: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: theme.spacing.xs },
});
