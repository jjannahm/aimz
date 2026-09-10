import { StyleSheet, Text, View } from 'react-native';

import { BrandMark } from '@/src/components/BrandMark';
import { FlatCard } from '@/src/components/FlatCard';
import { FEE_STANDING, FEE_TONE } from '@/src/lib/feeStatus';
import { formatEgp, monthName } from '@/src/lib/money';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { InvoiceSnapshot } from '@/src/types/api';

type InvoiceSize = 'panel' | 'page';

/** `2026-09-05` reads as `5 September 2026`. */
function readable(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC', year: 'numeric' });
}

/**
 * An invoice, as it is read.
 *
 * The same component behind both ways of reading one: the admin's preview in
 * the fees ledger, and the page a shared link opens. It takes a plain snapshot
 * and nothing else — no hooks, no queries, no account — because the second of
 * those has no session to read anything with.
 *
 * Money is shown to the piastre here rather than rounded. A report says how a
 * term went; an invoice says what to pay, and a family transferring it needs
 * the exact figure.
 */
export function InvoiceCard({ invoice, size = 'page', brand = false }: { invoice: InvoiceSnapshot; size?: InvoiceSize; brand?: boolean }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const big = size === 'page';

  return <View style={styles.stack}>
    <FlatCard radius={theme.radius.lg} style={styles.head}>
      <View style={styles.headTop}>
        <View style={styles.headText}>
          <Text accessibilityRole="header" style={[styles.title, big && styles.titlePage]}>Invoice</Text>
          <Text style={styles.reference}>{invoice.reference}</Text>
        </View>
        {brand ? <BrandMark size={40} /> : null}
      </View>
      <View style={styles.who}>
        <Text style={styles.name}>{invoice.player.name}</Text>
        <Text style={styles.meta}>
          {invoice.squad.name ?? 'No squad'}{invoice.squad.branch ? ` · ${invoice.squad.branch}` : ''}
        </Text>
        <Text style={styles.meta}>Issued {readable(invoice.issued_on)}</Text>
      </View>
    </FlatCard>

    {/* The one figure somebody opened this to find, before the breakdown. */}
    <FlatCard radius={theme.radius.md} style={styles.total}>
      <Text style={styles.totalLabel}>{invoice.totals.overdue > 0 ? 'Total due, overdue' : 'Total due'}</Text>
      <Text style={[styles.totalValue, big && styles.totalValuePage, { color: invoice.totals.overdue > 0 ? colors.error : colors.textPrimary }]}>
        {formatEgp(invoice.totals.outstanding_piastres)}
      </Text>
      {invoice.totals.paid_piastres > 0 ? <Text style={styles.meta}>
        {formatEgp(invoice.totals.paid_piastres)} already received against these charges.
      </Text> : null}
    </FlatCard>

    <Text accessibilityRole="header" style={styles.heading}>What this covers</Text>
    <FlatCard radius={theme.radius.md} style={styles.block}>
      {invoice.lines.map((line, index) => <View key={`${line.label}-${line.period ?? index}`} style={[styles.line, index > 0 && styles.divided]}>
        <View style={styles.lineCopy}>
          <Text style={styles.lineLabel}>{line.label}{line.period ? ` · ${monthName(line.period)}` : ''}</Text>
          <Text style={styles.meta}>Due {readable(line.due_on)}</Text>
          {line.paid_piastres > 0 ? <Text style={styles.meta}>{formatEgp(line.amount_piastres)} charged, {formatEgp(line.paid_piastres)} paid</Text> : null}
        </View>
        <View style={styles.lineRight}>
          <Text style={styles.lineValue}>{formatEgp(line.balance_piastres)}</Text>
          {/* The word, not the colour: the standing has to survive being read
            * out and being printed in black and white. */}
          <View style={[styles.chip, { borderColor: colors[FEE_TONE[line.status]] }]}>
            <Text style={[styles.chipText, { color: colors[FEE_TONE[line.status]] }]}>{FEE_STANDING[line.status]}</Text>
          </View>
        </View>
      </View>)}
    </FlatCard>

    {invoice.payment_instructions ? <>
      <Text accessibilityRole="header" style={styles.heading}>How to pay</Text>
      <FlatCard radius={theme.radius.md} style={styles.block}>
        <Text selectable style={styles.instructions}>{invoice.payment_instructions}</Text>
      </FlatCard>
    </> : null}

    {/* Said out loud rather than silently left off: a parent comparing this
      * against what they can see in the app should not have to wonder why a
      * month they know about is missing. */}
    {invoice.not_due_yet > 0 ? <Text style={styles.footnote}>
      {invoice.not_due_yet === 1 ? 'One further month is' : `${invoice.not_due_yet} further months are`} not on this invoice: the academy charges for coaching, and a month is only due once its fourth session has been attended.
    </Text> : null}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.sm },
  head: { gap: theme.spacing.md, padding: theme.spacing.md },
  headTop: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  headText: { flex: 1, gap: 2, minWidth: 0 },
  title: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  titlePage: { fontSize: theme.type.display },
  reference: { color: colors.textMuted, fontFamily: theme.font.mono, fontSize: theme.type.caption },
  who: { gap: 2 },
  name: { color: colors.textPrimary, fontFamily: theme.font.semibold, fontSize: theme.type.body },
  meta: { color: colors.textMuted, fontSize: theme.type.caption },

  total: { alignItems: 'center', gap: theme.spacing.xs, padding: theme.spacing.lg },
  totalLabel: { color: colors.textMuted, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 1, textTransform: 'uppercase' },
  totalValue: { fontFamily: theme.font.monoBold, fontSize: theme.type.heading, fontVariant: ['tabular-nums'] },
  totalValuePage: { fontSize: theme.type.display },

  heading: { color: colors.textSecondary, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 1, marginTop: theme.spacing.xs, textTransform: 'uppercase' },
  block: { padding: theme.spacing.md },
  line: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
  divided: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  lineCopy: { flex: 1, gap: 2, minWidth: 0 },
  lineLabel: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  lineRight: { alignItems: 'flex-end', gap: 4 },
  lineValue: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontVariant: ['tabular-nums'] },
  chip: { borderRadius: theme.radius.pill, borderWidth: 1, paddingHorizontal: theme.spacing.sm, paddingVertical: 2 },
  chipText: { fontFamily: theme.font.bold, fontSize: theme.type.caption },

  instructions: { color: colors.textPrimary, lineHeight: 22 },
  footnote: { color: colors.textMuted, fontSize: theme.type.caption, lineHeight: 18, marginTop: theme.spacing.xs },
});
