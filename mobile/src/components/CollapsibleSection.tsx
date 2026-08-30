import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SearchField } from '@/src/components/SearchField';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = {
  children: ReactNode;
  /** Shown beside the title so a collapsed section still says how much it hides. */
  count?: number;
  defaultOpen?: boolean;
  /**
   * When given, a magnifier sits beside the count and opens a box that narrows
   * the section's own rows. The section holds no list of its own, so the text
   * belongs to whoever passes the children and does the filtering.
   */
  search?: {
    value: string;
    onChange: (value: string) => void;
    label?: string;
    placeholder?: string;
    /** How many rows are left, announced as the list narrows. */
    resultCount?: number;
  };
  /** `group` is the smaller uppercase label used inside a section that already has a heading. */
  size?: 'heading' | 'group';
  title: string;
};

/**
 * An in-page section header that hides its own content. CollapsibleCard is the
 * bordered card equivalent used by Settings; this one carries no chrome so it
 * can sit inside a section that already has some.
 */
export function CollapsibleSection({ children, count, defaultOpen = false, search, size = 'heading', title }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const [expanded, setExpanded] = useState(defaultOpen);
  const [searching, setSearching] = useState(false);

  // Searching a folded section would hide the very rows being looked for, so the
  // magnifier unfolds it too. Putting the box away restores the whole list.
  const toggleSearch = () => {
    if (searching) search?.onChange('');
    else setExpanded(true);
    setSearching((current) => !current);
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${title.toLowerCase()}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((current) => !current)}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
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
        {search ? <Pressable
          accessibilityLabel={`${searching ? 'Hide the search for' : 'Search'} ${title.toLowerCase()}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: searching }}
          hitSlop={theme.spacing.xs}
          onPress={toggleSearch}
          style={({ pressed }) => [styles.searchToggle, pressed && styles.pressed]}
          testID="section-search-toggle"
        >
          <Ionicons
            accessibilityElementsHidden
            color={searching ? colors.accent : colors.accentSoft}
            name={searching ? 'close' : 'search'}
            size={size === 'group' ? 16 : 20}
          />
        </Pressable> : null}
      </View>
      {expanded ? <View style={styles.content}>
        {search && searching ? <SearchField autoFocus {...search} /> : null}
        {children}
      </View> : null}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  section: { gap: theme.spacing.sm },
  header: { alignItems: 'center', flexDirection: 'row', minHeight: theme.touch.minimum },
  toggle: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.touch.minimum },
  // A square of its own beside the count, wide enough to hit without crowding it.
  searchToggle: { alignItems: 'center', justifyContent: 'center', minHeight: theme.touch.minimum, width: theme.touch.minimum },
  pressed: { opacity: 0.7 },
  title: { color: colors.textPrimary, flex: 1, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  groupTitle: { color: colors.textSecondary, fontSize: theme.type.label, letterSpacing: 0.6, textTransform: 'uppercase' },
  count: { color: colors.accentSoft, fontFamily: theme.font.monoBold, fontVariant: ['tabular-nums'] },
  groupCount: { fontSize: theme.type.label },
  content: { gap: theme.spacing.sm },
});
