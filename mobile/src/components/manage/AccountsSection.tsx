import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { CollapsibleSection } from '@/src/components/CollapsibleSection';
import { PlayerPickerField } from '@/src/components/PlayerPickerField';
import { narrowBySearch } from '@/src/components/SearchField';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { confirmManageWrite } from '@/src/lib/manageToasts';
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AdminAccount, Player } from '@/src/types/api';

const roleName = (role: string) => role === 'admin' ? 'Administrator' : role === 'parent' ? 'Parent' : 'Player';

/** Who the account speaks for, and whether it speaks for anyone at all. */
function describeLink(account: AdminAccount): { text: string; missing: boolean } {
  if (account.role === 'parent') {
    const names = account.children.map((child) => child.name);
    return { text: names.length ? names.join(', ') : 'No children linked', missing: names.length === 0 };
  }
  if (account.role === 'admin' && !account.player) return { text: 'Manages the academy', missing: false };
  if (!account.player) return { text: 'Not linked', missing: true };
  return { text: account.team ? `${account.player.name} · ${account.team.name}` : account.player.name, missing: false };
}

/**
 * One account, which opens to show what its link can be changed to.
 *
 * A parent is read-only here: their children live in `user_children`, and the
 * endpoint behind this picker writes `users.player_id`, which nothing reads for
 * a parent. Offering it would look like a fix and do nothing.
 */
function AccountRow({ account, players }: { account: AdminAccount; players: Player[] }) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const link = useMutation({
    mutationFn: (playerId: string | null) => api.linkUserPlayer(account.id, playerId),
    // The API refuses a player another account already holds, and says which.
    onError: (error) => showMessage('Link not changed', (error as ApiError).message),
    onSuccess: async (_result, playerId) => {
      await invalidateAfterWrite(client, 'account');
      confirmManageWrite('account', playerId ? 'saved' : 'deleted');
      setOpen(false);
    },
  });
  const parent = account.role === 'parent';
  const { text, missing } = describeLink(account);
  return <View style={styles.card}>
    <Pressable
      accessibilityHint={parent ? undefined : 'Opens the roster link for this account'}
      accessibilityLabel={`${account.name}, ${roleName(account.role)}, ${text}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      disabled={parent}
      onPress={() => setOpen((current) => !current)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.copy}>
        <Text style={styles.name}>{account.name}</Text>
        <Text style={styles.meta}>{account.email} · {roleName(account.role)}</Text>
        <Text style={[styles.link, missing && styles.linkMissing]}>{text}</Text>
      </View>
      {parent ? null : <Ionicons accessibilityElementsHidden color={colors.textMuted} name={open ? 'chevron-up' : 'chevron-down'} size={18} />}
    </Pressable>
    {open && !parent ? <View style={styles.editor}>
      <PlayerPickerField
        label="Linked player"
        onChange={(playerIds) => link.mutate(playerIds[0] ?? null)}
        placeholder="Choose a player"
        players={players}
        selectedIds={account.player ? [account.player.id] : []}
        selectionMode="single"
      />
      {account.player ? <AppButton compact disabled={link.isPending} label="Unlink" onPress={() => link.mutate(null)} variant="ghost" /> : null}
      <Text style={styles.note}>This account reads the linked player&rsquo;s stats, schedule and announcements as its own. A player already claimed by another account is refused.</Text>
    </View> : null}
  </View>;
}

/**
 * Who has actually registered, and which roster record each account speaks for.
 *
 * An invitation names who an account will be; this is the other half — who took
 * one up, and the times a link was made against the wrong player. It lives
 * under Invites rather than taking a ninth Manage tab, because that grid is a
 * fixed two-by-four and the two questions are the same question.
 */
export function AccountsSection({ players }: { players: Player[] }) {
  const styles = useThemedStyles(stylesheet);
  const [search, setSearch] = React.useState('');
  const accounts = useQuery({ queryKey: cacheKeys.accounts, queryFn: () => api.adminUsers() });
  const items = accounts.data?.items ?? [];
  const shown = narrowBySearch(items, search, (account) => `${account.name} ${account.email} ${roleName(account.role)} ${describeLink(account).text}`);
  if (accounts.isError) return <ErrorState message={(accounts.error as ApiError).message} onRetry={() => accounts.refetch()} />;
  return <CollapsibleSection
    count={items.length}
    search={{ label: 'Search accounts', onChange: setSearch, placeholder: 'Search a name, email or player…', resultCount: shown.length, value: search }}
    title="Registered accounts"
  >
    {accounts.isLoading ? <LoadingState /> : !items.length ? <Text style={styles.empty}>Nobody has registered yet.</Text>
      : !shown.length ? <Text style={styles.empty}>Nothing matches that.</Text>
        : <View style={styles.list}>{shown.map((account) => <AccountRow account={account} key={account.id} players={players} />)}</View>}
  </CollapsibleSection>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  list: { gap: theme.spacing.sm },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.touch.minimum, padding: theme.spacing.md },
  pressed: { opacity: 0.7 },
  copy: { flex: 1 },
  name: { color: colors.textPrimary, fontFamily: theme.font.bold },
  meta: { color: colors.textMuted, fontSize: theme.type.label, marginTop: 3 },
  link: { color: colors.accentSoft, fontFamily: theme.font.semibold, fontSize: theme.type.label, marginTop: 3 },
  // An account nobody is behind cannot read its own squad at all, so it is worth
  // more than the muted grey the rest of the line is set in.
  linkMissing: { color: colors.warningText },
  editor: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, gap: theme.spacing.sm, padding: theme.spacing.md },
  note: { color: colors.textSecondary, fontSize: theme.type.label, lineHeight: 20 },
  empty: { color: colors.textMuted, textAlign: 'center' },
});
