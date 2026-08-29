import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { getDropdownLayout } from '@/src/components/ChoiceField';
import { noFocusRing, noFocusRingText, theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Player } from '@/src/types/api';

type Anchor = { x: number; y: number; width: number; height: number };
type SelectionMode = 'single' | 'multiple';

const SCREEN_GUTTER = theme.size.phoneGutter;
const OPTION_HEIGHT = 48;

type Props = {
  label: string;
  players: Player[];
  selectedIds: string[];
  selectionMode: SelectionMode;
  onChange: (playerIds: string[]) => void;
  placeholder?: string;
};

/** A compact, searchable roster picker for single-player and parent invites. */
export function PlayerPickerField({ label, players, selectedIds, selectionMode, onChange, placeholder }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [fieldSize, setFieldSize] = useState<{ height: number; width: number }>({ height: theme.size.field, width: 0 });
  const triggerRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const multiple = selectionMode === 'multiple';
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedPlayers = useMemo(() => players.filter((player) => selected.has(player.id)), [players, selected]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = useMemo(
    () => players.filter((player) => player.name.toLocaleLowerCase().includes(normalizedQuery)),
    [normalizedQuery, players],
  );

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
    setQuery('');
    if (Platform.OS === 'web') requestAnimationFrame(() => triggerRef.current?.focus());
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

  const openDropdown = (event: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = event.nativeEvent;
    const width = fieldSize.width || Math.max(0, windowWidth - SCREEN_GUTTER * 2);
    setAnchor({
      x: Number.isFinite(pageX) && Number.isFinite(locationX) ? pageX - locationX : SCREEN_GUTTER,
      y: Number.isFinite(pageY) && Number.isFinite(locationY) ? pageY - locationY : SCREEN_GUTTER,
      width,
      height: fieldSize.height,
    });
    setOpen(true);
  };

  const toggle = (player: Player) => {
    if (!multiple) {
      onChange([player.id]);
      close();
      return;
    }
    const next = selected.has(player.id)
      ? players.filter((item) => item.id !== player.id && selected.has(item.id)).map((item) => item.id)
      : players.filter((item) => item.id === player.id || selected.has(item.id)).map((item) => item.id);
    onChange(next);
  };

  const value = multiple
    ? selectedPlayers.length > 0
      ? `${selectedPlayers.length} ${selectedPlayers.length === 1 ? 'child' : 'children'} selected`
      : placeholder ?? 'Choose children'
    : selectedPlayers[0]?.name ?? placeholder ?? 'Choose a player';
  const dropdownRows = Math.max(1, players.length) + 1 + (multiple ? 1 : 0);
  const dropdown = anchor ? getDropdownLayout(anchor, dropdownRows, windowWidth, windowHeight) : null;

  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityHint={`Opens searchable ${label.toLocaleLowerCase()} choices`}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onLayout={(event) => setFieldSize({ height: event.nativeEvent.layout.height, width: event.nativeEvent.layout.width })}
        onPress={openDropdown}
        ref={triggerRef}
        style={({ pressed }) => [styles.field, open && styles.fieldOpen, pressed && styles.pressed]}
        testID="player-picker-trigger"
      >
        <Text numberOfLines={1} style={[styles.value, selectedPlayers.length === 0 && styles.placeholder]}>{value}</Text>
        <Ionicons accessible={false} color={colors.textMuted} importantForAccessibility="no" name={open ? 'chevron-up' : 'chevron-down'} size={20} />
      </Pressable>

      {multiple && selectedPlayers.length > 0 ? (
        <View accessibilityLabel="Selected children" style={styles.chips} testID="player-picker-chips">
          {selectedPlayers.map((player) => (
            <Pressable
              accessibilityLabel={`Remove ${player.name}`}
              accessibilityRole="button"
              key={player.id}
              onPress={() => toggle(player)}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              testID={`player-picker-chip-${player.id}`}
            >
              <Text numberOfLines={1} style={styles.chipText}>{player.name}</Text>
              <Ionicons accessible={false} color={colors.accentSoft} importantForAccessibility="no" name="close" size={18} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Modal animationType="none" onOrientationChange={measureAnchor} onRequestClose={close} onShow={() => inputRef.current?.focus()} testID="player-picker-modal" transparent visible={open}>
        <View accessibilityViewIsModal style={styles.overlay}>
          <Pressable accessible={false} onPress={close} style={StyleSheet.absoluteFill} testID="player-picker-backdrop" />
          {dropdown ? (
            <View
              accessibilityLabel={`${label} choices`}
              style={[styles.menu, { left: dropdown.left, maxHeight: dropdown.maxHeight, top: dropdown.top, width: dropdown.width }]}
              testID="player-picker-menu"
            >
              <TextInput
                accessibilityLabel={`Search ${label.toLocaleLowerCase()}`}
                autoCapitalize="words"
                autoCorrect={false}
                onChangeText={setQuery}
                placeholder="Search players…"
                placeholderTextColor={colors.textMuted}
                ref={inputRef}
                style={styles.search}
                testID="player-picker-search"
                value={query}
              />
              <ScrollView
                bounces={false}
                contentContainerStyle={styles.optionContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={matches.length * OPTION_HEIGHT > dropdown.maxHeight - OPTION_HEIGHT * (multiple ? 2 : 1)}
                style={styles.options}
                testID="player-picker-options"
              >
                {matches.length === 0 ? <Text style={styles.empty}>No players match that.</Text> : matches.map((player, index) => {
                  const isSelected = selected.has(player.id);
                  return (
                    <Pressable
                      accessibilityLabel={player.name}
                      accessibilityRole={multiple ? 'checkbox' : 'radio'}
                      accessibilityState={multiple ? { checked: isSelected } : { selected: isSelected }}
                      onPress={() => toggle(player)}
                      style={({ pressed }) => [styles.option, index > 0 && styles.optionDivider, isSelected && styles.optionSelected, pressed && styles.optionPressed]}
                      testID={`player-picker-option-${player.id}`}
                      key={player.id}
                    >
                      <Text numberOfLines={1} style={[styles.optionText, isSelected && styles.optionTextSelected]}>{player.name}</Text>
                      <Ionicons
                        accessible={false}
                        color={isSelected ? colors.accentSoft : colors.textMuted}
                        importantForAccessibility="no"
                        name={multiple ? (isSelected ? 'checkbox' : 'square-outline') : (isSelected ? 'radio-button-on' : 'radio-button-off')}
                        size={20}
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>
              {multiple ? <View style={styles.footer}><AppButton compact label="Done" onPress={close} /></View> : null}
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  group: { gap: theme.spacing.xs },
  label: { color: colors.textSecondary, fontFamily: theme.font.semibold, fontSize: theme.type.label },
  field: { ...noFocusRing, alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: theme.size.field, paddingHorizontal: theme.spacing.md },
  fieldOpen: { borderColor: colors.accent, borderWidth: 2 },
  value: { color: colors.textPrimary, flex: 1, fontFamily: theme.font.regular, fontSize: theme.type.body, marginRight: theme.spacing.sm },
  placeholder: { color: colors.textMuted },
  pressed: { opacity: 0.7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chip: { ...noFocusRing, alignItems: 'center', backgroundColor: colors.highlightedSurface, borderColor: colors.accent, borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, maxWidth: '100%', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md },
  chipText: { color: colors.textPrimary, flexShrink: 1, fontFamily: theme.font.semibold, fontSize: theme.type.label },
  overlay: { flex: 1 },
  menu: { backgroundColor: colors.surfaceRaised, borderColor: colors.accent, borderRadius: theme.radius.md, borderWidth: 1, elevation: 12, overflow: 'hidden', position: 'absolute', shadowColor: colors.background, shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.45, shadowRadius: 14 },
  search: { ...noFocusRingText, backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, color: colors.textPrimary, fontFamily: theme.font.regular, fontSize: theme.type.body, minHeight: OPTION_HEIGHT, paddingHorizontal: theme.spacing.md },
  options: { flexGrow: 0, flexShrink: 1 },
  optionContent: { flexGrow: 1 },
  option: { alignItems: 'center', backgroundColor: colors.surfaceRaised, flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between', minHeight: OPTION_HEIGHT, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  optionDivider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  optionSelected: { backgroundColor: colors.highlightedSurface },
  optionPressed: { opacity: 0.72 },
  optionText: { color: colors.textSecondary, flex: 1, fontFamily: theme.font.medium, fontSize: theme.type.body, marginRight: theme.spacing.sm },
  optionTextSelected: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  empty: { color: colors.textMuted, fontFamily: theme.font.regular, padding: theme.spacing.md },
  footer: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, padding: theme.spacing.sm },
});
