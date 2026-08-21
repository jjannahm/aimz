import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = {
  children: ReactNode;
  onCollapse?: () => void;
  summary: string;
  title: string;
};

export function CollapsibleCard({ children, onCollapse, summary, title }: Props) {
  const styles = useThemedStyles(stylesheet);
  const [expanded, setExpanded] = useState(false);
  const action = expanded ? 'Hide' : 'Show';

  const toggle = () => {
    if (expanded) onCollapse?.();
    setExpanded((current) => !current);
  };

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityLabel={`${action} ${title.toLowerCase()} form`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={toggle}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <View style={styles.headerCopy}>
          <Text style={styles.heading}>{title}</Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
        <Text style={styles.action}>{action}</Text>
      </Pressable>
      {expanded ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  action: { color: colors.accentSoft, flexShrink: 0, fontSize: theme.type.label, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, padding: theme.spacing.lg },
  content: { gap: theme.spacing.md, paddingTop: theme.spacing.lg },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.md, justifyContent: 'space-between', minHeight: theme.touch.minimum },
  headerCopy: { flex: 1, gap: theme.spacing.xs },
  heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' },
  pressed: { opacity: 0.7 },
  summary: { color: colors.textMuted, fontSize: theme.type.label },
});
