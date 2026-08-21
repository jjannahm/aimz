import { StyleSheet, Text, View } from 'react-native';

import { MatchRow } from '@/src/components/MatchRow';
import { initialsFor } from '@/src/components/TeamAvatar';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { CompetitionMatchGroup } from '@/src/lib/matchGroups';

export function CompetitionGroup({ group }: { group: CompetitionMatchGroup }) {
  const styles = useThemedStyles(stylesheet);
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

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 52, paddingHorizontal: theme.spacing.md },
  crest: { alignItems: 'center', backgroundColor: colors.highlightedSurface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, height: 28, justifyContent: 'center', width: 28 },
  initials: { color: colors.accentSoft, fontSize: 10, fontWeight: '900' },
  name: { color: colors.textPrimary, flex: 1, fontSize: theme.type.label, fontWeight: '800' },
  headerDivider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
  rowDivider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginHorizontal: theme.spacing.md },
});
