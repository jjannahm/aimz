import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { getDropdownLayout } from '@/src/components/ChoiceField';
import { matchPositions, positionName, type PositionDefinition } from '@/src/lib/positions';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

type Anchor = { x: number; y: number; width: number; height: number };

const SCREEN_GUTTER = theme.spacing.md;
const OPTION_HEIGHT = 48;

/**
 * A position, chosen by typing the start of it.
 *
 * Sixteen positions is too many to scroll a picker through and few enough that
 * a letter or two narrows it to a handful, so this is a text field with the
 * matches under it: "l" offers LB, LWB, LM and LW. Only a position from the
 * vocabulary can be committed — the API refuses anything else — so what is
 * typed is a query, and the value only changes when one is picked.
 */
export function PositionField({ label = 'Position', value, onChange, error, hint }: {
  label?: string;
  value: string;
  onChange: (code: string) => void;
  error?: string;
  hint?: string;
}) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [fieldSize, setFieldSize] = useState({ height: 52, width: 0 });
  const triggerRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const matches = matchPositions(query);

  const measureAnchor = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof trigger.measureInWindow !== 'function') return;
    trigger.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setAnchor({ x, y, width, height });
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setAnchor(null);
    // The query was a way of finding a position, not a value of its own: what
    // is committed is whatever was picked, so abandoned typing is dropped.
    setQuery('');
  }, []);

  useEffect(() => {
    if (open) measureAnchor();
  }, [measureAnchor, open, windowHeight, windowWidth]);

  useEffect(() => {
    if (!open || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close, open]);

  const openList = () => {
    setAnchor({ x: SCREEN_GUTTER, y: SCREEN_GUTTER, width: fieldSize.width || Math.max(0, windowWidth - SCREEN_GUTTER * 2), height: fieldSize.height });
    setOpen(true);
    measureAnchor();
  };

  const pick = (position: PositionDefinition) => {
    onChange(position.code);
    close();
  };

  const dropdown = anchor ? getDropdownLayout(anchor, matches.length, windowWidth, windowHeight) : null;

  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityHint="Type the first letters of a position to find it"
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onLayout={(event) => setFieldSize({ height: event.nativeEvent.layout.height, width: event.nativeEvent.layout.width })}
        onPress={openList}
        ref={triggerRef}
        style={({ pressed }) => [styles.field, error && styles.fieldError, open && styles.fieldOpen, pressed && styles.pressed]}
        testID="position-trigger"
      >
        <Text numberOfLines={1} style={[styles.value, !value && styles.placeholder]}>
          {value ? `${value} · ${positionName(value)}` : 'Choose a position'}
        </Text>
        <Ionicons accessible={false} color={colors.textMuted} importantForAccessibility="no" name="chevron-down" size={20} />
      </Pressable>
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}

      <Modal animationType="none" onOrientationChange={measureAnchor} onRequestClose={close} onShow={() => inputRef.current?.focus()} testID="position-modal" transparent visible={open}>
        <View accessibilityViewIsModal style={styles.overlay}>
          <Pressable accessible={false} onPress={close} style={StyleSheet.absoluteFill} testID="position-backdrop" />
          {dropdown ? (
            <View style={[styles.menu, { left: dropdown.left, maxHeight: dropdown.maxHeight + OPTION_HEIGHT, top: dropdown.top, width: dropdown.width }]} testID="position-menu">
              <TextInput
                accessibilityLabel={`${label}, type to search`}
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={setQuery}
                placeholder="Type a position…"
                placeholderTextColor={colors.textMuted}
                ref={inputRef}
                style={styles.search}
                testID="position-search"
                value={query}
              />
              <ScrollView bounces={false} contentContainerStyle={styles.options} keyboardShouldPersistTaps="handled" nestedScrollEnabled testID="position-options">
                {matches.length === 0 ? (
                  <Text style={styles.empty}>No position matches that.</Text>
                ) : matches.map((position, index) => {
                  const isSelected = position.code === value;
                  return (
                    <Pressable
                      accessibilityLabel={`${position.code}, ${position.name}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      key={position.code}
                      onPress={() => pick(position)}
                      style={({ pressed }) => [styles.option, index > 0 && styles.optionDivider, isSelected && styles.optionSelected, pressed && styles.optionPressed]}
                      testID={`position-option-${position.code}`}
                    >
                      <Text style={styles.code}>{position.code}</Text>
                      <Text numberOfLines={1} style={[styles.optionText, isSelected && styles.optionTextSelected]}>{position.name}</Text>
                      {isSelected ? <Ionicons accessible={false} color={colors.accentSoft} importantForAccessibility="no" name="checkmark" size={20} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  group: { gap: theme.spacing.xs },
  label: { color: colors.textSecondary, fontSize: theme.type.label, fontFamily: theme.font.semibold },
  field: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: theme.size.field, paddingHorizontal: theme.spacing.md },
  fieldError: { borderColor: colors.error },
  fieldOpen: { borderColor: colors.accent },
  value: { color: colors.textPrimary, flex: 1, fontSize: theme.type.body, marginRight: theme.spacing.sm },
  placeholder: { color: colors.textMuted },
  error: { color: colors.errorText, fontSize: theme.type.caption },
  hint: { color: colors.textMuted, fontSize: theme.type.caption },
  pressed: { opacity: 0.7 },
  overlay: { flex: 1 },
  menu: { backgroundColor: colors.surfaceRaised, borderColor: colors.accent, borderRadius: theme.radius.md, borderWidth: 1, elevation: 12, overflow: 'hidden', position: 'absolute', shadowColor: colors.background, shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.45, shadowRadius: 14 },
  search: { backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, color: colors.textPrimary, fontSize: theme.type.body, minHeight: OPTION_HEIGHT, paddingHorizontal: theme.spacing.md },
  options: { flexGrow: 1 },
  option: { alignItems: 'center', backgroundColor: colors.surfaceRaised, flexDirection: 'row', gap: theme.spacing.sm, minHeight: OPTION_HEIGHT, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  optionDivider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  optionSelected: { backgroundColor: colors.highlightedSurface },
  optionPressed: { opacity: 0.72 },
  // Fixed width so the names line up in a column whatever the code's length.
  code: { color: colors.accentSoft, fontSize: theme.type.label, fontFamily: theme.font.bold, width: 38 },
  optionText: { color: colors.textSecondary, flex: 1, fontSize: theme.type.body, fontFamily: theme.font.semibold },
  optionTextSelected: { color: colors.textPrimary },
  empty: { color: colors.textMuted, padding: theme.spacing.md },
});
