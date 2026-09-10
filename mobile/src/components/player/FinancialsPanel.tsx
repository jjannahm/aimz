import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { FEE_STANDING, FEE_TONE } from '@/src/lib/feeStatus';
import { amountOnly, formatEgp, monthName } from '@/src/lib/money';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { FeeStatus } from '@/src/types/api';

/** `2026-09-01` reads as `1 Sep 2026`. */
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The three totals across the top.
 *
 * Its own row rather than the shared `StatGrid`: money needs more room than a
 * count of goals, and the currency is said once underneath instead of three
 * times beside figures that then have nowhere to go. A figure is never
 * truncated — it wraps to a second line before it is cut, because half an
 * amount is worse than a taller card.
 */
function Totals({ due, paid, outstanding, overdue }: { due: number; paid: number; outstanding: number; overdue: boolean }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const figures = [
    { key: 'due', label: 'Total due', tone: colors.textPrimary, value: due },
    { key: 'paid', label: 'Total paid', tone: colors.live, value: paid },
    { key: 'outstanding', label: overdue ? 'Outstanding' : 'Outstanding', tone: outstanding > 0 ? colors.error : colors.textPrimary, value: outstanding },
  ];
  return <FlatCard radius={theme.radius.md} style={styles.totals}>
    <View style={styles.totalsRow}>{figures.map((figure, index) => <View key={figure.key} style={[styles.total, index > 0 && styles.totalDivided]}>
      <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={[styles.totalValue, { color: figure.tone }]}>{amountOnly(figure.value)}</Text>
      <Text numberOfLines={2} style={styles.totalLabel}>{figure.label}</Text>
    </View>)}</View>
    <Text style={styles.currency}>All amounts in EGP</Text>
  </FlatCard>;
}

function Standing({ status }: { status: FeeStatus }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  return <View style={[styles.chip, { borderColor: colors[FEE_TONE[status]] }]}>
    <Text style={[styles.chipText, { color: colors[FEE_TONE[status]] }]}>{FEE_STANDING[status]}</Text>
  </View>;
}

/**
 * One family's money, read from the academy's own ledger.
 *
 * Not a second financial system: every charge and payment here is a row the
 * Manage screen writes, and each standing is worked out by the API on read
 * with the same rule, so a charge cannot say Paid on one screen and Overdue on
 * another.
 *
 * Read-only, on purpose. A family needs to know what is owed and what has
 * arrived; recording a payment is the academy saying it has the money, and
 * that stays with whoever took it.
 */
export function FinancialsPanel({ playerId }: { playerId: string }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const query = useQuery({
    queryKey: [...cacheKeys.financials, playerId],
    queryFn: () => api.playerFinancials(playerId),
    enabled: Boolean(playerId),
  });

  if (query.isLoading) return <LoadingState label="Loading fees" />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as ApiError)?.message ?? 'Fees not found.'} onRetry={() => query.refetch()} />;

  const { summary, items } = query.data;

  return <View style={styles.stack}>
    {items.length ? <Totals
      due={summary.charged_piastres}
      outstanding={summary.outstanding_piastres}
      overdue={summary.overdue > 0}
      paid={summary.paid_piastres}
    /> : null}

    <Text accessibilityRole="header" style={styles.heading}>Payment history</Text>
    {!items.length
      ? <FlatCard radius={theme.radius.md} style={styles.empty}>
        <Text style={styles.emptyText}>Nothing has been charged yet.</Text>
      </FlatCard>
      : items.map((charge) => <FlatCard key={charge.id} radius={theme.radius.md} style={styles.charge}>
        <View style={styles.chargeHead}>
          <Text numberOfLines={2} style={styles.label}>
            {charge.label}{charge.period ? ` · ${monthName(charge.period)}` : ''}
          </Text>
          <Standing status={charge.status} />
        </View>
        <Text style={styles.due}>
          {charge.status === 'not_due' ? `Falls due after ${charge.sessions_required} sessions` : `Due ${shortDate(charge.due_on)}`}
        </Text>

        {/* What the month has actually been earned by. Only a subscription has
          * one: a kit is a kit whether or not anybody trained. */}
        {charge.sessions_attended === null ? null : <Text style={styles.sessions}>
          Training sessions: <Text style={styles.sessionsCount}>{charge.sessions_attended}</Text>
          {charge.sessions_required !== null && charge.sessions_attended < charge.sessions_required
            ? <Text style={styles.sessionsOf}> of {charge.sessions_required}</Text>
            : null}
        </Text>}

        <View style={styles.figures}>
          <View style={styles.figure}><Text style={styles.figureLabel}>Due</Text><Text style={styles.figureValue}>{formatEgp(charge.amount_piastres)}</Text></View>
          <View style={styles.figure}><Text style={styles.figureLabel}>Paid</Text><Text style={[styles.figureValue, { color: colors.live }]}>{formatEgp(charge.paid_piastres)}</Text></View>
          <View style={styles.figure}>
            <Text style={styles.figureLabel}>Balance</Text>
            <Text style={[styles.figureValue, charge.outstanding_piastres > 0 && !charge.voided_at ? { color: colors.error } : null]}>
              {formatEgp(charge.voided_at ? 0 : charge.outstanding_piastres)}
            </Text>
          </View>
        </View>

        {/* Each payment as it was taken. A family that paid in two halves
          * should be able to see both, not only the total. */}
        {charge.payments.map((payment) => <View key={payment.id} style={styles.payment}>
          <Text style={styles.paymentLine}>{shortDate(payment.paid_on)} · {formatEgp(payment.amount_piastres)}</Text>
          {payment.note ? <Text style={styles.paymentNote}>{payment.note}</Text> : null}
        </View>)}

        {charge.voided_at ? <Text style={styles.voided}>
          Cancelled{charge.void_reason ? ` · ${charge.void_reason}` : ''}. Nothing is owed on it.
        </Text> : null}
      </FlatCard>)}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.sm },
  heading: { color: colors.textSecondary, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 1, marginTop: theme.spacing.xs, textTransform: 'uppercase' },

  // The totals get their own card and their own air: three amounts crowded
  // into a tight row is the thing this replaces.
  totals: { padding: 0 },
  totalsRow: { flexDirection: 'row' },
  total: { alignItems: 'center', flexBasis: '33.33%', gap: 4, minWidth: 0, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.md },
  totalDivided: { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth },
  totalValue: { fontFamily: theme.font.monoBold, fontSize: theme.type.body, fontVariant: ['tabular-nums'] },
  totalLabel: { color: colors.textMuted, fontSize: theme.type.caption, textAlign: 'center' },
  // Said once, quietly, instead of three times beside the figures.
  currency: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, color: colors.textMuted, fontSize: theme.type.caption, paddingBottom: theme.spacing.sm, paddingTop: theme.spacing.sm, textAlign: 'center' },

  sessions: { color: colors.textSecondary, fontFamily: theme.font.regular, marginTop: 2 },
  sessionsCount: { color: colors.textPrimary, fontFamily: theme.font.monoBold },
  sessionsOf: { color: colors.textMuted },

  charge: { gap: 4, padding: theme.size.cardPadding },
  chargeHead: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  label: { color: colors.textPrimary, flexShrink: 1, fontFamily: theme.font.semibold },
  due: { color: colors.textMuted, fontFamily: theme.font.mono, fontSize: theme.type.caption },

  figures: { flexDirection: 'row', marginTop: theme.spacing.xs },
  figure: { flexBasis: '33.33%', gap: 2, minWidth: 0 },
  figureLabel: { color: colors.textMuted, fontSize: theme.type.caption },
  figureValue: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontVariant: ['tabular-nums'] },

  payment: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, marginTop: theme.spacing.xs, paddingTop: theme.spacing.xs },
  paymentLine: { color: colors.textSecondary, fontFamily: theme.font.mono, fontSize: theme.type.caption },
  paymentNote: { color: colors.textMuted, fontFamily: theme.font.regular, fontSize: theme.type.caption },
  voided: { color: colors.textMuted, fontFamily: theme.font.regular, marginTop: theme.spacing.xs },

  chip: { borderRadius: theme.radius.pill, borderWidth: 1, paddingHorizontal: theme.spacing.sm, paddingVertical: 2 },
  chipText: { fontFamily: theme.font.bold, fontSize: theme.type.caption },

  empty: { padding: theme.size.cardPadding },
  emptyText: { color: colors.textMuted, fontFamily: theme.font.regular, lineHeight: 21 },
});
