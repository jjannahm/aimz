import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { ReportCard } from '@/src/components/ReportCard';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * A report, opened by whoever was given the address.
 *
 * Outside the `(app)` group on purpose: that group's layout sends anybody
 * without a session to the sign-in screen, and the whole point of this page is
 * that a parent does not need one. It asks for nothing but the token in the
 * path, and the API answers that call unauthenticated.
 *
 * Not wrapped in `Screen` either — that draws a settings gear and assumes
 * somebody is signed in.
 */
export default function SharedReportScreen() {
  const styles = useThemedStyles(stylesheet);
  const { token } = useLocalSearchParams<{ token: string }>();
  const report = useQuery({
    queryKey: ['shared-report', token],
    queryFn: () => api.sharedReport(token),
    enabled: Boolean(token),
    retry: false,
  });

  return <ScrollView contentContainerStyle={styles.page} style={styles.screen}>
    {report.isLoading ? <LoadingState label="Opening the report" />
      : report.isError || !report.data
        // One message for a wrong address, a replaced one and a withdrawn
        // report: the page cannot say which, and a parent only needs to know
        // to ask the academy for a new link.
        ? <ErrorState
          message={(report.error as ApiError)?.status === 404
            ? 'This report is no longer available. Ask the academy for a new link.'
            : (report.error as ApiError)?.message ?? 'This report could not be opened.'}
          onRetry={() => report.refetch()}
        />
        : <>
          <ReportCard brand report={report.data} size="page" />
          {/* No PDF library anywhere in this app, and none needed: the browser
            * prints this page, and Save as PDF is inside its own dialog. */}
          {Platform.OS === 'web' ? <View style={styles.print}>
            <AppButton icon="print-outline" label="Print or save as PDF" onPress={() => window.print()} variant="secondary" />
          </View> : null}
          <Text style={styles.privacy}>This page is private to whoever has its address. Please do not forward it.</Text>
        </>}
  </ScrollView>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  screen: { backgroundColor: colors.background },
  page: { gap: theme.spacing.sm, maxWidth: 760, padding: theme.spacing.lg, width: '100%' },
  print: { marginTop: theme.spacing.sm },
  privacy: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: theme.spacing.sm },
});
