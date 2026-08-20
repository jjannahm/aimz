import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { TeamAvatar } from '@/src/components/TeamAvatar';
import { theme } from '@/src/theme';
import { MatchProgressRail, MatchStatusIndicator } from '@/src/components/MatchStatusIndicator';
import { useMatchClock } from '@/src/lib/matchClock';

import type { Match } from '@/src/types/api';

export type MatchCardData = Match;

type MatchCardProps = {
  match: MatchCardData;
};

export function MatchCard({ match }: MatchCardProps) {
  const isLive = match.status === 'live';
  const hasScore = match.status !== 'scheduled';
  const clock = useMatchClock(match);
  const statusLabel = match.status === 'scheduled'
    ? new Intl.DateTimeFormat('en-EG', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(match.kickoff_datetime))
    : clock.accessibilityLabel;
  const homeName = match.home_team?.name ?? 'Home';
  const awayName = match.away_team?.name ?? 'Away';

  return (
    <Pressable
      accessibilityHint="Open match details"
      accessibilityLabel={`${homeName} ${match.home_score}, ${awayName} ${match.away_score}. ${statusLabel}`}
      accessibilityRole="button"
      onPress={() => router.push(`/match/${match.id}`)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.metaRow}>
        <Text numberOfLines={1} style={styles.competition}>
          {match.competition?.name ?? 'AIMZ match'}
        </Text>
        <View style={[styles.statusPill, isLive && styles.livePill]}>
          {match.status === 'scheduled' ? <Text style={styles.statusText}>{statusLabel}</Text> : <MatchStatusIndicator clock={clock} muted={!isLive} />}
        </View>
      </View>

      <View style={styles.scoreRow}>
        <View style={styles.teamColumn}>
          <TeamAvatar logoUrl={match.home_team?.logo_url} name={homeName} size={44} tone="accent" />
          <Text style={styles.teamName}>{homeName}</Text>
        </View>

        <View style={styles.scoreColumn}>
          {hasScore ? (
            <Text style={styles.score}>
              {match.home_score}–{match.away_score}
            </Text>
          ) : (
            <Text style={styles.vs}>VS</Text>
          )}
          <Text numberOfLines={1} style={styles.venue}>
            {match.venue}
          </Text>
        </View>

        <View style={[styles.teamColumn, styles.awayTeamColumn]}>
          <TeamAvatar logoUrl={match.away_team?.logo_url} name={awayName} size={44} tone="light" />
          <Text style={[styles.teamName, styles.awayTeamName]}>{awayName}</Text>
        </View>
      </View>

      {isLive ? (
        <View style={styles.liveRail}>
          <MatchProgressRail clock={clock} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    minHeight: 186,
    overflow: 'hidden',
    padding: theme.spacing.md,
  },
  pressed: { opacity: 0.76 },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'space-between',
  },
  competition: {
    color: theme.colors.textSecondary,
    flex: 1,
    fontSize: theme.type.caption,
    fontWeight: '700',
  },
  statusPill: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.pill,
    minHeight: 28,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
  },
  livePill: {
    backgroundColor: theme.colors.liveSurface,
    borderColor: theme.colors.live,
    borderWidth: 1,
  },
  statusText: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.caption,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  liveText: { color: theme.colors.liveText },
  scoreRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.lg,
  },
  teamColumn: {
    alignItems: 'flex-start',
    flex: 1,
    gap: theme.spacing.sm,
  },
  awayTeamColumn: { alignItems: 'flex-end' },
  teamName: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.label,
    fontWeight: '800',
    maxWidth: 108,
  },
  awayTeamName: { textAlign: 'right' },
  scoreColumn: {
    alignItems: 'center',
    flex: 1.2,
    paddingHorizontal: theme.spacing.sm,
  },
  score: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.score,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
    letterSpacing: -1,
  },
  vs: {
    color: theme.colors.textSecondary,
    fontSize: theme.type.heading,
    fontWeight: '900',
  },
  venue: {
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: theme.spacing.xs,
    maxWidth: 130,
  },
  liveRail: {
    height: 3,
    marginHorizontal: -theme.spacing.md,
    marginBottom: -theme.spacing.md,
  },
});
