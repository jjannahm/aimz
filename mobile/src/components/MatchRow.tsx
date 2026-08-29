import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LiveDot } from '@/src/components/MatchStatusIndicator';
import { ScoreLine } from '@/src/components/ScoreLine';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { useMatchClock } from '@/src/lib/matchClock';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Match } from '@/src/types/api';

function kickoffParts(value: string) {
  const parts = new Intl.DateTimeFormat('en-EG', { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(value));
  return {
    time: `${parts.find((part) => part.type === 'hour')?.value ?? ''}:${parts.find((part) => part.type === 'minute')?.value ?? ''}`,
    period: parts.find((part) => part.type === 'dayPeriod')?.value?.toUpperCase() ?? '',
  };
}

export function MatchRow({ match, compact = false }: { match: Match; compact?: boolean }) {
  const styles = useThemedStyles(stylesheet);
  const clock = useMatchClock(match);
  const homeName = match.home_team?.name ?? 'Home';
  const awayName = match.away_team?.name ?? 'Away';
  const kickoff = kickoffParts(match.kickoff_datetime);
  const isLive = match.status === 'live';
  const liveStateLabel = clock.phase === 'extra_time' ? `ET ${clock.minuteLabel ?? ''}`.trim() : clock.minuteLabel ?? 'LIVE';
  const statusText = match.status === 'scheduled'
    ? new Intl.DateTimeFormat('en-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(match.kickoff_datetime))
    : clock.accessibilityLabel;

  return (
    <Pressable
      accessibilityHint="Open match details"
      accessibilityLabel={`${homeName} ${match.home_score}, ${awayName} ${match.away_score}. ${statusText}`}
      accessibilityRole="button"
      onPress={() => router.push(`/match/${match.id}`)}
      style={({ pressed }) => [styles.row, compact && styles.compactRow, pressed && styles.pressed]}
    >
      <View style={styles.teamSide}>
        <Text numberOfLines={2} style={[styles.teamName, styles.homeName]}>{homeName}</Text>
        <TeamAvatar badgeStyle={match.home_team?.badge_style} isAimz={match.home_team?.is_aimz} logoUrl={match.home_team?.logo_url} name={homeName} size={compact ? 32 : 34} />
      </View>

      <View style={styles.center}>
        {match.status === 'scheduled' ? <>
          <View style={styles.kickoffRow}><Text style={styles.kickoff}>{kickoff.time}</Text>{kickoff.period ? <Text style={styles.period}>{kickoff.period}</Text> : null}</View>
          <Text style={styles.secondary}>Scheduled</Text>
        </> : <>
          <ScoreLine away={match.away_score} decorative home={match.home_score} size="row" />
          <View style={[styles.stateBadge, isLive && styles.liveBadge]}>
            {isLive && clock.phase !== 'halftime' ? <LiveDot testID={`live-dot-${match.id}`} /> : null}
            <Text style={[styles.stateText, isLive && styles.liveText]}>{isLive ? liveStateLabel : 'FT'}</Text>
          </View>
        </>}
      </View>

      <View style={styles.teamSide}>
        <TeamAvatar badgeStyle={match.away_team?.badge_style} isAimz={match.away_team?.is_aimz} logoUrl={match.away_team?.logo_url} name={awayName} size={compact ? 32 : 34} />
        <Text numberOfLines={2} style={styles.teamName}>{awayName}</Text>
      </View>
    </Pressable>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', minHeight: 72, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  compactRow: { minHeight: 64, paddingVertical: theme.spacing.xs },
  pressed: { backgroundColor: colors.highlightedSurface, opacity: 0.86 },
  teamSide: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minWidth: 0 },
  teamName: { color: colors.textPrimary, flex: 1, fontFamily: theme.font.semibold, fontSize: theme.type.label, lineHeight: 18 },
  homeName: { textAlign: 'right' },
  center: { alignItems: 'center', justifyContent: 'center', minWidth: 82, paddingHorizontal: 4 },
  kickoffRow: { alignItems: 'baseline', flexDirection: 'row', gap: 3 },
  kickoff: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.body, fontVariant: ['tabular-nums'] },
  period: { color: colors.textSecondary, fontFamily: theme.font.monoBold, fontSize: theme.type.caption },
  secondary: { color: colors.textMuted, fontFamily: theme.font.regular, fontSize: theme.type.caption, marginTop: 1 },
  stateBadge: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: theme.radius.pill, flexDirection: 'row', gap: 5, marginTop: 5, minHeight: 24, paddingHorizontal: 8 },
  liveBadge: { backgroundColor: colors.liveSurface, borderColor: colors.live, borderWidth: 1 },
  stateText: { color: colors.textMuted, fontFamily: theme.font.monoBold, fontSize: theme.type.caption, fontVariant: ['tabular-nums'] },
  liveText: { color: colors.liveText },
});
