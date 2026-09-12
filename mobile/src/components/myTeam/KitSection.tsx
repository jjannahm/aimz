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
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { copy } from '@/src/i18n/en';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import { KIT_ORDER_SIZES, type KitOrder, type KitOrderSize } from '@/src/types/api';

const sizeLabels: Record<KitOrderSize, string> = { S: 'Small', M: 'Medium', L: 'Large', XL: 'X Large' };
const sizeOptions = KIT_ORDER_SIZES.map((size) => ({ label: sizeLabels[size], value: size }));
const statusWord: Record<KitOrder['status'], string> = { ordered: 'Ordered', fulfilled: 'Ready', cancelled: 'Cancelled' };

type Draft = {
  shirtName: string; shirtNumber: string;
  kitSize: KitOrderSize | ''; hoodieSize: KitOrderSize | ''; outwearSize: KitOrderSize | '';
};
const empty: Draft = { shirtName: '', shirtNumber: '', kitSize: '', hoodieSize: '', outwearSize: '' };

/**
 * Ordering kit, for the family it is for.
 *
 * The order names a roster player rather than repeating a child's name and
 * date of birth into a form. The server also reads the player's squad and
 * position from that same roster record, so neither can drift from the profile.
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

  const orders = useQuery({ queryKey: cacheKeys.kitOrders, queryFn: () => api.kitOrders() });
  const place = useMutation({
    mutationFn: async () => {
      if (!playerId) throw new ApiError('No player to order for.', 403);
      return api.orderKit({
        player_id: playerId,
        shirt_name: draft.shirtName.trim(),
        shirt_number: draft.shirtNumber.trim() ? Number(draft.shirtNumber) : null,
        kit_size: draft.kitSize as KitOrderSize,
        hoodie_size: draft.hoodieSize as KitOrderSize,
        outwear_size: draft.outwearSize as KitOrderSize,
      });
    },
    onSuccess: async () => {
      setDraft(empty);
      setErrors({});
      showMessage('Kit ordered', 'AIMZ has the order and will confirm when it is ready.');
      await invalidateAfterWrite(client, 'kit');
    },
    onError: (error) => showMessage('Kit not ordered', error instanceof ApiError ? error.message : 'Try again.'),
  });

  if (!playerId && loadingChildren) return <LoadingState label="Loading your family" />;
  if (!playerId) return <EmptyState body={copy.accountNotLinked} title="Account not linked" />;

  const submit = () => {
    // Squad, playing type and collection method are authoritative server-side;
    // only the personalisation and sizes entered here need local validation.
    const next: typeof errors = {};
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
        <FormField error={errors.shirtName} label="Name on the shirt" onChangeText={(value) => set('shirtName', value)} value={draft.shirtName} />
        <FormField error={errors.shirtNumber} keyboardType="number-pad" label="Number on the shirt (optional)" onChangeText={(value) => set('shirtNumber', value)} value={draft.shirtNumber} />
        <ChoiceField error={errors.kitSize} label="Kit size" onChange={(value) => set('kitSize', value)} options={sizeOptions} value={draft.kitSize} />
        <ChoiceField error={errors.hoodieSize} label="Hoodie size" onChange={(value) => set('hoodieSize', value)} options={sizeOptions} value={draft.hoodieSize} />
        <ChoiceField error={errors.outwearSize} label="Outwear size" onChange={(value) => set('outwearSize', value)} options={sizeOptions} value={draft.outwearSize} />
        <View accessible accessibilityLabel="Collection, At the branch" style={styles.fixedField}>
          <Text style={styles.fieldLabel}>Collection</Text>
          <View style={styles.fieldValue}><Text style={styles.fieldText}>At the branch</Text></View>
        </View>
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
  fixedField: { gap: theme.spacing.xs },
  fieldLabel: { color: colors.textSecondary, fontFamily: theme.font.semibold, fontSize: theme.type.label },
  fieldValue: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, justifyContent: 'center', minHeight: theme.size.field, paddingHorizontal: theme.spacing.md },
  fieldText: { color: colors.textPrimary, fontFamily: theme.font.regular, fontSize: theme.type.body },
  order: { gap: 4, padding: theme.spacing.md },
  orderHead: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  orderName: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  status: { color: colors.accentSoft, fontFamily: theme.font.bold, fontSize: theme.type.caption },
  meta: { color: colors.textMuted, fontSize: theme.type.label },
});
