import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { InvoiceCard } from '@/src/components/InvoiceCard';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * An invoice, opened by the family who was given the address.
 *
 * Outside the `(app)` group for the same reason both report pages are: that
 * group's layout sends anybody without a session to the sign-in screen, and
 * the whole point of this page is that a parent does not need one.
 *
 * Not wrapped in `Screen` either — that draws a settings gear and assumes
 * somebody is signed in.
 */
export default function SharedInvoiceScreen() {
  const styles = useThemedStyles(stylesheet);
  const { token } = useLocalSearchParams<{ token: string }>();
  const invoice = useQuery({
    queryKey: ['shared-invoice', token],
    queryFn: () => api.sharedInvoice(token),
    enabled: Boolean(token),
    retry: false,
  });

  return <ScrollView contentContainerStyle={styles.page} style={styles.screen}>
    {invoice.isLoading ? <LoadingState label="Opening the invoice" />
      : invoice.isError || !invoice.data
        // One message for a wrong address, a replaced one and a withdrawn
        // invoice: the page cannot say which, and a parent only needs to know
        // to ask the academy for a new link.
        ? <ErrorState
          message={(invoice.error as ApiError)?.status === 404
            ? 'This invoice is no longer available. Ask the academy for a new link.'
            : (invoice.error as ApiError)?.message ?? 'This invoice could not be opened.'}
          onRetry={() => invoice.refetch()}
        />
        : <>
          <InvoiceCard brand invoice={invoice.data.snapshot} size="page" />
          {/* No PDF library anywhere in this app, and none needed: the browser
            * prints this page, and Save as PDF is inside its own dialog. */}
          {Platform.OS === 'web' ? <View style={styles.print}>
            <AppButton icon="print-outline" label="Print or save as PDF" onPress={() => window.print()} variant="secondary" />
          </View> : null}
          <Text style={styles.privacy}>
            Issued by {invoice.data.issued_by_name}. This page is private to whoever has its address. Please do not forward it.
          </Text>
        </>}
  </ScrollView>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  screen: { backgroundColor: colors.background },
  page: { gap: theme.spacing.sm, maxWidth: 760, padding: theme.spacing.lg, width: '100%' },
  print: { marginTop: theme.spacing.sm },
  privacy: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: theme.spacing.sm },
});
