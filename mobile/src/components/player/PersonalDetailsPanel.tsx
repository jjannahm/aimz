import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { positionName } from '@/src/lib/positions';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { PlayerPersonalDetails } from '@/src/types/api';

/** `2012-04-02` reads as `2 April 2012`. */
const readable = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** One thing the academy knows, and what it says. */
type Field = { key: string; label: string; value: string | null };

/**
 * What the academy holds about who this player is.
 *
 * Built as a list of fields rather than a hand-written layout, so a field the
 * app starts collecting later — an address, a phone number of her own — is one
 * entry in `fieldsFor` and appears in place without this page being reshaped.
 * A field with nothing behind it is left out rather than shown empty: a row
 * reading "Address —" says the academy failed to record one, when the truth is
 * that it never asks.
 */
function fieldsFor(details: PlayerPersonalDetails): Field[] {
  return [
    { key: 'name', label: 'Name', value: details.player?.name ?? null },
    { key: 'squad', label: 'Squad', value: details.team?.name ?? null },
    { key: 'position', label: 'Position', value: details.player?.position ? positionName(details.player.position) : null },
    { key: 'shirt', label: 'Shirt number', value: details.player?.jersey_number === null || details.player?.jersey_number === undefined ? null : String(details.player.jersey_number) },
    {
      key: 'dob',
      label: 'Date of birth',
      value: details.date_of_birth ? `${readable(details.date_of_birth)}${details.age === null ? '' : ` · ${details.age}`}` : null,
    },
    // Only where she has a login of her own. A young squad is reached through
    // its parents, and having no account is ordinary rather than missing.
    { key: 'account', label: 'Account email', value: details.account?.email ?? null },
  ].filter((field) => field.value !== null);
}

export function PersonalDetailsPanel({ playerId }: { playerId: string }) {
  const styles = useThemedStyles(stylesheet);
  const query = useQuery({
    queryKey: [...cacheKeys.personalDetails, playerId],
    queryFn: () => api.playerPersonalDetails(playerId),
    enabled: Boolean(playerId),
  });

  if (query.isLoading) return <LoadingState label="Loading details" />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as ApiError)?.message ?? 'Details not found.'} onRetry={() => query.refetch()} />;

  const fields = fieldsFor(query.data);
  const contacts = query.data.contacts;

  return <View style={styles.stack}>
    <FlatCard radius={theme.radius.md} style={styles.card}>
      {fields.map((field, index) => <View key={field.key} style={[styles.row, index > 0 && styles.divided]}>
        <Text style={styles.label}>{field.label}</Text>
        <Text style={styles.value}>{field.value}</Text>
      </View>)}
    </FlatCard>

    <Text accessibilityRole="header" style={styles.heading}>Emergency contacts</Text>
    {!contacts.length
      ? <FlatCard radius={theme.radius.md} style={styles.empty}>
        <Text style={styles.emptyText}>Nobody has been recorded to ring. An AIMZ administrator can add them.</Text>
      </FlatCard>
      : contacts.map((contact) => <FlatCard key={contact.id} radius={theme.radius.md} style={styles.contact}>
        <Text style={styles.contactName}>{contact.name}{contact.relationship ? ` · ${contact.relationship}` : ''}</Text>
        {contact.phone ? <Text style={styles.contactLine}>{contact.phone}</Text> : null}
        {contact.email ? <Text style={styles.contactLine}>{contact.email}</Text> : null}
      </FlatCard>)}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.sm },
  // The rows are divided inside one card, so the details read as one record
  // rather than as six separate things to look at.
  card: { overflow: 'hidden', padding: 0 },
  row: { alignItems: 'baseline', flexDirection: 'row', gap: theme.spacing.md, justifyContent: 'space-between', paddingHorizontal: theme.size.cardPadding, paddingVertical: theme.spacing.sm },
  divided: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  label: { color: colors.textMuted, fontFamily: theme.font.regular },
  value: { color: colors.textPrimary, flexShrink: 1, fontFamily: theme.font.semibold, textAlign: 'right' },

  heading: { color: colors.textSecondary, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 1, marginTop: theme.spacing.xs, textTransform: 'uppercase' },
  contact: { gap: 2, padding: theme.size.cardPadding },
  contactName: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  contactLine: { color: colors.textSecondary, fontFamily: theme.font.mono, fontSize: theme.type.label },
  empty: { padding: theme.size.cardPadding },
  emptyText: { color: colors.textMuted, fontFamily: theme.font.regular, lineHeight: 21 },
});
