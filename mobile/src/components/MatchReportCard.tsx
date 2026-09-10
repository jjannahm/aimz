import { StyleSheet, Text, View } from 'react-native';

import { BrandMark } from '@/src/components/BrandMark';
import { FlatCard } from '@/src/components/FlatCard';
import { ScoreLine } from '@/src/components/ScoreLine';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { positionName } from '@/src/lib/positions';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { MatchReportSnapshot } from '@/src/types/api';

type ReportSize = 'panel' | 'page';

/**
 * The sizes the page steps up to, so the panel sheet stays the one source.
 *
 * The team names are not among them, and are set at reading size in both. Two
 * of them stand either side of a hero score on one line, and the page is 375pt
 * wide on the phone a parent opens the link on just as the panel is: stepped
 * up, the away name wraps to two lines or is squeezed to nothing. The score is
 * what should be big at the top of a match report, and `ScoreLine` sets it.
 */
const PAGE_TYPE = { heading: theme.type.label, footnote: theme.type.label } as const;

/** A minute, or the mark for one nobody typed in. */
const at = (minute: number | null) => minute === null ? "—" : `${minute}'`;

/** "3–1", "won", "drew": the result in a word, from the home side's view. */
function outcome(home: number, away: number) {
  if (home === away) return 'Draw';
  return home > away ? 'Home win' : 'Away win';
}

/**
 * A match report, as it is read.
 *
 * The same component behind both ways of reading one: the summary on the game
 * centre after full time, and the page a shared link opens. It takes a plain
 * snapshot and nothing else — no hooks, no queries, no account — because the
 * second of those has no session to read anything with.
 */
export function MatchReportCard({ report, size = 'page', brand = false }: { report: MatchReportSnapshot; size?: ReportSize; brand?: boolean }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const big = size === 'page';
  const type = (key: keyof typeof PAGE_TYPE) => (big ? { fontSize: PAGE_TYPE[key] } : null);
  const match = report.match;

  const heading = (title: string) => <Text accessibilityRole="header" style={[styles.heading, type('heading')]}>{title}</Text>;
  const empty = (words: string) => <FlatCard radius={theme.radius.md} style={styles.block}><Text style={styles.muted}>{words}</Text></FlatCard>;

  // One line per goal, reading the way a scorer is read out: who, from whom,
  // and what kind. An own goal names the side it went in for, because naming
  // the player who put it in reads as a scoring record.
  const goal = (item: MatchReportSnapshot['goals'][number], index: number) => <View key={`goal-${index}`} style={styles.line}>
    <Text style={styles.minute}>{at(item.minute)}</Text>
    <View style={styles.lineCopy}>
      <Text style={styles.who}>
        {item.own_goal ? `Own goal — ${item.team}` : item.scorer ?? 'Unnamed'}
        {item.penalty ? ' (pen)' : ''}
      </Text>
      <Text style={styles.meta}>{item.assist ? `Assist ${item.assist} · ${item.team}` : item.team}</Text>
    </View>
  </View>;

  const card = (item: MatchReportSnapshot['cards'][number], index: number) => <View key={`card-${index}`} style={styles.line}>
    <Text style={styles.minute}>{at(item.minute)}</Text>
    <View style={styles.lineCopy}>
      <Text style={styles.who}>{item.player ?? 'Unnamed'}</Text>
      <Text style={styles.meta}>{item.team}</Text>
    </View>
    {/* A word beside the colour, never the colour alone. */}
    <Text style={[styles.card, { backgroundColor: item.colour === 'yellow' ? colors.warning : colors.error, color: colors.onStatus }]}>
      {item.colour === 'yellow' ? 'Yellow' : 'Red'}
    </Text>
  </View>;

  const swap = (item: MatchReportSnapshot['substitutions'][number], index: number) => <View key={`sub-${index}`} style={styles.line}>
    <Text style={styles.minute}>{at(item.minute)}</Text>
    <View style={styles.lineCopy}>
      <Text style={styles.who}>{item.on ?? 'Unnamed'} on</Text>
      <Text style={styles.meta}>
        {item.off ? `${item.off} off` : 'Nobody named off'}
        {item.reason ? ` · ${item.reason.replaceAll('_', ' ')}` : ''}
      </Text>
    </View>
  </View>;

  const missed = (item: MatchReportSnapshot['penalties_missed'][number], index: number) => <View key={`pen-${index}`} style={styles.line}>
    <Text style={styles.minute}>{at(item.minute)}</Text>
    <View style={styles.lineCopy}>
      <Text style={styles.who}>{item.player ?? 'Unnamed'}</Text>
      <Text style={styles.meta}>Penalty {item.outcome?.replaceAll('_', ' ') ?? 'missed'} · {item.team}</Text>
    </View>
  </View>;

  return <View style={styles.stack}>
    <FlatCard radius={theme.radius.lg} style={styles.head}>
      {/* The mark sits on the line above rather than beside the scoreline: on
        * a 375pt phone it takes its width out of the same row as two team
        * names either side of a score, and squeezes the away name to nothing. */}
      <View style={styles.headTop}>
        <Text style={[styles.competition, type('footnote')]}>
          {match.competition ?? 'Friendly'}{match.formation ? ` · ${match.formation}` : ''}
        </Text>
        {brand ? <BrandMark size={40} /> : null}
      </View>
      <View style={styles.scoreRow}>
        <Text numberOfLines={2} style={styles.team}>{match.home}</Text>
        <ScoreLine away={match.away_score} home={match.home_score} />
        <Text numberOfLines={2} style={[styles.team, styles.alignRight]}>{match.away}</Text>
      </View>
      {/* The scoreline is already announced above; this is what a parent
        * skimming the top of the page needs in words. */}
      <Text style={[styles.result, type('footnote')]}>
        {outcome(match.home_score, match.away_score)} · {formatEgyptDateTime(match.kickoff)} · {match.venue}
      </Text>
    </FlatCard>

    {match.man_of_the_match ? <FlatCard radius={theme.radius.md} style={styles.block}>
      <Text style={styles.heading}>Player of the match</Text>
      <Text style={[styles.who, styles.award]}>{match.man_of_the_match}</Text>
    </FlatCard> : null}

    {heading('Goals')}
    {report.goals.length ? <FlatCard radius={theme.radius.md} style={styles.block}>{report.goals.map(goal)}</FlatCard> : empty('No goals were recorded.')}

    {report.cards.length ? <>{heading('Cards')}<FlatCard radius={theme.radius.md} style={styles.block}>{report.cards.map(card)}</FlatCard></> : null}
    {report.penalties_missed.length ? <>{heading('Penalties missed')}<FlatCard radius={theme.radius.md} style={styles.block}>{report.penalties_missed.map(missed)}</FlatCard></> : null}
    {report.substitutions.length ? <>{heading('Substitutions')}<FlatCard radius={theme.radius.md} style={styles.block}>{report.substitutions.map(swap)}</FlatCard></> : null}

    {report.squads.map((squad) => <View key={squad.team} style={styles.stack}>
      {heading(squad.team)}
      <FlatCard radius={theme.radius.md} style={styles.block}>
        {squad.players.map((player) => <View key={player.name} style={styles.line}>
          <Text style={styles.shirt}>{player.jersey_number ?? '—'}</Text>
          <View style={styles.lineCopy}>
            <Text style={styles.who}>{player.name}{player.captain ? ' (C)' : ''}</Text>
            <Text style={styles.meta}>
              {player.position ? positionName(player.position) : 'Position not set'}
              {player.started ? '' : ' · substitute'}
            </Text>
          </View>
          {/* Only what she actually did: a row of noughts beside every name
            * turns a team sheet into a spreadsheet. */}
          <Text style={styles.tally}>
            {[
              player.minutes ? `${player.minutes}'` : null,
              player.goals ? `${player.goals} ${player.goals === 1 ? 'goal' : 'goals'}` : null,
              player.assists ? `${player.assists} ${player.assists === 1 ? 'assist' : 'assists'}` : null,
            ].filter(Boolean).join(' · ')}
          </Text>
        </View>)}
      </FlatCard>
    </View>)}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.sm },
  head: { gap: theme.spacing.sm, padding: theme.spacing.md },
  headTop: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  competition: { color: colors.textMuted, fontSize: theme.type.caption },
  scoreRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  team: { color: colors.textPrimary, flex: 1, fontFamily: theme.font.bold, fontSize: theme.type.body },
  alignRight: { textAlign: 'right' },
  result: { color: colors.textMuted, fontSize: theme.type.caption },

  heading: { color: colors.textSecondary, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 1, marginTop: theme.spacing.xs, textTransform: 'uppercase' },
  block: { gap: theme.spacing.sm, padding: theme.spacing.md },
  line: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.md },
  lineCopy: { flex: 1, minWidth: 0 },
  minute: { color: colors.accentSoft, fontFamily: theme.font.monoBold, fontVariant: ['tabular-nums'], minWidth: 34 },
  shirt: { color: colors.textMuted, fontFamily: theme.font.monoBold, fontVariant: ['tabular-nums'], minWidth: 34, textAlign: 'center' },
  who: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  award: { fontSize: theme.type.body, marginTop: 2 },
  meta: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: 2 },
  tally: { color: colors.textSecondary, fontSize: theme.type.caption, fontVariant: ['tabular-nums'], textAlign: 'right' },
  card: { borderRadius: theme.radius.sm, fontFamily: theme.font.bold, fontSize: theme.type.caption, overflow: 'hidden', paddingHorizontal: theme.spacing.sm, paddingVertical: 2 },
  muted: { color: colors.textMuted },
});
