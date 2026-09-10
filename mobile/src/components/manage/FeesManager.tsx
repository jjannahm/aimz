import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { CollapsibleCard } from '@/src/components/CollapsibleCard';
import { CollapsibleSection } from '@/src/components/CollapsibleSection';
import { FormField } from '@/src/components/FormField';
import { PlayerPickerField } from '@/src/components/PlayerPickerField';
import { narrowBySearch } from '@/src/components/SearchField';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { confirmManageWrite } from '@/src/lib/manageToasts';
import { formatEgp, parseEgp, poundsOf } from '@/src/lib/money';
import { confirmAction, showMessage, showToast } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { FeeCharge, FeeStatus, PaymentMethod, Player, Team } from '@/src/types/api';
import { FEE_STANDING, FEE_TONE } from '@/src/lib/feeStatus';


const METHODS: { label: string; value: PaymentMethod }[] = [
  { label: 'Cash', value: 'cash' },
  { label: 'InstaPay', value: 'instapay' },
  { label: 'Bank transfer', value: 'bank_transfer' },
  { label: 'Other', value: 'other' },
];

/** The last twelve months, newest first, as the API writes them. */
function recentPeriods(): { label: string; value: string }[] {
  const now = new Date();
  return Array.from({ length: 12 }, (unused, index) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    return {
      label: month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      value: `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`,
    };
  });
}

function Standing({ status }: { status: FeeStatus }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  return <View style={[styles.chip, { borderColor: colors[FEE_TONE[status]] }]}>
    <Text style={[styles.chipText, { color: colors[FEE_TONE[status]] }]}>{FEE_STANDING[status]}</Text>
  </View>;
}

/**
 * One family's standing for the month, opening into what they were charged and
 * what they have paid.
 */
function PlayerLedger({ playerId, name, outstanding, status }: { playerId: string; name: string; outstanding: number; status: FeeStatus }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const [open, setOpen] = React.useState(false);
  const charges = useQuery({
    queryKey: [...cacheKeys.fees, 'player', playerId],
    queryFn: () => api.feeCharges(`?player_id=${encodeURIComponent(playerId)}&limit=100`),
    enabled: open,
  });
  return <View style={styles.card}>
    <Pressable
      accessibilityLabel={`${name}, ${FEE_STANDING[status].toLowerCase()}, ${formatEgp(outstanding)} outstanding`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((current) => !current)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.copy}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.meta}>{outstanding > 0 ? `${formatEgp(outstanding)} outstanding` : 'Nothing owed'}</Text>
      </View>
      <Standing status={status} />
    </Pressable>
    {open ? <View style={styles.ledger}>
      {charges.isLoading ? <LoadingState /> : charges.isError ? <ErrorState message={(charges.error as ApiError).message} onRetry={() => charges.refetch()} />
        : !charges.data?.items.length ? <Text style={styles.empty}>Nothing has been charged to this player.</Text>
          : charges.data.items.map((charge) => <ChargeRow charge={charge} key={charge.id} />)}
    </View> : null}
  </View>;
}

/** One charge, and the money taken against it. */
function ChargeRow({ charge }: { charge: FeeCharge }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [paying, setPaying] = React.useState(false);
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState<PaymentMethod>('cash');
  const full = useQuery({ queryKey: [...cacheKeys.fees, 'charge', charge.id], queryFn: () => api.feeCharge(charge.id), enabled: paying });

  const record = useMutation({
    mutationFn: () => {
      const piastres = parseEgp(amount);
      if (piastres === null || piastres <= 0) throw new Error('Enter the amount received.');
      return api.recordFeePayment(charge.id, { amount_piastres: piastres, method });
    },
    onError: (error) => showMessage('Payment not recorded', (error as Error).message),
    onSuccess: async () => {
      await invalidateAfterWrite(client, 'fee');
      setAmount('');
      showToast('Payment recorded');
    },
  });

  const cancel = () => confirmAction('Cancel this charge?', 'It stays on the record, marked cancelled, so a receipt already sent still makes sense.', 'Cancel charge', async () => {
    try { await api.voidFeeCharge(charge.id, null); await invalidateAfterWrite(client, 'fee'); confirmManageWrite('charge', 'deleted'); }
    catch (error) { showMessage('Charge not cancelled', (error as ApiError).message); }
  }, { destructive: true });

  return <View style={styles.charge}>
    <View style={styles.chargeHead}>
      <View style={styles.copy}>
        <Text style={styles.chargeLabel}>{charge.label}</Text>
        <Text style={styles.meta}>{formatEgp(charge.paid_piastres)} of {formatEgp(charge.amount_piastres)} · due {charge.due_on}</Text>
      </View>
      <Standing status={charge.status} />
    </View>
    {charge.status === 'void' ? null : <View style={styles.chargeActions}>
      <AppButton compact label={paying ? 'Close' : 'Record payment'} onPress={() => setPaying((current) => !current)} variant="secondary" />
      <AppButton compact icon="trash" iconOnly label="Cancel charge" onPress={cancel} variant="danger" />
    </View>}
    {paying ? <View style={styles.payment}>
      <FormField
        hint={`${formatEgp(charge.outstanding_piastres)} outstanding`}
        inputMode="decimal"
        keyboardType="decimal-pad"
        label="Amount received (EGP)"
        onChangeText={setAmount}
        placeholder={poundsOf(charge.outstanding_piastres)}
        value={amount}
      />
      <ChoiceField label="How it was paid" onChange={(value) => setMethod(value as PaymentMethod)} options={METHODS} value={method} />
      <AppButton label="Record payment" loading={record.isPending} onPress={() => record.mutate()} />
      {/* Every instalment is kept, so a family disputing a balance can be shown
        * what was taken and when. */}
      {full.data?.payments?.length ? <View style={styles.history}>
        <Text style={styles.historyTitle}>Received so far</Text>
        {full.data.payments.map((payment) => <Text key={payment.id} style={styles.meta}>
          {formatEgp(payment.amount_piastres)} · {payment.paid_on} · {METHODS.find((item) => item.value === payment.method)?.label ?? payment.method} · {payment.recorded_by_name}
        </Text>)}
      </View> : null}
    </View> : null}
  </View>;
}

/**
 * The academy's fees: what each squad is charged monthly, and who has paid.
 *
 * Its own file rather than the shared Manage form scaffold, the way the
 * schedule and announcement managers are: a plan, a month, a generate action, a
 * ledger and a nested payment history are not a flat form over a list, and
 * forcing them in would make six other sections carry the fields.
 */
export function FeesManager({ teams }: { teams: Team[] }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const periods = React.useMemo(recentPeriods, []);
  const [teamId, setTeamId] = React.useState(teams[0]?.id ?? '');
  const [period, setPeriod] = React.useState(periods[0]!.value);
  const [search, setSearch] = React.useState('');
  const [planOpen, setPlanOpen] = React.useState(false);
  const [chargeOpen, setChargeOpen] = React.useState(false);
  const [plan, setPlan] = React.useState({ label: 'Monthly subscription', amount: '', dueDay: '5' });
  const [charge, setCharge] = React.useState({ playerIds: [] as string[], label: '', amount: '', dueOn: '' });

  const squad = teams.find((team) => team.id === teamId) ?? null;
  const plans = useQuery({ queryKey: [...cacheKeys.fees, 'plans', teamId], queryFn: () => api.feePlans(`?team_id=${encodeURIComponent(teamId)}`), enabled: Boolean(teamId) });
  const summary = useQuery({ queryKey: [...cacheKeys.fees, 'summary', teamId, period], queryFn: () => api.teamFeeSummary(teamId, period), enabled: Boolean(teamId) });
  const players = useQuery({ queryKey: [...cacheKeys.players, 'team', teamId], queryFn: () => api.players(`?team_id=${encodeURIComponent(teamId)}&limit=100`), enabled: Boolean(teamId) });
  const livePlan = plans.data?.items.find((item) => item.is_active) ?? null;

  const savePlan = useMutation({
    mutationFn: () => {
      const piastres = parseEgp(plan.amount);
      if (piastres === null || piastres < 0) throw new Error('Enter the monthly amount.');
      const day = Number(plan.dueDay);
      if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error('Choose a due day between 1 and 28.');
      const body = { label: plan.label.trim() || 'Monthly subscription', amount_piastres: piastres, due_day: day };
      return livePlan ? api.updateFeePlan(livePlan.id, body) : api.createFeePlan({ team_id: teamId, ...body });
    },
    onError: (error) => showMessage('Plan not saved', (error as Error).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'fee'); setPlanOpen(false); confirmManageWrite('fee plan', livePlan ? 'saved' : 'created'); },
  });

  const generate = useMutation({
    mutationFn: () => api.generateFees(livePlan!.id, period),
    onError: (error) => showMessage('Charges not raised', (error as ApiError).message),
    onSuccess: async (result) => {
      await invalidateAfterWrite(client, 'fee');
      // Saying what was skipped is the difference between "already done" and
      // silence, which is what a second press otherwise looks like.
      showToast(result.created ? `Raised ${result.created} ${result.created === 1 ? 'charge' : 'charges'}` : `Already raised for all ${result.skipped}`);
    },
  });

  const addCharge = useMutation({
    mutationFn: () => {
      const piastres = parseEgp(charge.amount);
      const playerId = charge.playerIds[0];
      if (!playerId) throw new Error('Choose a player.');
      if (!charge.label.trim()) throw new Error('Say what the charge is for.');
      if (piastres === null || piastres <= 0) throw new Error('Enter the amount.');
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(charge.dueOn)) throw new Error('Enter a due date as YYYY-MM-DD.');
      return api.createFeeCharge({ player_id: playerId, label: charge.label.trim(), amount_piastres: piastres, due_on: charge.dueOn });
    },
    onError: (error) => showMessage('Charge not added', (error as Error).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'fee'); setCharge({ playerIds: [], label: '', amount: '', dueOn: '' }); setChargeOpen(false); confirmManageWrite('charge', 'created'); },
  });

  if (!teams.length) return <Text style={styles.empty}>Add a squad before charging anybody fees.</Text>;

  const rows = summary.data?.players ?? [];
  const shown = narrowBySearch(rows, search, (row) => `${row.player?.name ?? ''} ${FEE_STANDING[row.status]}`);
  const totals = summary.data?.totals;

  return <View style={styles.stack}>
    <View style={styles.pickers}>
      <ChoiceField label="Squad" onChange={setTeamId} options={teams.map((team) => ({ label: team.name, value: team.id }))} value={teamId} />
      <ChoiceField label="Month" onChange={setPeriod} options={periods} value={period} />
    </View>

    {/* The three figures that answer "how are we doing", before the names. */}
    {totals ? <View style={styles.totals}>
      <View style={styles.total}><Text style={styles.totalValue}>{formatEgp(totals.charged_piastres)}</Text><Text style={styles.totalLabel}>Charged</Text></View>
      <View style={styles.total}><Text style={[styles.totalValue, styles.paid]}>{formatEgp(totals.paid_piastres)}</Text><Text style={styles.totalLabel}>Received</Text></View>
      <View style={styles.total}><Text style={[styles.totalValue, totals.outstanding_piastres > 0 && styles.owing]}>{formatEgp(totals.outstanding_piastres)}</Text><Text style={styles.totalLabel}>Outstanding</Text></View>
    </View> : null}

    <CollapsibleCard
      onOpenChange={setPlanOpen}
      open={planOpen}
      summary={livePlan ? `${formatEgp(livePlan.amount_piastres)} a month, due on the ${livePlan.due_day}th` : 'No monthly fee set for this squad.'}
      title={livePlan ? 'Monthly fee' : 'Set a monthly fee'}
      tone="raised"
    >
      <FormField label="What it is called" onChangeText={(label) => setPlan((current) => ({ ...current, label }))} value={plan.label} />
      <FormField
        hint={livePlan ? `Currently ${formatEgp(livePlan.amount_piastres)}` : undefined}
        inputMode="decimal"
        keyboardType="decimal-pad"
        label="Amount each month (EGP)"
        onChangeText={(amount) => setPlan((current) => ({ ...current, amount }))}
        placeholder={livePlan ? poundsOf(livePlan.amount_piastres) : '1200.00'}
        value={plan.amount}
      />
      <FormField hint="1 to 28, so every month has one" inputMode="numeric" keyboardType="number-pad" label="Due on which day" onChangeText={(dueDay) => setPlan((current) => ({ ...current, dueDay }))} value={plan.dueDay} />
      <AppButton label={livePlan ? 'Save changes' : 'Set monthly fee'} loading={savePlan.isPending} onPress={() => savePlan.mutate()} />
    </CollapsibleCard>

    {livePlan ? <View style={styles.generate}>
      <Text style={styles.generateCopy}>Raising charges is a decision, not a schedule — nothing bills a month by itself. Pressing this twice is safe.</Text>
      <AppButton icon="add-circle-outline" label={`Raise ${periods.find((item) => item.value === period)?.label ?? period} charges`} loading={generate.isPending} onPress={() => generate.mutate()} />
    </View> : null}

    <CollapsibleCard onOpenChange={setChargeOpen} open={chargeOpen} summary="Kit, a tournament, anything outside the monthly fee." title="Add a one-off charge" tone="raised">
      <PlayerPickerField
        label="Player"
        onChange={(playerIds) => setCharge((current) => ({ ...current, playerIds }))}
        placeholder="Choose a player"
        players={players.data?.items ?? []}
        selectedIds={charge.playerIds}
        selectionMode="single"
      />
      <FormField label="What it is for" onChangeText={(label) => setCharge((current) => ({ ...current, label }))} placeholder="Away kit" value={charge.label} />
      <FormField inputMode="decimal" keyboardType="decimal-pad" label="Amount (EGP)" onChangeText={(amount) => setCharge((current) => ({ ...current, amount }))} placeholder="400.00" value={charge.amount} />
      <FormField label="Due date" onChangeText={(dueOn) => setCharge((current) => ({ ...current, dueOn }))} placeholder="2026-10-01" value={charge.dueOn} />
      <AppButton label="Add charge" loading={addCharge.isPending} onPress={() => addCharge.mutate()} />
    </CollapsibleCard>

    {summary.isError ? <ErrorState message={(summary.error as ApiError).message} onRetry={() => summary.refetch()} /> : <CollapsibleSection
      count={rows.length}
      defaultOpen
      search={{ label: 'Search players', onChange: setSearch, placeholder: 'Search a name…', resultCount: shown.length, value: search }}
      title="Who has paid"
    >
      {summary.isLoading ? <LoadingState /> : !rows.length ? <Text style={styles.empty}>Nothing has been charged for this month yet.</Text>
        : !shown.length ? <Text style={styles.empty}>Nothing matches that.</Text>
          : <View style={styles.list}>{shown.map((row) => <PlayerLedger
            key={row.player?.id ?? row.player?.name}
            name={row.player?.name ?? 'Unknown player'}
            outstanding={row.outstanding_piastres}
            playerId={row.player?.id ?? ''}
            status={row.status}
          />)}</View>}
    </CollapsibleSection>}
    {squad ? null : <Text style={styles.empty}>Choose a squad.</Text>}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.md },
  pickers: { gap: theme.spacing.sm },

  totals: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', padding: theme.spacing.md },
  total: { alignItems: 'center', flex: 1, gap: 2 },
  totalValue: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.body, fontVariant: ['tabular-nums'] },
  totalLabel: { color: colors.textMuted, fontSize: theme.type.caption },
  paid: { color: colors.live },
  owing: { color: colors.error },

  generate: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  generateCopy: { color: colors.textMuted, fontSize: theme.type.label, lineHeight: 18 },

  list: { gap: theme.spacing.sm },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.touch.minimum, padding: theme.spacing.md },
  copy: { flex: 1 },
  name: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  meta: { color: colors.textMuted, fontSize: theme.type.label, marginTop: 2 },
  pressed: { opacity: 0.7 },

  ledger: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, gap: theme.spacing.sm, padding: theme.spacing.md },
  charge: { backgroundColor: colors.surfaceRaised, borderRadius: theme.radius.sm, gap: theme.spacing.xs, padding: theme.spacing.sm },
  chargeHead: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  chargeLabel: { color: colors.textPrimary, fontFamily: theme.font.semibold, fontSize: theme.type.label },
  chargeActions: { flexDirection: 'row', gap: theme.spacing.xs },
  payment: { gap: theme.spacing.sm, paddingTop: theme.spacing.xs },
  history: { gap: 2 },
  historyTitle: { color: colors.textSecondary, fontFamily: theme.font.bold, fontSize: theme.type.caption },

  chip: { borderRadius: theme.radius.pill, borderWidth: 1, paddingHorizontal: theme.spacing.sm, paddingVertical: 2 },
  chipText: { fontFamily: theme.font.bold, fontSize: theme.type.caption },

  empty: { color: colors.textMuted },
});
