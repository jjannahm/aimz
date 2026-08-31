import { Ionicons } from '@expo/vector-icons';
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
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AdminAccount, Player, UserRole } from '@/src/types/api';

const roleName = (role: string) => role === 'admin' ? 'Administrator' : role === 'parent' ? 'Parent' : 'Player';

/**
 * How long an account is meant to last, as hours from now.
 *
 * Offered as lengths rather than a date because that is how the need arrives —
 * someone is here for a weekend, a fortnight's trial, the tournament — and a
 * length cannot be set in the past by mistake.
 */
const LIFETIMES: { label: string; hours: number | null }[] = [
  { label: 'Never expires', hours: null },
  { label: '48 hours', hours: 48 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
];

const deadlineIn = (hours: number | null) => hours === null ? null : new Date(Date.now() + hours * 3_600_000).toISOString();

/** What is left of an account's time, said the way somebody would say it. */
export function describeRemaining(expiresAt: string | null | undefined, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const left = Date.parse(expiresAt) - now;
  if (Number.isNaN(left)) return null;
  if (left <= 0) return 'Expired';
  const hours = Math.floor(left / 3_600_000);
  if (hours < 1) return 'Expires in under an hour';
  if (hours < 24) return `Expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} ${days === 1 ? 'day' : 'days'}`;
}

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
  const expiry = useMutation({
    mutationFn: (expiresAt: string | null) => api.setUserExpiry(account.id, expiresAt),
    onError: (error) => showMessage('Expiry not changed', (error as ApiError).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'account'); confirmManageWrite('account', 'saved'); },
  });
  const parent = account.role === 'parent';
  const { text, missing } = describeLink(account);
  const remaining = describeRemaining(account.expires_at);
  const spent = remaining === 'Expired';
  return <View style={styles.card}>
    <Pressable
      accessibilityHint="Opens what can be changed about this account"
      accessibilityLabel={`${account.name}, ${roleName(account.role)}, ${text}${remaining ? `, ${remaining}` : ''}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((current) => !current)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.copy}>
        <Text style={styles.name}>{account.name}</Text>
        <Text style={styles.meta}>{account.email} · {roleName(account.role)}</Text>
        <Text style={[styles.link, missing && styles.linkMissing]}>{text}</Text>
        {remaining ? <Text style={[styles.remaining, spent && styles.spent]}>{remaining}</Text> : null}
      </View>
      <Ionicons accessibilityElementsHidden color={colors.textMuted} name={open ? 'chevron-up' : 'chevron-down'} size={18} />
    </Pressable>
    {open ? <View style={styles.editor}>
      {/* A parent's children live in user_children, and the picker below writes
        * users.player_id, which nothing reads for a parent. Offering it would
        * look like a fix and do nothing. Their time can still be changed. */}
      {parent ? null : <>
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
      </>}
      <ChoiceField
        label="Access"
        onChange={(value) => expiry.mutate(deadlineIn(value === '' ? null : Number(value)))}
        options={LIFETIMES.map((option) => ({ label: option.hours === null ? option.label : `Ends in ${option.label}`, value: String(option.hours ?? '') }))}
        placeholder={remaining ?? 'Never expires'}
        value=""
      />
      <Text style={styles.note}>Choosing a length starts it from now. An expired account can be given more time the same way &mdash; nothing is deleted.</Text>
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
const blankAccount = { name: '', email: '', password: '', role: 'player' as UserRole, hours: '' };

/**
 * An account made here and now, rather than invited.
 *
 * An invitation is the way in for somebody who will be here: they choose their
 * own password and it is theirs. This is for the other case &mdash; a login
 * handed to somebody for a while, whose password you are going to have to tell
 * them, and which is meant to stop working.
 */
function NewAccount() {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [draft, setDraft] = React.useState(blankAccount);
  const [open, setOpen] = React.useState(false);
  const create = useMutation({
    mutationFn: () => {
      if (!draft.name.trim() || !draft.email.trim()) throw new Error('Enter a name and an email address.');
      if (draft.password.length < 10) throw new Error('Choose a password of at least 10 characters.');
      return api.createUser({
        name: draft.name.trim(), email: draft.email.trim(), password: draft.password,
        role: draft.role, expires_at: deadlineIn(draft.hours === '' ? null : Number(draft.hours)),
      });
    },
    onError: (error) => showMessage('Account not created', (error as Error).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'account'); setDraft(blankAccount); confirmManageWrite('account', 'created'); },
  });
  return <CollapsibleCard onOpenChange={setOpen} open={open} summary="A login handed out for a set length of time." title="Create an account" tone="raised">
    <FormField label="Name" onChangeText={(name) => setDraft((current) => ({ ...current, name }))} value={draft.name} />
    <FormField autoCapitalize="none" inputMode="email" keyboardType="email-address" label="Email" onChangeText={(email) => setDraft((current) => ({ ...current, email }))} value={draft.email} />
    <FormField hint="At least 10 characters. You will have to pass this on yourself." label="Password" onChangeText={(password) => setDraft((current) => ({ ...current, password }))} secureTextEntry value={draft.password} />
    <ChoiceField
      label="Role"
      onChange={(role) => setDraft((current) => ({ ...current, role: role as UserRole }))}
      options={[{ label: 'Player', value: 'player' }, { label: 'Parent', value: 'parent' }, { label: 'Administrator', value: 'admin' }]}
      value={draft.role}
    />
    <ChoiceField
      label="Access"
      onChange={(hours) => setDraft((current) => ({ ...current, hours }))}
      options={LIFETIMES.map((option) => ({ label: option.hours === null ? option.label : `Ends in ${option.label}`, value: String(option.hours ?? '') }))}
      value={draft.hours}
    />
    <Text style={styles.note}>A player or parent made here starts with nothing linked to it. Link it below, or send an invitation instead so they pick their own password.</Text>
    <AppButton label="Create account" loading={create.isPending} onPress={() => create.mutate()} />
  </CollapsibleCard>;
}

export function AccountsSection({ players }: { players: Player[] }) {
  const styles = useThemedStyles(stylesheet);
  const [search, setSearch] = React.useState('');
  const accounts = useQuery({ queryKey: cacheKeys.accounts, queryFn: () => api.adminUsers() });
  const items = accounts.data?.items ?? [];
  const shown = narrowBySearch(items, search, (account) => `${account.name} ${account.email} ${roleName(account.role)} ${describeLink(account).text}`);
  if (accounts.isError) return <ErrorState message={(accounts.error as ApiError).message} onRetry={() => accounts.refetch()} />;
  return <><NewAccount /><CollapsibleSection
    count={items.length}
    search={{ label: 'Search accounts', onChange: setSearch, placeholder: 'Search a name, email or player…', resultCount: shown.length, value: search }}
    title="Registered accounts"
  >
    {accounts.isLoading ? <LoadingState /> : !items.length ? <Text style={styles.empty}>Nobody has registered yet.</Text>
      : !shown.length ? <Text style={styles.empty}>Nothing matches that.</Text>
        : <View style={styles.list}>{shown.map((account) => <AccountRow account={account} key={account.id} players={players} />)}</View>}
  </CollapsibleSection></>;
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
  remaining: { color: colors.textMuted, fontSize: theme.type.label, marginTop: 3 },
  // An account already out of time is worth saying loudly: somebody is locked
  // out and the fix is one field away.
  spent: { color: colors.errorText, fontFamily: theme.font.semibold },
  editor: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, gap: theme.spacing.sm, padding: theme.spacing.md },
  note: { color: colors.textSecondary, fontSize: theme.type.label, lineHeight: 20 },
  empty: { color: colors.textMuted, textAlign: 'center' },
});
