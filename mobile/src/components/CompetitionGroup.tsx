import { StyleSheet, Text, View } from 'react-native';

import { MatchRow } from '@/src/components/MatchRow';
import { initialsFor } from '@/src/components/TeamAvatar';
import { theme } from '@/src/theme';
import type { CompetitionMatchGroup } from '@/src/lib/matchGroups';

export function CompetitionGroup({ group }: { group: CompetitionMatchGroup }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View accessibilityElementsHidden style={styles.crest}><Text style={styles.initials}>{initialsFor(group.competitionName)}</Text></View>
        <Text numberOfLines={1} style={styles.name}>{group.competitionName}</Text>
      </View>
      <View style={styles.headerDivider} />
      {group.matches.map((match, index) => (
        <View key={match.id}>
          {index > 0 ? <View style={styles.rowDivider} /> : null}
          <MatchRow match={match} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 52, paddingHorizontal: theme.spacing.md },
  crest: { alignItems: 'center', backgroundColor: theme.colors.highlightedSurface, borderColor: theme.colors.border, borderRadius: 14, borderWidth: 1, height: 28, justifyContent: 'center', width: 28 },
  initials: { color: theme.colors.lightBlue, fontSize: 10, fontWeight: '900' },
  name: { color: theme.colors.textPrimary, flex: 1, fontSize: theme.type.label, fontWeight: '800' },
  headerDivider: { backgroundColor: theme.colors.border, height: StyleSheet.hairlineWidth },
  rowDivider: { backgroundColor: theme.colors.border, height: StyleSheet.hairlineWidth, marginHorizontal: theme.spacing.md },
});
