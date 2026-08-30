import { useMutation, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { CollapsibleCard } from '@/src/components/CollapsibleCard';
import { FormField } from '@/src/components/FormField';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { confirmAction, showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Competition } from '@/src/types/api';

/**
 * "2025/26" to "2026/27", where the season reads that way.
 *
 * A guess, offered in an editable field rather than imposed: seasons are named
 * differently in different competitions, and this only saves typing.
 */
export function nextSeasonName(season: string): string {
  const split = /^(\d{4})\s*\/\s*(\d{2,4})$/u.exec(season.trim());
  if (split) {
    const start = Number(split[1]) + 1;
    const end = split[2]!.length === 2 ? String((Number(split[2]) + 1) % 100).padStart(2, '0') : String(Number(split[2]) + 1);
    return `${start}/${end}`;
  }
  const year = /^(\d{4})$/u.exec(season.trim());
  return year ? String(Number(year[1]) + 1) : '';
}

/**
 * Ending a season, and starting the one after it.
 *
 * Ending changes nothing but a flag: the table, the results and the statistics
 * stay where they are, and the season simply stops accepting anything new.
 */
export function SeasonControls({ competitions }: { competitions: Competition[] }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [chosen, setChosen] = React.useState('');
  const [season, setSeason] = React.useState('');
  const competition = competitions.find((item) => item.id === chosen) ?? competitions[0];
  const completed = competition?.status === 'completed';

  React.useEffect(() => { setSeason(competition ? nextSeasonName(competition.season) : ''); }, [competition?.id, competition?.season]);

  const refresh = async () => { await invalidateAfterWrite(client, 'competition'); };
  const end = useMutation({
    mutationFn: () => api.completeSeason(competition!.id),
    onError: (error) => showMessage('Season not ended', (error as ApiError).message),
    onSuccess: refresh,
  });
  const reopen = useMutation({
    mutationFn: () => api.reopenSeason(competition!.id),
    onError: (error) => showMessage('Season not reopened', (error as ApiError).message),
    onSuccess: refresh,
  });
  const start = useMutation({
    mutationFn: (carry: boolean) => api.startNextSeason(competition!.id, season.trim(), carry),
    onError: (error) => showMessage('Season not started', (error as ApiError).message),
    onSuccess: refresh,
  });

  if (!competition) return null;
  return <CollapsibleCard summary={`${competition.name} ${competition.season}${completed ? ' · ended' : ''}`} title="Seasons">
    <View style={styles.body}>
      <ChoiceField
        label="Competition"
        onChange={setChosen}
        options={competitions.map((item) => ({ label: `${item.name} ${item.season}${item.status === 'completed' ? ' · ended' : ''}`, value: item.id }))}
        value={competition.id}
      />
      <Text style={styles.note}>
        {completed
          ? 'This season has ended. Its table, results and statistics are final, and nothing can be scored into it until it is reopened.'
          : 'Ending a season keeps everything it holds and stops anything new being scored into it.'}
      </Text>
      {completed
        ? <AppButton
          disabled={reopen.isPending}
          label="Reopen this season"
          onPress={() => confirmAction('Reopen this season?', 'Results and statistics can be changed again while it is open.', 'Reopen', () => reopen.mutate())}
          variant="secondary"
        />
        : <AppButton
          disabled={end.isPending}
          label="End this season"
          onPress={() => confirmAction(`End ${competition.name} ${competition.season}?`, 'Nothing is deleted. The table, results and statistics stay as they are, and no more can be scored into the season until you reopen it.', 'End season', () => end.mutate())}
          variant="secondary"
        />}

      <View style={styles.divider} />
      <Text style={styles.subheading}>Start the next season</Text>
      <FormField label="Season" onChangeText={setSeason} placeholder={nextSeasonName(competition.season) || '2027/28'} value={season} />
      <Text style={styles.note}>
        A new season of {competition.name}, with the same format. {competition.season} is left exactly as it is.
      </Text>
      <View style={styles.actions}>
        <AppButton
          disabled={!season.trim() || start.isPending}
          label="Start with the same clubs"
          onPress={() => confirmAction(`Start ${competition.name} ${season.trim()}?`, `The clubs in ${competition.season} are copied across — names, crests and age groups. Players are not, since a squad is not the same people a year later.`, 'Start season', () => start.mutate(true))}
          style={styles.flexButton}
        />
        <AppButton
          disabled={!season.trim() || start.isPending}
          label="Start empty"
          onPress={() => start.mutate(false)}
          variant="ghost"
        />
      </View>
    </View>
  </CollapsibleCard>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  body: { gap: theme.spacing.sm },
  subheading: { color: colors.textPrimary, fontFamily: theme.font.bold },
  note: { color: colors.textMuted, fontSize: theme.type.caption, lineHeight: 18 },
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginVertical: theme.spacing.xs },
  actions: { flexDirection: 'row', gap: theme.spacing.sm },
  flexButton: { flex: 1 },
});
