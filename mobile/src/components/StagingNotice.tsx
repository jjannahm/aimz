import { StyleSheet, Text, View } from 'react-native';

import { appConfig } from '@/src/config';
import { theme } from '@/src/theme';

export function StagingNotice() {
  if (!appConfig.isStaging) return null;

  return (
    <View accessibilityRole="alert" style={styles.notice}>
      <Text style={styles.title}>STAGING PREVIEW</Text>
      <Text style={styles.copy}>Fictional data only — not for real player information.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: theme.colors.warningSurface,
    borderColor: theme.colors.warning,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  title: {
    color: theme.colors.warningText,
    fontSize: theme.type.caption,
    fontWeight: '900',
    letterSpacing: 1,
  },
  copy: {
    color: theme.colors.textPrimary,
    fontSize: theme.type.label,
    lineHeight: 20,
  },
});
