import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = {
  children: ReactNode;
  onCollapse?: () => void;
  /** Told whenever the header is pressed, so a parent can hold the state itself. */
  onOpenChange?: (open: boolean) => void;
  /**
   * When given, the parent decides whether the card is open and the card keeps
   * no state of its own. Manage needs this: pressing Edit on a list row has to
   * unfold a form that is already mounted and shut, which an internal `useState`
   * cannot be asked to do.
   */
  open?: boolean;
  summary: string;
  title: string;
  /** `raised` is the lighter panel the Manage forms are drawn on. */
  tone?: 'surface' | 'raised';
};

export function CollapsibleCard({ children, onCollapse, onOpenChange, open, summary, title, tone = 'surface' }: Props) {
  const styles = useThemedStyles(stylesheet);
  const [selfOpen, setSelfOpen] = useState(false);
  const expanded = open ?? selfOpen;
  const action = expanded ? 'Hide' : 'Show';

  const toggle = () => {
    const next = !expanded;
    if (!next) onCollapse?.();
    if (open === undefined) setSelfOpen(next);
    onOpenChange?.(next);
  };

  return (
    <View style={[styles.card, tone === 'raised' && styles.raised]}>
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
  action: { color: colors.accentSoft, flexShrink: 0, fontFamily: theme.font.bold, fontSize: theme.type.label },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, padding: theme.size.cardPadding },
  raised: { backgroundColor: colors.surfaceRaised },
  content: { gap: theme.spacing.md, paddingTop: theme.spacing.lg },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.md, justifyContent: 'space-between', minHeight: theme.touch.minimum },
  headerCopy: { flex: 1, gap: theme.spacing.xs },
  heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  pressed: { opacity: 0.7 },
  summary: { color: colors.textMuted, fontFamily: theme.font.regular, fontSize: theme.type.label },
});
