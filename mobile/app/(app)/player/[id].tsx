import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';

import { CloseButton } from '@/src/components/CloseButton';
import { Screen } from '@/src/components/Screen';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export default function PlayerDetailScreen() {
  const styles = useThemedStyles(stylesheet);
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({ queryKey: ['player-stats', id], queryFn: () => api.playerStats(id), enabled: Boolean(id) });
  return <Screen action={<CloseButton />} title={query.data?.player.name ?? 'Player stats'}>
    {query.isLoading ? <LoadingState /> : query.isError || !query.data ? <ErrorState message={(query.error as ApiError)?.message ?? 'Player not found.'} onRetry={() => query.refetch()} /> : <><View style={styles.profile}>{query.data.player.photo_url ? <Image accessibilityLabel={`${query.data.player.name} profile photo`} source={{ uri: query.data.player.photo_url }} style={styles.profilePhoto} /> : <View style={styles.number}><Text style={styles.numberText}>{query.data.player.jersey_number ?? '–'}</Text></View>}<View><Text style={styles.position}>{query.data.player.position}</Text><Text style={styles.season}>{query.data.season ?? 'All recorded seasons'}</Text></View></View><View style={styles.grid}>{[{ label: 'Appearances', value: query.data.appearances }, { label: 'Minutes', value: query.data.minutes_played }, { label: 'Goals', value: query.data.goals }, { label: 'Assists', value: query.data.assists }, { label: 'Yellow cards', value: query.data.yellow_cards }, { label: 'Red cards', value: query.data.red_cards }].map((item) => <View key={item.label} style={styles.stat}><Text style={styles.value}>{item.value}</Text><Text style={styles.label}>{item.label}</Text></View>)}</View><Text style={styles.heading}>Match breakdown</Text>{query.data.matches.length === 0 ? <Text style={styles.empty}>No finished-match statistics yet.</Text> : query.data.matches.map((item) => <View key={item.id} style={styles.match}><Text style={styles.matchTitle}>{item.minutes_played} minutes</Text><Text style={styles.matchMeta}>{item.goals} goals · {item.assists} assists · {item.yellow_cards + item.red_cards} cards</Text></View>)}</>}
  </Screen>;
}
const stylesheet = (colors: ThemeColors) => StyleSheet.create({ profile: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, padding: theme.spacing.lg }, profilePhoto: { borderRadius: 32, height: 64, width: 64 }, number: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 32, height: 64, justifyContent: 'center', width: 64 }, numberText: { color: colors.onAccent, fontSize: theme.type.display, fontWeight: '900' }, position: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, season: { color: colors.textMuted, marginTop: 4 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }, stat: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, minWidth: '47%', padding: theme.spacing.md }, value: { color: colors.textPrimary, fontSize: theme.type.score, fontVariant: ['tabular-nums'], fontWeight: '900' }, label: { color: colors.textMuted, marginTop: 2 }, heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, empty: { color: colors.textMuted }, match: { backgroundColor: colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md }, matchTitle: { color: colors.textPrimary, fontWeight: '800' }, matchMeta: { color: colors.textMuted, marginTop: 4 } });
