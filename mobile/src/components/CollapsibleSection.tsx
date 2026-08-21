import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = {
  children: ReactNode;
  /** Shown beside the title so a collapsed section still says how much it hides. */
  count?: number;
  defaultOpen?: boolean;
  /** `group` is the smaller uppercase label used inside a section that already has a heading. */
  size?: 'heading' | 'group';
  title: string;
};

/**
 * An in-page section header that hides its own content. CollapsibleCard is the
 * bordered card equivalent used by Settings; this one carries no chrome so it
 * can sit inside a section that already has some.
 */
export function CollapsibleSection({ children, count, defaultOpen = false, size = 'heading', title }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${title.toLowerCase()}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.accentSoft}
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={size === 'group' ? 14 : 18}
        />
        <Text style={[styles.title, size === 'group' && styles.groupTitle]}>{title}</Text>
        {count === undefined ? null : <Text style={[styles.count, size === 'group' && styles.groupCount]}>{count}</Text>}
      </Pressable>
      {expanded ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  section: { gap: theme.spacing.sm },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.touch.minimum },
  pressed: { opacity: 0.7 },
  title: { color: colors.textPrimary, flex: 1, fontSize: theme.type.heading, fontWeight: '900' },
  groupTitle: { color: colors.textSecondary, fontSize: theme.type.label, letterSpacing: 0.6, textTransform: 'uppercase' },
  count: { color: colors.accentSoft, fontVariant: ['tabular-nums'], fontWeight: '900' },
  groupCount: { fontSize: theme.type.label },
  content: { gap: theme.spacing.sm },
});
