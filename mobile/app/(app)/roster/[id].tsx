import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { CloseButton } from '@/src/components/CloseButton';
import { FormField } from '@/src/components/FormField';
import { Screen } from '@/src/components/Screen';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { confirmManageWrite } from '@/src/lib/manageToasts';
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type ContactDraft = { name: string; relationship: string; email: string; phone: string };
const blankContact = (): ContactDraft => ({ name: '', relationship: '', email: '', phone: '' });

export default function PrivateRosterDetailsScreen() {
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const player = useQuery({ queryKey: ['players', id], queryFn: async () => (await api.players('?limit=100')).items.find((item) => item.id === id) ?? null, enabled: Boolean(id) && user?.role === 'admin' });
  const details = useQuery({ queryKey: ['roster-details', id], queryFn: () => api.playerRosterDetails(id), enabled: Boolean(id) && user?.role === 'admin' });
  // Kept, loaded and written back though it is no longer edited here, so that
  // saving this screen cannot quietly erase a date already on the record.
  const [dateOfBirth, setDateOfBirth] = React.useState('');
  const [contacts, setContacts] = React.useState<ContactDraft[]>([]);
  React.useEffect(() => {
    if (!details.data) return;
    setDateOfBirth(details.data.date_of_birth ?? '');
    setContacts(details.data.contacts.map((contact) => ({ name: contact.name, relationship: contact.relationship ?? '', email: contact.email ?? '', phone: contact.phone ?? '' })));
  }, [details.data]);
  const save = useMutation({
    mutationFn: () => {
      if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) throw new Error('Date of birth must use YYYY-MM-DD.');
      if (contacts.some((contact) => !contact.name.trim())) throw new Error('Every contact needs a name.');
      return api.savePlayerRosterDetails(id, { date_of_birth: dateOfBirth || null, contacts: contacts.map((contact) => ({ name: contact.name.trim(), relationship: contact.relationship.trim() || null, email: contact.email.trim() || null, phone: contact.phone.trim() || null })) });
    },
    onError: (error) => showMessage('Roster details not saved', (error as Error).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'roster'); confirmManageWrite('roster', 'saved'); },
  });
  if (user?.role !== 'admin') return <Redirect href="/(app)/(tabs)" />;
  if (player.isLoading || details.isLoading) return <Screen action={<CloseButton />} title="Private roster details"><LoadingState /></Screen>;
  if (player.isError || details.isError || !player.data) return <Screen action={<CloseButton />} title="Private roster details"><ErrorState message={player.data === null ? 'Player not found.' : ((player.error ?? details.error) as ApiError).message} onRetry={() => { player.refetch(); details.refetch(); }} /></Screen>;
  const update = (index: number, patch: Partial<ContactDraft>) => setContacts((current) => current.map((contact, contactIndex) => contactIndex === index ? { ...contact, ...patch } : contact));
  return <Screen action={<CloseButton />} title={player.data?.name ?? 'Private roster details'}>
    <View style={styles.notice}><Text style={styles.noticeTitle}>Administrators only</Text><Text style={styles.noticeCopy}>Guardian and contact details never appear in player lists, statistics or player-facing screens.</Text></View>
    <View style={styles.header}><Text style={styles.heading}>Guardian and contact details</Text><AppButton compact label="Add contact" onPress={() => setContacts((current) => [...current, blankContact()])} variant="secondary" /></View>
    {contacts.length === 0 ? <Text style={styles.empty}>No private contacts saved.</Text> : contacts.map((contact, index) => <View key={index} style={styles.card}>
      <View style={styles.header}><Text style={styles.contactTitle}>Contact {index + 1}</Text><AppButton compact icon="trash" iconOnly label={`Remove contact ${index + 1}`} onPress={() => setContacts((current) => current.filter((unused, contactIndex) => contactIndex !== index))} variant="danger" /></View>
      <FormField label="Name" onChangeText={(name) => update(index, { name })} value={contact.name} />
      <FormField label="Relationship" onChangeText={(relationship) => update(index, { relationship })} placeholder="Parent or guardian" value={contact.relationship} />
      <FormField keyboardType="phone-pad" label="Phone" onChangeText={(phone) => update(index, { phone })} value={contact.phone} />
    </View>)}
    <AppButton label="Save private details" loading={save.isPending} onPress={() => save.mutate()} />
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.lg },
  contactTitle: { color: colors.textPrimary, fontWeight: '900' },
  empty: { color: colors.textMuted, paddingVertical: theme.spacing.md, textAlign: 'center' },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  heading: { color: colors.textPrimary, flex: 1, fontSize: theme.type.heading, fontWeight: '900' },
  notice: { backgroundColor: colors.warningSurface, borderColor: colors.warning, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.xs, padding: theme.spacing.md },
  noticeCopy: { color: colors.textPrimary, lineHeight: 21 },
  noticeTitle: { color: colors.warningText, fontWeight: '900' },
});
