import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { FlatCard } from '@/src/components/FlatCard';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { confirmAction, showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { KitStatus } from '@/src/types/api';

const queues = [{ label: 'Orders', value: 'ordered' }, { label: 'Ready', value: 'fulfilled' }, { label: 'Cancelled', value: 'cancelled' }] as const;

/**
 * The kit book: what has been asked for, and what has been paid for.
 *
 * One queue at a time rather than everything at once — the open orders are the
 * list somebody works from, and a season of settled ones underneath would bury
 * them. An order a family places lands in Orders and stays there until an
 * administrator says the money arrived; nothing else moves it.
 */
export function KitOrdersManager() {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [queue, setQueue] = useState<KitStatus>('ordered');
  const orders = useQuery({ queryKey: ['kit-orders', queue], queryFn: () => api.kitOrders(`?status=${queue}&limit=100`) });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: KitStatus }) => api.setKitStatus(id, status),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['kit-orders'] }); },
    onError: (error) => showMessage('Not saved', error instanceof ApiError ? error.message : 'Try again.'),
  });

  return <View style={styles.stack}>
    <SegmentedControl label="Kit queue" onChange={(value) => setQueue(value as KitStatus)} options={queues} value={queue} />
    <Text style={styles.counter}>{orders.data?.total ?? 0} orders</Text>
    {orders.isLoading ? <LoadingState label="Loading kit orders" />
      : orders.isError ? <ErrorState message={(orders.error as ApiError).message} onRetry={() => orders.refetch()} />
        : !orders.data?.items.length ? <EmptyState body="Orders a family places show up here." title="Nothing in this queue" />
          : orders.data.items.map((order) => <FlatCard key={order.id} radius={theme.radius.md} style={styles.order}>
            <Text style={styles.name}>{order.player_name}</Text>
            <Text style={styles.meta}>{order.team_label}{order.squad_name ? ` · ${order.squad_name}` : ''} · {order.kind === 'goalkeeper' ? 'Goalkeeper' : 'Outfield'}</Text>
            {/* The line the supplier actually works from. */}
            <Text selectable style={styles.line}>
              {order.shirt_name}{order.shirt_number === null ? '' : ` ${order.shirt_number}`} · Kit {order.kit_size} · Hoodie {order.hoodie_size} · Outwear {order.outwear_size}
            </Text>
            <Text style={styles.meta}>{order.delivery === 'home' ? 'Home delivery' : 'Collect at the branch'} · Ordered {formatEgyptDateTime(order.created_at)}</Text>
            {order.paid_at ? <Text style={styles.paid}>Paid {formatEgyptDateTime(order.paid_at)}</Text> : null}
            <View style={styles.actions}>
              {/* Marking an order paid is a statement about money, made from the
                * card of whoever is standing there, so it asks first. Already
                * paid, the button is not offered at all rather than offered
                * spent: pressing it again would say nothing new. */}
              {order.status === 'fulfilled' ? null : <AppButton
                compact
                label="Mark as paid"
                loading={setStatus.isPending}
                onPress={() => confirmAction('Mark as paid?', `${order.player_name}'s kit order moves to Ready.`, 'Mark as paid', () => setStatus.mutate({ id: order.id, status: 'fulfilled' }))}
                style={styles.flex}
              />}
              {order.status === 'cancelled' ? null : <AppButton compact label="Cancel" onPress={() => setStatus.mutate({ id: order.id, status: 'cancelled' })} variant="ghost" />}
              {order.status === 'ordered' ? null : <AppButton compact label="Back to orders" onPress={() => setStatus.mutate({ id: order.id, status: 'ordered' })} variant="secondary" />}
            </View>
          </FlatCard>)}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.md },
  counter: { color: colors.textMuted, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 0.8, textTransform: 'uppercase' },
  order: { gap: 4, padding: theme.spacing.md },
  name: { color: colors.textPrimary, fontFamily: theme.font.semibold, fontSize: theme.type.body },
  meta: { color: colors.textMuted, fontSize: theme.type.label },
  line: { color: colors.textPrimary, fontFamily: theme.font.mono, fontSize: theme.type.label, marginTop: 2 },
  paid: { color: colors.liveText, fontFamily: theme.font.semibold, fontSize: theme.type.label },
  actions: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  flex: { flex: 1 },
});
