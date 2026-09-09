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

/** One figure in a block. */
interface Figure {
  key: string;
  label: string;
  value: string | number;
  tone?: string;
  /**
   * A value that is words wide rather than digits wide. Only money is: a fee
   * carries its currency, and at the figure size it would not fit a third of
   * a phone. A count of minutes is digits and stands with the rest.
   */
  dense?: boolean;
}

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

  // The register and the marks share one block: between them they answer one
  // question about how a term went.
  const training: Figure[] = snapshot ? [
    ...(snapshot.attendance.expected > 0 ? [
      { key: 'attended', label: 'Attended', value: `${snapshot.attendance.attended} of ${snapshot.attendance.expected}` },
      { key: 'attendance', label: 'Attendance', value: `${snapshot.attendance.pct}%`, tone: colors.accentSoft },
    ] : []),
    // A report published before the marks existed carries none, and simply
    // shows the register.
    ...(snapshot.training ?? []).map((mark) => ({
      key: mark.key,
      label: mark.kind === 'rating' ? `${mark.label} avg` : mark.label,
      value: mark.kind === 'rating' ? `${mark.value}/${mark.max_value ?? 10}` : mark.value,
    })),
  ] : [];

  const matches: Figure[] = snapshot && snapshot.matches.appearances > 0 ? [
    { key: 'appearances', label: 'Appearances', value: snapshot.matches.appearances },
    { key: 'minutes', label: 'Minutes', value: snapshot.matches.minutes },
    { key: 'goals', label: 'Goals', value: snapshot.matches.goals },
    { key: 'assists', label: 'Assists', value: snapshot.matches.assists },
    ...(snapshot.matches.yellow_cards + snapshot.matches.red_cards > 0
      ? [{ key: 'cards', label: 'Cards', value: snapshot.matches.yellow_cards + snapshot.matches.red_cards }] : []),
  ] : [];

  const fees: Figure[] = snapshot && snapshot.fees.charged_piastres !== 0 ? [
    { key: 'charged', label: 'Charged', value: formatEgpRound(snapshot.fees.charged_piastres), dense: true },
    { key: 'received', label: 'Received', value: formatEgpRound(snapshot.fees.paid_piastres), tone: colors.live, dense: true },
    {
      key: 'outstanding',
      label: snapshot.fees.overdue > 0 ? 'Outstanding, overdue' : 'Outstanding',
      value: formatEgpRound(snapshot.fees.outstanding_piastres),
      tone: snapshot.fees.outstanding_piastres > 0 ? colors.error : undefined,
      dense: true,
    },
  ] : [];

  const block = (title: string, figures: Figure[], empty: string) => <>
    <Text accessibilityRole="header" style={[styles.heading, at('heading')]}>{title}</Text>
    {figures.length
      ? <FlatCard radius={theme.radius.md} style={styles.grid}><Figures figures={figures} size={size} /></FlatCard>
      : <FlatCard radius={theme.radius.md} style={styles.block}><Text style={styles.muted}>{empty}</Text></FlatCard>}
  </>;

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
      {block('Training', training, 'Nothing was recorded at training over this period.')}
      {block('Matches', matches, 'No matches played over this period.')}
      {block('Fees', fees, 'Nothing has been charged.')}
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
 * A block's figures, as one panel divided by hairlines.
 *
 * A border only where two figures meet, and none around them: outlines at
 * reading distance are things to look at before a number is read, and the
 * figures are what somebody came for. The same grid the player's own training
 * page uses, so a reader moving between the two is looking at one thing.
 */
function Figures({ figures, size }: { figures: Figure[]; size: ReportSize }) {
  const styles = useThemedStyles(stylesheet);
  const big = size === 'page';
  // Two sit as halves; more divide into thirds and wrap, so the rows line up
  // column for column however many there turn out to be.
  const across = figures.length <= 2 ? 2 : 3;
  return <View style={styles.row}>{figures.map((figure, index) => <View
    key={figure.key}
    style={[
      styles.cell,
      { flexBasis: `${100 / across}%` },
      index % across !== 0 && styles.dividerLeft,
      index >= across && styles.dividerTop,
    ]}
  >
    <Text
      numberOfLines={1}
      style={[styles.value, big && { fontSize: figure.dense ? theme.type.body : PAGE_TYPE.figureValue }, figure.tone ? { color: figure.tone } : null]}
    >
      {figure.value}
    </Text>
    <Text numberOfLines={2} style={[styles.label, big && { fontSize: PAGE_TYPE.figureLabel }]}>{figure.label}</Text>
  </View>)}</View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.sm },
  head: { gap: 4, padding: theme.spacing.md },
  title: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  who: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  period: { color: colors.textMuted, fontSize: theme.type.label },

  heading: { color: colors.textSecondary, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 1, marginTop: theme.spacing.xs, textTransform: 'uppercase' },
  block: { padding: theme.spacing.md },
  // The dividers are drawn inside the card, so it keeps its own rounded edge.
  grid: { overflow: 'hidden', padding: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { alignItems: 'center', gap: 2, minWidth: 0, paddingHorizontal: theme.spacing.xs, paddingVertical: theme.spacing.md },
  dividerLeft: { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth },
  dividerTop: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  value: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.body, fontVariant: ['tabular-nums'] },
  label: { color: colors.textMuted, fontSize: theme.type.caption, textAlign: 'center' },

  feedback: { color: colors.textPrimary, fontFamily: theme.font.regular, lineHeight: 22 },
  feedbackPage: { lineHeight: 26 },
  muted: { color: colors.textMuted },
  footnote: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: theme.spacing.xs },
});
