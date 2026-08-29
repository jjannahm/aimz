import { StyleSheet, Text, View } from 'react-native';

import { MatchRow } from '@/src/components/MatchRow';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { CompetitionMatchGroup } from '@/src/lib/matchGroups';

export function CompetitionGroup({ group }: { group: CompetitionMatchGroup }) {
  const styles = useThemedStyles(stylesheet);
  return (
    <View style={styles.card}>
      <View style={styles.header}>
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

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: 40, paddingHorizontal: theme.spacing.md },
  name: { color: colors.textSecondary, flex: 1, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 1.2, textTransform: 'uppercase' },
  headerDivider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
  rowDivider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginHorizontal: theme.spacing.md },
});
