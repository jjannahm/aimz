import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { theme } from '@/src/theme';

export default function PlayersScreen() {
  const query = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100') });
  return <Screen eyebrow="Academy roster" scroll={false} title="Players">
    {query.isLoading ? <LoadingState label="Loading players" /> : query.isError ? <ErrorState message={(query.error as ApiError).message} onRetry={() => query.refetch()} /> : !query.data?.items.length ? <EmptyState body="Admin-added roster players will appear here." title="No roster yet" /> : <FlatList contentContainerStyle={styles.listContent} data={query.data.items} keyExtractor={(player) => player.id} renderItem={({ item: player }) => <Pressable accessibilityLabel={`${player.name}, ${player.position}, number ${player.jersey_number ?? 'not assigned'}`} accessibilityRole="button" onPress={() => router.push(`/player/${player.id}`)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>{player.photo_url ? <Image accessibilityElementsHidden source={{ uri: player.photo_url }} style={styles.photo} /> : <View accessibilityElementsHidden style={styles.number}><Text style={styles.numberText}>{player.jersey_number ?? '–'}</Text></View>}<View style={styles.copy}><Text style={styles.name}>{player.name}</Text><Text style={styles.position}>{player.position}</Text></View><Ionicons accessibilityElementsHidden color={theme.colors.textMuted} name="chevron-forward" size={20} /></Pressable>} showsVerticalScrollIndicator={false} style={styles.list} />}
  </Screen>;
}
const styles = StyleSheet.create({ list: { borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, flex: 1, overflow: 'hidden' }, listContent: { paddingBottom: theme.spacing.xl }, row: { alignItems: 'center', backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 72, padding: theme.spacing.md }, pressed: { opacity: 0.7 }, number: { alignItems: 'center', backgroundColor: theme.colors.surfaceRaised, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, photo: { borderRadius: 24, height: 48, width: 48 }, numberText: { color: theme.colors.lightBlue, fontSize: theme.type.heading, fontWeight: '900' }, copy: { flex: 1 }, name: { color: theme.colors.textPrimary, fontSize: theme.type.body, fontWeight: '800' }, position: { color: theme.colors.textMuted, marginTop: 3 } });
