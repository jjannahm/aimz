import { StyleSheet, View } from 'react-native';

import { SeasonPicker } from '@/src/components/SeasonPicker';
import { theme } from '@/src/theme';

/** Every season at once, which is what the stats are read for by default. */
export const ALL_SEASONS = 'All stats';

/**
 * Which season a player's stats are read for.
 *
 * One control for both the player reading their own and an admin reading
 * theirs, so the two screens filter the same way and say the same words. It
 * draws nothing at all until there is a season to choose, since "All stats" on
 * its own is not a choice.
 */
export function SeasonFilter({ seasons, value, onChange }: { seasons: string[]; value: string; onChange: (season: string) => void }) {
  if (!seasons.length) return null;
  return <View style={styles.row}>
    <SeasonPicker onChange={onChange} season={value} seasons={[ALL_SEASONS, ...seasons]} />
  </View>;
}

/** The season to ask the API for: nothing at all when every one is wanted. */
export const seasonQuery = (value: string, seasons: string[]): string | undefined =>
  seasons.includes(value) ? value : undefined;

const styles = StyleSheet.create({ row: { alignItems: 'flex-start', marginBottom: theme.spacing.xs } });
