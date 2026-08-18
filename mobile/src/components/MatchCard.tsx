import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { theme } from '@/src/theme';

import type { Match } from '@/src/types/api';

export type MatchCardData = Match;

type MatchCardProps = {
  match: MatchCardData;
};

export function MatchCard({ match }: MatchCardProps) {
  const isLive = match.status === 'live';
  const hasScore = match.status !== 'scheduled';
  const statusLabel = isLive
    ? 'LIVE'
    : match.status === 'finished'
      ? 'FULL TIME'
      : new Intl.DateTimeFormat('en-EG', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(match.kickoff_datetime));
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
          <Text style={[styles.statusText, isLive && styles.liveText]}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <View style={styles.teamColumn}>
          {match.home_team?.logo_url ? <Image accessibilityLabel={`${homeName} logo`} source={{ uri: match.home_team.logo_url }} style={styles.crest} /> : <View accessibilityElementsHidden style={[styles.crest, styles.homeCrest]} />}
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
          {match.away_team?.logo_url ? <Image accessibilityLabel={`${awayName} logo`} source={{ uri: match.away_team.logo_url }} style={styles.crest} /> : <View accessibilityElementsHidden style={[styles.crest, styles.awayCrest]} />}
          <Text style={[styles.teamName, styles.awayTeamName]}>{awayName}</Text>
        </View>
      </View>

      {isLive ? (
        <View style={styles.liveRail}>
          <View style={styles.liveProgress} />
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
  crest: {
    borderRadius: 22,
    height: 44,
    width: 44,
  },
  homeCrest: { backgroundColor: theme.colors.accent },
  awayCrest: { backgroundColor: theme.colors.lightBlue },
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
    backgroundColor: theme.colors.progressTrack,
    height: 3,
    marginHorizontal: -theme.spacing.md,
    marginBottom: -theme.spacing.md,
  },
  liveProgress: {
    backgroundColor: theme.colors.live,
    height: 3,
    width: '72%',
  },
});
