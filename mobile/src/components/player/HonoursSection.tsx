import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { TrophyIcon } from '@/src/components/TrophyIcon';
import { api, ApiError } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Honour } from '@/src/types/api';

/** "5 goals", and one of anything drops the s. */
const amount = (value: number, unit: string) => `${value} ${value === 1 ? unit.replace(/s$/u, '') : unit}`;

/**
 * Everything this player has won, newest season first.
 *
 * Honours are worked out from the record rather than stored, so a season still
 * being played says so: an award that could still change hands is not yet a
 * thing she won, and the cabinet would be lying if it said otherwise.
 */
export function HonoursSection({ playerId }: { playerId: string }) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const query = useQuery({ queryKey: ['player-honours', playerId], queryFn: () => api.playerHonours(playerId), enabled: Boolean(playerId) });

  if (query.isLoading) return <LoadingState label="Loading honours" />;
  if (query.isError) return <ErrorState message={(query.error as ApiError).message} onRetry={() => query.refetch()} />;
  const honours = query.data?.honours ?? [];
  if (!honours.length) return null;

  // Grouped by season so a cabinet reads as a career rather than a flat list.
  const seasons = new Map<string, Honour[]>();
  for (const honour of honours) {
    const bucket = seasons.get(honour.competition.season);
    if (bucket) bucket.push(honour); else seasons.set(honour.competition.season, [honour]);
  }

  return <View style={styles.section} testID="honours-section">
    <Text accessibilityRole="header" style={styles.heading}>Honours</Text>
    {[...seasons.entries()].map(([season, won]) => <View key={season} style={styles.season}>
      <Text style={styles.seasonLabel}>{season}</Text>
      <FlatCard radius={theme.radius.md} style={styles.list}>
        {won.map((honour, index) => <View key={`${honour.competition.id}-${honour.metric}`} style={[styles.row, index > 0 && styles.rowDivider]} testID={`honour-${honour.metric}`}>
          <TrophyIcon dimmed={!honour.is_final} size={20} />
          <View style={styles.copy}>
            <Text style={styles.label}>{honour.label}</Text>
            <Text style={styles.meta}>
              {honour.competition.name}
              {honour.team ? ` · ${honour.team.name}` : ''}
              {' · '}{amount(honour.value, honour.unit)}
            </Text>
          </View>
          {honour.is_final
            ? <Ionicons accessibilityLabel="Final" color={colors.accentSoft} name="checkmark-circle" size={18} />
            : <Text style={styles.provisional}>In progress</Text>}
        </View>)}
      </FlatCard>
    </View>)}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  section: { gap: theme.spacing.sm },
  heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontFamily: theme.font.bold },
  season: { gap: theme.spacing.xs },
  seasonLabel: { color: colors.textSecondary, fontSize: theme.type.label, fontFamily: theme.font.semibold },
  list: { paddingHorizontal: theme.spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.touch.minimum, paddingVertical: theme.spacing.sm },
  rowDivider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  copy: { flex: 1 },
  label: { color: colors.textPrimary, fontFamily: theme.font.bold },
  meta: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: 2 },
  provisional: { color: colors.textMuted, fontSize: theme.type.caption, fontFamily: theme.font.semibold },
});
