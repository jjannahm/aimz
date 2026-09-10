import { useMutation, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { CollapsibleCard } from '@/src/components/CollapsibleCard';
import { FormField } from '@/src/components/FormField';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { invoiceShareUrl, shareInvoice } from '@/src/lib/invoiceLink';
import { formatEgp, monthName } from '@/src/lib/money';
import { showMessage, showToast } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { FeeInvoice } from '@/src/types/api';

async function send(invoice: FeeInvoice) {
  if (!invoice.share_token) return;
  try { await shareInvoice(invoice.share_token, invoice.player_name ?? 'your child', invoice.snapshot.totals.outstanding_piastres); }
  catch (error) { showMessage('Could not share', (error as Error).message); }
}

/** One invoice, made for one family, and handed straight to the share sheet. */
export function SendInvoiceButton({ playerId, playerName, paymentInstructions }: { playerId: string; playerName: string; paymentInstructions: string }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [made, setMade] = React.useState<FeeInvoice | null>(null);
  const create = useMutation({
    mutationFn: () => api.createInvoice(playerId, { payment_instructions: paymentInstructions || null }),
    onError: (error) => showMessage('No invoice made', (error as ApiError).message),
    onSuccess: async (invoice) => { setMade(invoice); await invalidateAfterWrite(client, 'fee'); await send(invoice); },
  });

  return <View style={styles.inline}>
    <AppButton compact icon="share-outline" label={made ? 'Send again' : 'Send invoice'} loading={create.isPending} onPress={() => made ? void send(made) : create.mutate()} variant="secondary" />
    {made?.share_token ? <Text selectable style={styles.link}>{made.reference} · {invoiceShareUrl(made.share_token)}</Text> : null}
  </View>;
}

/**
 * The monthly run: one invoice for everybody in the squad who owes something.
 *
 * Each family gets an address of its own — an invoice names a child and what
 * they owe, so there is nothing here that could be sent to a group. They are
 * shared one at a time, which is what WhatsApp does anyway.
 */
export function InvoiceRun({ teamId, teamName, period, paymentInstructions, onPaymentInstructions }: {
  teamId: string; teamName: string; period: string; paymentInstructions: string; onPaymentInstructions: (value: string) => void;
}) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [made, setMade] = React.useState<FeeInvoice[] | null>(null);

  const run = useMutation({
    mutationFn: () => api.createSquadInvoices(teamId, { period, payment_instructions: paymentInstructions || null }),
    onError: (error) => showMessage('No invoices made', (error as ApiError).message),
    onSuccess: async (result) => {
      setMade(result.items);
      await invalidateAfterWrite(client, 'fee');
      // Saying what was skipped is the difference between "nobody owed
      // anything" and silence, which looks like the button did nothing.
      showToast(result.items.length
        ? `${result.items.length} ${result.items.length === 1 ? 'invoice' : 'invoices'} made${result.skipped ? `, ${result.skipped} owed nothing` : ''}`
        : 'Nobody in this squad owes anything');
    },
  });

  return <CollapsibleCard
    onOpenChange={setOpen}
    open={open}
    summary={`One invoice each for whoever owes, for ${monthName(period)}.`}
    title="Invoice the squad"
    tone="raised"
  >
    <FormField
      hint="Optional. Printed on every invoice this makes — an InstaPay handle, a bank account, or where to hand cash in."
      label="How to pay"
      multiline
      onChangeText={onPaymentInstructions}
      placeholder="InstaPay to aimz@bank, or cash at the Maadi office"
      value={paymentInstructions}
    />
    <Text style={styles.note}>
      A month is only owed once its fourth session has been attended, so anybody whose month the academy has not earned yet is skipped rather than billed.
    </Text>
    <AppButton
      icon="document-text-outline"
      label={`Invoice ${teamName} for ${monthName(period)}`}
      loading={run.isPending}
      onPress={() => run.mutate()}
    />

    {made ? made.length ? <View style={styles.results}>
      {made.map((invoice) => <View key={invoice.id} style={styles.result}>
        <View style={styles.copy}>
          <Text style={styles.name}>{invoice.player_name ?? 'Player'}</Text>
          <Text style={styles.meta}>{formatEgp(invoice.snapshot.totals.outstanding_piastres)} · {invoice.reference}</Text>
        </View>
        <AppButton compact icon="share-outline" label="Send" onPress={() => void send(invoice)} variant="secondary" />
      </View>)}
    </View> : <Text style={styles.note}>Nobody in this squad owes anything for {monthName(period)}.</Text> : null}
  </CollapsibleCard>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  inline: { gap: theme.spacing.xs, marginTop: theme.spacing.sm },
  link: { color: colors.accentSoft, fontSize: theme.type.caption },
  note: { color: colors.textMuted, fontSize: theme.type.caption, lineHeight: 18 },
  results: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  result: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: theme.radius.md, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  meta: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: 2 },
});
