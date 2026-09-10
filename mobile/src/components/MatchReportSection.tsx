import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { CollapsibleSection } from '@/src/components/CollapsibleSection';
import { MatchReportCard } from '@/src/components/MatchReportCard';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { matchHeadline, matchReportShareUrl, shareMatchReport } from '@/src/lib/matchReportLink';
import { confirmAction, showMessage, showToast } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * The report on a finished match, and the address for sending it out.
 *
 * The summary itself is for anybody who can open the match — it is what
 * happened, and a parent reading it in the app is the point. Sending it to a
 * group is the academy's decision, so the share row is an administrator's, and
 * the API refuses the write regardless of what this renders.
 */
export function MatchReportSection({ matchId }: { matchId: string }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const { user } = useAuth();
  const canShare = user?.role === 'admin' || user?.role === 'coach';
  const query = useQuery({ queryKey: cacheKeys.matchReport(matchId), queryFn: () => api.matchReport(matchId) });

  const act = (run: () => Promise<unknown>, done: string) => async () => {
    try { await run(); await invalidateAfterWrite(client, 'match-report'); showToast(done); }
    catch (error) { showMessage('Report not changed', (error as ApiError).message); }
  };
  const publish = useMutation({
    mutationFn: () => api.publishMatchReport(matchId),
    onError: (error) => showMessage('Could not share', (error as ApiError).message),
    onSuccess: async (report) => {
      await invalidateAfterWrite(client, 'match-report');
      const { home, home_score, away_score, away } = report.snapshot.match;
      if (report.share_token) await shareMatchReport(report.share_token, matchHeadline(home, home_score, away_score, away));
    },
  });

  if (query.isLoading) return <LoadingState label="Loading the match report" />;
  if (query.isError || !query.data) {
    return <ErrorState message={(query.error as ApiError)?.message ?? 'The match report could not be loaded.'} onRetry={() => query.refetch()} />;
  }

  const report = query.data;
  const { home, home_score, away_score, away } = report.snapshot.match;
  const shared = Boolean(report.share_token);

  const share = async () => {
    if (!report.share_token) return;
    try { await shareMatchReport(report.share_token, matchHeadline(home, home_score, away_score, away)); }
    catch (error) { showMessage('Could not share', (error as Error).message); }
  };

  return <CollapsibleSection defaultOpen title="Match report">
    <MatchReportCard report={report.snapshot} size="panel" />

    {canShare ? <View style={styles.share}>
      {shared ? <>
        <Text selectable style={styles.link}>{matchReportShareUrl(report.share_token!)}</Text>
        <Text style={styles.note}>
          {report.first_opened_at ? 'Opened by somebody with the link.' : 'Not opened yet.'} Anybody with this address can read it.
          {' '}It says what it said when it was sent — share again to bring a correction to the same address.
        </Text>
        <View style={styles.actions}>
          <AppButton compact icon="share-outline" label="Share again" onPress={share} />
          {Platform.OS === 'web' ? <AppButton compact label="Print" onPress={() => window.print()} variant="secondary" /> : null}
          <AppButton compact label="Update link" loading={publish.isPending} onPress={() => publish.mutate()} variant="secondary" />
          <AppButton compact label="New link" onPress={() => confirmAction('Replace the link?', 'The address already sent will stop working.', 'Replace', act(() => api.newMatchReportLink(matchId), 'New link made'), { destructive: true })} variant="secondary" />
          <AppButton compact label="Stop sharing" onPress={() => confirmAction('Stop sharing this report?', 'The link stops working. The report itself stays here.', 'Stop sharing', act(() => api.withdrawMatchReport(matchId), 'Link withdrawn'), { destructive: true })} variant="danger" />
        </View>
      </> : <>
        <Text style={styles.note}>Sharing makes a private address for this report and hands it to WhatsApp. Anybody with the address can read it.</Text>
        <AppButton icon="share-outline" label="Share match report" loading={publish.isPending} onPress={() => publish.mutate()} />
      </>}
    </View> : null}
  </CollapsibleSection>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  share: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  link: { color: colors.accentSoft, fontSize: theme.type.caption },
  note: { color: colors.textMuted, fontSize: theme.type.caption, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
});
