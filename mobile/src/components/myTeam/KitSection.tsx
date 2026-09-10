import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { useMyChildren } from '@/src/auth/useMyTeam';
import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { CollapsibleCard } from '@/src/components/CollapsibleCard';
import { FlatCard } from '@/src/components/FlatCard';
import { FormField } from '@/src/components/FormField';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { copy } from '@/src/i18n/en';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import { KIT_SIZES, type KitOrder, type KitSize } from '@/src/types/api';

const sizeOptions = KIT_SIZES.map((size) => ({ label: size, value: size }));
const kinds = [{ label: 'Outfield', value: 'player' }, { label: 'Goalkeeper', value: 'goalkeeper' }] as const;
const deliveries = [{ label: 'At the branch', value: 'branch' }, { label: 'Home delivery', value: 'home' }] as const;
const statusWord: Record<KitOrder['status'], string> = { ordered: 'Ordered', fulfilled: 'Ready', cancelled: 'Cancelled' };

type Draft = {
  teamLabel: string; kind: 'player' | 'goalkeeper'; shirtName: string; shirtNumber: string;
  kitSize: KitSize | ''; hoodieSize: KitSize | ''; outwearSize: KitSize | ''; delivery: 'branch' | 'home';
};
const empty: Draft = { teamLabel: '', kind: 'player', shirtName: '', shirtNumber: '', kitSize: '', hoodieSize: '', outwearSize: '', delivery: 'branch' };

/**
 * Ordering kit, for the family it is for.
 *
 * The order names a roster player rather than repeating a child's name and
 * date of birth into a form, which is the whole reason this moved off the old
 * public page. The team is typed rather than chosen from the squads here: the
 * names the supplier works to are not the squads this app rosters.
 */
export function KitSection() {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const { user } = useAuth();
  const { children, isLoading: loadingChildren } = useMyChildren();
  // A player orders for themselves; a parent picks which child.
  const own = user?.role === 'parent' ? null : user?.player_id ?? null;
  const [childId, setChildId] = useState<string | null>(null);
  const playerId = own ?? childId ?? children[0]?.id ?? null;

  const [draft, setDraft] = useState<Draft>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const set = (field: keyof Draft, value: string) => setDraft((current) => ({ ...current, [field]: value }));

  const orders = useQuery({ queryKey: ['kit-orders'], queryFn: () => api.kitOrders() });
  const place = useMutation({
    mutationFn: async () => {
      if (!playerId) throw new ApiError('No player to order for.', 403);
      return api.orderKit({
        player_id: playerId,
        team_label: draft.teamLabel.trim(),
        kind: draft.kind,
        shirt_name: draft.shirtName.trim(),
        shirt_number: draft.shirtNumber.trim() ? Number(draft.shirtNumber) : null,
        kit_size: draft.kitSize as KitSize,
        hoodie_size: draft.hoodieSize as KitSize,
        outwear_size: draft.outwearSize as KitSize,
        delivery: draft.delivery,
      });
    },
    onSuccess: async () => {
      setDraft(empty);
      setErrors({});
      showMessage('Kit ordered', 'AIMZ has the order and will confirm when it is ready.');
      await client.invalidateQueries({ queryKey: ['kit-orders'] });
    },
    onError: (error) => showMessage('Kit not ordered', error instanceof ApiError ? error.message : 'Try again.'),
  });

  if (!playerId && loadingChildren) return <LoadingState label="Loading your family" />;
  if (!playerId) return <EmptyState body={copy.accountNotLinked} title="Account not linked" />;

  const submit = () => {
    // Every field is the supplier's to fill an order from, so none of them can
    // be guessed at later — an incomplete order is one that cannot be made.
    const next: typeof errors = {};
    if (draft.teamLabel.trim().length < 1) next.teamLabel = 'Enter the team name your coach uses.';
    if (draft.shirtName.trim().length < 1) next.shirtName = 'Enter the name to print on the shirt.';
    if (draft.shirtNumber.trim() && !/^\d{1,2}$/u.test(draft.shirtNumber.trim())) next.shirtNumber = 'A number between 0 and 99.';
    for (const field of ['kitSize', 'hoodieSize', 'outwearSize'] as const) if (!draft[field]) next[field] = 'Choose a size.';
    setErrors(next);
    if (!Object.keys(next).length) place.mutate();
  };

  return <View style={styles.stack}>
    {children.length > 1 ? <ChoiceField
      label="Who is this for"
      onChange={setChildId}
      options={children.map((child) => ({ label: child.name, value: child.id }))}
      value={playerId}
    /> : null}

    <CollapsibleCard summary="Sizes, the name on the shirt, and where to collect it." title="Order kit" tone="raised">
      <View style={styles.stack}>
        <FormField error={errors.teamLabel} hint="The name your coach uses, not the AIMZ squad." label="Team" onChangeText={(value) => set('teamLabel', value)} value={draft.teamLabel} />
        <SegmentedControl label="Outfield or goalkeeper" onChange={(value) => set('kind', value)} options={kinds} value={draft.kind} />
        <FormField error={errors.shirtName} label="Name on the shirt" onChangeText={(value) => set('shirtName', value)} value={draft.shirtName} />
        <FormField error={errors.shirtNumber} keyboardType="number-pad" label="Number on the shirt (optional)" onChangeText={(value) => set('shirtNumber', value)} value={draft.shirtNumber} />
        <ChoiceField error={errors.kitSize} label="Kit size" onChange={(value) => set('kitSize', value)} options={sizeOptions} value={draft.kitSize} />
        <ChoiceField error={errors.hoodieSize} label="Hoodie size" onChange={(value) => set('hoodieSize', value)} options={sizeOptions} value={draft.hoodieSize} />
        <ChoiceField error={errors.outwearSize} label="Outwear size" onChange={(value) => set('outwearSize', value)} options={sizeOptions} value={draft.outwearSize} />
        <SegmentedControl label="Where to receive it" onChange={(value) => set('delivery', value)} options={deliveries} value={draft.delivery} />
        <AppButton label="Place the order" loading={place.isPending} onPress={submit} />
      </View>
    </CollapsibleCard>

    <Text accessibilityRole="header" style={styles.heading}>Orders</Text>
    {orders.isLoading ? <LoadingState label="Loading kit orders" />
      : orders.isError ? <ErrorState message={(orders.error as ApiError).message} onRetry={() => orders.refetch()} />
        : !orders.data?.items.length ? <EmptyState body="Kit you order shows up here, with where it has got to." title="No kit ordered yet" />
          : orders.data.items.map((order) => <FlatCard key={order.id} radius={theme.radius.md} style={styles.order}>
            <View style={styles.orderHead}>
              <Text style={styles.orderName}>{order.player_name}</Text>
              <Text style={styles.status}>{statusWord[order.status]}</Text>
            </View>
            <Text style={styles.meta}>{order.team_label} · {order.kind === 'goalkeeper' ? 'Goalkeeper' : 'Outfield'}</Text>
            <Text style={styles.meta}>
              {order.shirt_name}{order.shirt_number === null ? '' : ` ${order.shirt_number}`} · Kit {order.kit_size} · Hoodie {order.hoodie_size} · Outwear {order.outwear_size}
            </Text>
            <Text style={styles.meta}>{order.delivery === 'home' ? 'Home delivery' : 'Collect at the branch'} · {formatEgyptDateTime(order.created_at)}</Text>
          </FlatCard>)}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.md },
  heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  order: { gap: 4, padding: theme.spacing.md },
  orderHead: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  orderName: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  status: { color: colors.accentSoft, fontFamily: theme.font.bold, fontSize: theme.type.caption },
  meta: { color: colors.textMuted, fontSize: theme.type.label },
});
