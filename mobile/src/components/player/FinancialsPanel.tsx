import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { StatGrid, type Stat } from '@/src/components/StatGrid';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { FEE_STANDING, FEE_TONE } from '@/src/lib/feeStatus';
import { formatEgp, formatEgpRound } from '@/src/lib/money';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { FeeStatus } from '@/src/types/api';

/** `2026-09-01` reads as `1 Sep 2026`. */
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

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
  // Rounded on the summary, exact on each charge: the three figures at the top
  // are for taking in at a glance, and the pounds are what matter there. A
  // single charge is a specific amount somebody has to pay.
  const totals: Stat[] = [
    { key: 'charged', label: 'Total due', value: formatEgpRound(summary.charged_piastres) },
    { key: 'paid', label: 'Total paid', value: formatEgpRound(summary.paid_piastres), tone: colors.live },
    {
      key: 'outstanding',
      label: summary.overdue > 0 ? 'Outstanding, overdue' : 'Outstanding',
      value: formatEgpRound(summary.outstanding_piastres),
      tone: summary.outstanding_piastres > 0 ? colors.error : undefined,
    },
  ];

  return <View style={styles.stack}>
    {items.length ? <StatGrid stats={totals} /> : null}

    <Text accessibilityRole="header" style={styles.heading}>Payment history</Text>
    {!items.length
      ? <FlatCard radius={theme.radius.md} style={styles.empty}>
        <Text style={styles.emptyText}>Nothing has been charged yet.</Text>
      </FlatCard>
      : items.map((charge) => <FlatCard key={charge.id} radius={theme.radius.md} style={styles.charge}>
        <View style={styles.chargeHead}>
          <Text numberOfLines={2} style={styles.label}>{charge.label}</Text>
          <Standing status={charge.status} />
        </View>
        <Text style={styles.due}>Due {shortDate(charge.due_on)}</Text>

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
