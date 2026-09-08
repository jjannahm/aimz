import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { ReportCard } from '@/src/components/ReportCard';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * The reports written about this family, for the people they are about.
 *
 * The server answers with the reader's own children and nothing else, and only
 * ones that have been published — a draft is a coach still deciding what to
 * say. Most parents are signed in, so this is where they will read them; the
 * shared link exists for the ones who are not.
 */
export function ReportsSection() {
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  const linked = user?.role === 'parent' || Boolean(user?.player_id);
  const [selected, setSelected] = React.useState(0);
  const reports = useQuery({ queryKey: [...cacheKeys.reports, 'mine'], queryFn: () => api.playerReports('?limit=50'), enabled: linked });

  if (!linked) return <EmptyState body="Ask an AIMZ administrator to link your account to your squad player." title="Account not linked" />;
  if (reports.isLoading) return <LoadingState label="Loading reports" />;
  if (reports.isError) return <ErrorState message={(reports.error as ApiError).message} onRetry={() => reports.refetch()} />;
  const items = reports.data?.items ?? [];
  if (!items.length) return <EmptyState body="Your coach has not shared a report yet." title="No reports" />;

  const options = items.map((report, index) => ({ label: report.player?.name ?? report.title, value: String(index) }));
  const shown = items[Math.min(selected, items.length - 1)]!;
  return <View style={styles.stack}>
    {/* A family with more than one child, or a term's worth of reports, picks
      * between them; a single report needs no chooser at all. */}
    {items.length > 1 ? <SegmentedControl label="Report" onChange={(value) => setSelected(Number(value))} options={options} value={String(Math.min(selected, items.length - 1))} /> : null}
    <ReportCard report={shown} />
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.md },
});
