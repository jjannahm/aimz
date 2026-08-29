import { useMutation, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { showToast } from '@/src/lib/platformAlert';
import { POSITIONS, positionName } from '@/src/lib/positions';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Team } from '@/src/types/api';

/** One typed line, once it has been read. */
export interface ParsedPlayer {
  line: number;
  name: string;
  position: string;
  jersey: number | null;
  /** What is wrong with it, or null when it is good to send. */
  problem: string | null;
}

const CODES = new Set(POSITIONS.map((position) => position.code));

/**
 * Reads a pasted squad, one player per line.
 *
 * `Name, Position, Number` — the number optional. Every line is checked here
 * and shown back before anything is sent, because the API writes the whole
 * squad or none of it and a rejection after the fact tells an admin very little
 * about which of twenty lines was wrong.
 */
export function parseSquad(text: string): ParsedPlayer[] {
  const seen = new Set<number>();
  return text.split('\n').map((raw, index) => {
    const [name = '', position = '', jersey = ''] = raw.split(',').map((part) => part.trim());
    const line = index + 1;
    const blank = { line, name, position: position.toUpperCase(), jersey: null, problem: null } as ParsedPlayer;
    if (!raw.trim()) return { ...blank, problem: 'blank' };
    if (name.length < 2) return { ...blank, problem: 'Give the player a name.' };
    const code = position.toUpperCase();
    if (!code) return { ...blank, position: code, problem: 'Name a position, for example ST.' };
    if (!CODES.has(code)) return { ...blank, position: code, problem: `“${position}” is not a position.` };
    let number: number | null = null;
    if (jersey) {
      const parsed = Number(jersey.replace(/^#/u, ''));
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 99) return { ...blank, position: code, problem: 'A number is 0 to 99.' };
      // The API refuses a clash against the squad, but two identical numbers in
      // one paste would only be caught after the whole batch was rejected.
      if (seen.has(parsed)) return { ...blank, position: code, jersey: parsed, problem: `Number ${parsed} is used twice here.` };
      seen.add(parsed);
      number = parsed;
    }
    return { line, name, position: code, jersey: number, problem: null };
  }).filter((row) => row.problem !== 'blank');
}

/**
 * A whole squad at once.
 *
 * Adding twenty players one form at a time was the longest job in the app.
 */
export function BulkPlayerImport({ teams }: { teams: Team[] }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [teamId, setTeamId] = React.useState('');
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const rows = React.useMemo(() => parseSquad(text), [text]);
  const good = rows.filter((row) => !row.problem);
  const bad = rows.filter((row) => row.problem);

  const save = useMutation({
    mutationFn: () => api.createPlayers(teamId, good.map((row) => ({ name: row.name, position: row.position, jersey_number: row.jersey }))),
    onError: (failure) => setError((failure as ApiError).message),
    onSuccess: async (created) => {
      setError(null);
      setText('');
      showToast(`Added ${created.length} ${created.length === 1 ? 'player' : 'players'}`);
      await invalidateAfterWrite(client, 'player');
    },
  });

  const blocked = !teamId || !good.length || bad.length > 0;

  return <View style={styles.card}>
    <Text style={styles.heading}>Add many players</Text>
    <Text style={styles.copy}>One player per line, as <Text style={styles.code}>Name, Position, Number</Text>. The number is optional.</Text>
    <ChoiceField
      label="Squad"
      onChange={setTeamId}
      options={teams.filter((team) => team.is_aimz && team.is_active).map((team) => ({ label: team.name, value: team.id }))}
      placeholder="Choose a squad"
      value={teamId}
    />
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    <TextInput
      accessibilityLabel="Players, one per line"
      autoCapitalize="words"
      autoCorrect={false}
      multiline
      onChangeText={setText}
      placeholder={'Nour Hassan, ST, 9\nSalma Adel, GK, 1\nHabiba Tarek, LWB, 3'}
      style={styles.input}
      testID="bulk-input"
      value={text}
    />
    {rows.length ? <View style={styles.preview} testID="bulk-preview">
      {rows.map((row) => <View key={row.line} style={styles.row}>
        <Text style={styles.lineNumber}>{row.line}</Text>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowName, row.problem && styles.rowNameBad]}>{row.name || '—'}</Text>
          <Text style={styles.rowMeta}>
            {row.problem ?? `${positionName(row.position)}${row.jersey === null ? '' : ` · #${row.jersey}`}`}
          </Text>
        </View>
      </View>)}
    </View> : null}
    {bad.length ? <Text accessibilityLiveRegion="polite" style={styles.error}>
      Fix {bad.length === 1 ? 'the line above' : `the ${bad.length} lines above`} before adding — the squad is written in one go, or not at all.
    </Text> : null}
    <AppButton
      disabled={blocked}
      label={good.length ? `Add ${good.length} ${good.length === 1 ? 'player' : 'players'}` : 'Add players'}
      loading={save.isPending}
      onPress={() => save.mutate()}
    />
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.lg },
  heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontFamily: theme.font.bold },
  copy: { color: colors.textSecondary, lineHeight: 22 },
  code: { color: colors.accentSoft, fontFamily: theme.font.semibold },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: colors.textPrimary, fontSize: theme.type.body, minHeight: 140, padding: theme.spacing.md, textAlignVertical: 'top' },
  preview: { backgroundColor: colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.sm },
  row: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  lineNumber: { color: colors.textMuted, fontSize: theme.type.caption, fontVariant: ['tabular-nums'], width: 20 },
  rowCopy: { flex: 1 },
  rowName: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  rowNameBad: { color: colors.errorText },
  rowMeta: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: 2 },
  error: { color: colors.errorText, lineHeight: 20 },
});
