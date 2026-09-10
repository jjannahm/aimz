import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { DateTimeField } from '@/src/components/DateTimeField';
import { FormField } from '@/src/components/FormField';
import { PositionField } from '@/src/components/PositionField';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Newcomer, NewcomerOutcome, NewcomerStage, Team } from '@/src/types/api';

export function NewcomersManager({ teams }: { teams: Team[] }) {
  const styles = useThemedStyles(stylesheet); const client = useQueryClient();
  const [queue, setQueue] = useState<'active' | 'history'>('active'); const [search, setSearch] = useState(''); const [branch, setBranch] = useState(''); const [source, setSource] = useState(''); const [stage, setStage] = useState(''); const [selected, setSelected] = useState<string | null>(null);
  const params = new URLSearchParams({ queue }); if (search) params.set('search', search); if (branch) params.set('branch', branch); if (source) params.set('source', source); if (stage) params.set('stage', stage);
  const list = useQuery({ queryKey: ['newcomers', queue, search, branch, source, stage], queryFn: () => api.newcomers(`?${params}`) });
  // Read from the branches themselves rather than typed in: a text box could
  // say which branch was chosen and never which ones there are.
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api.branches() });
  const detail = useQuery({ queryKey: ['newcomer', selected], queryFn: () => api.newcomer(selected!), enabled: Boolean(selected) });
  if (selected) return <Detail item={detail.data} loading={detail.isLoading} teams={teams} onBack={() => setSelected(null)} onChanged={async () => { await client.invalidateQueries({ queryKey: ['newcomers'] }); await client.invalidateQueries({ queryKey: ['newcomer', selected] }); }} />;
  const due = list.data?.items.filter((item) => item.next_follow_up_at && new Date(item.next_follow_up_at) <= new Date()).length ?? 0;
  return <View style={styles.stack}>
    <SegmentedControl label="Newcomer queue" onChange={(value) => setQueue(value as typeof queue)} options={[{ label: 'Active', value: 'active' }, { label: 'History', value: 'history' }]} value={queue} />
    <Text style={styles.counter}>{list.data?.total ?? 0} records · {due} due or overdue</Text>
    <FormField label="Search" placeholder="Name, email or phone" onChangeText={setSearch} value={search} />
    <ChoiceField
      label="Branch"
      onChange={setBranch}
      // The side of the city comes along, because two of them share a name
      // with somewhere else in Cairo and the area is how the academy says
      // which is which.
      options={[{ label: 'All branches', value: '' }, ...(branches.data?.items ?? []).map((branch) => ({ label: branch.area ? `${branch.name} (${branch.area})` : branch.name, value: branch.name }))]}
      placeholder="All branches"
      value={branch}
    />
    <View style={styles.filters}><View style={styles.flex}><ChoiceField label="Source" onChange={setSource} options={[{ label: 'All', value: '' }, { label: 'Public link', value: 'public_link' }, { label: 'Account signup', value: 'account_registration' }]} value={source} /></View><View style={styles.flex}><ChoiceField label="Status" onChange={setStage} options={[{ label: 'All', value: '' }, ...['new', 'contacted', 'follow_up', 'trial_booked', 'closed'].map((value) => ({ label: value.replaceAll('_', ' '), value }))]} value={stage} /></View></View>
    {list.isLoading ? <LoadingState label="Loading newcomers" /> : list.error ? <ErrorState message={(list.error as ApiError).message} onRetry={() => void list.refetch()} /> : null}
    {list.data?.items.map((item) => <View key={item.id} style={styles.card}><Text style={styles.name}>{item.full_name}</Text><Text style={styles.meta}>{item.branch} · {item.email}</Text><View style={styles.badges}><Text style={styles.badge}>{item.source === 'public_link' ? 'Public' : 'Signup'}</Text><Text style={styles.badge}>{item.stage.replaceAll('_', ' ')}</Text>{item.duplicate_likely ? <Text style={styles.warning}>Possible duplicate</Text> : null}</View>{item.next_follow_up_at ? <Text style={new Date(item.next_follow_up_at) < new Date() ? styles.overdue : styles.meta}>Follow up {formatEgyptDateTime(item.next_follow_up_at)}</Text> : null}<AppButton compact label="Open application" onPress={() => setSelected(item.id)} variant="secondary" /></View>)}
  </View>;
}

function Detail({ item, loading, teams, onBack, onChanged }: { item?: Newcomer; loading: boolean; teams: Team[]; onBack: () => void; onChanged: () => Promise<void> }) {
  const styles = useThemedStyles(stylesheet); const [note, setNote] = useState(''); const [team, setTeam] = useState(''); const [position, setPosition] = useState(''); const [jersey, setJersey] = useState(''); const [followUp, setFollowUp] = useState(item?.next_follow_up_at ?? new Date().toISOString());
  const save = useMutation({ mutationFn: (action: () => Promise<unknown>) => action(), onSuccess: onChanged, onError: (error) => showMessage('Could not save', error instanceof ApiError ? error.message : 'Try again.') });
  if (loading || !item) return <LoadingState label="Loading application" />;
  const close = (outcome: NewcomerOutcome) => save.mutate(() => api.updateNewcomer(item.id, { stage: 'closed', outcome }));
  const facts = [['Mobile', item.mobile], ['WhatsApp', item.whatsapp_mobile], ['Email', item.email], ['Birth date', item.date_of_birth], ['Nationality', item.nationality], ['Address', item.address], ['Previous academy', item.previous_academy], ['School / university', item.school_university], ['Father', `${item.father_name} · ${item.father_mobile}`], ['Mother', `${item.mother_name} · ${item.mother_mobile}`], ['Medical concerns', item.medical_concerns], ['Medications', item.medications]];
  return <View style={styles.stack}><AppButton compact label="Back to newcomers" onPress={onBack} variant="ghost" /><Text style={styles.title}>{item.full_name}</Text>{facts.map(([label, value]) => <View key={label} style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text selectable style={styles.factValue}>{value}</Text></View>)}
    <ChoiceField label="Pipeline stage" onChange={(value) => save.mutate(() => api.updateNewcomer(item.id, { stage: value as NewcomerStage, last_contacted_at: value === 'contacted' ? new Date().toISOString() : item.last_contacted_at }))} options={['new', 'contacted', 'follow_up', 'trial_booked'].map((value) => ({ label: value.replaceAll('_', ' '), value }))} value={item.stage === 'closed' ? '' : item.stage} />
    <View style={styles.section}><Text style={styles.sectionTitle}>Follow-up</Text><Text style={styles.meta}>Last contacted: {item.last_contacted_at ? formatEgyptDateTime(item.last_contacted_at) : 'Not contacted yet'}</Text><DateTimeField label="Next follow-up (Egypt time)" onChange={setFollowUp} value={followUp} /><View style={styles.filters}><AppButton compact label="Save follow-up" onPress={() => save.mutate(() => api.updateNewcomer(item.id, { next_follow_up_at: followUp, stage: item.stage === 'new' ? 'follow_up' : item.stage }))} style={styles.flex} /><AppButton compact label="Clear" onPress={() => save.mutate(() => api.updateNewcomer(item.id, { next_follow_up_at: null }))} variant="ghost" /></View><AppButton compact label="Mark contacted now" onPress={() => save.mutate(() => api.updateNewcomer(item.id, { last_contacted_at: new Date().toISOString(), stage: item.stage === 'new' ? 'contacted' : item.stage }))} variant="secondary" /></View>
    <View style={styles.section}><Text style={styles.sectionTitle}>Assign & confirm</Text><ChoiceField label="AIMZ squad" onChange={setTeam} options={teams.map((value) => ({ label: value.name, value: value.id }))} value={team} /><PositionField label="Position" onChange={setPosition} value={position} /><FormField label="Jersey number (optional)" keyboardType="number-pad" onChangeText={setJersey} value={jersey} /><AppButton disabled={!team || !position} label="Assign & confirm" loading={save.isPending} onPress={() => save.mutate(async () => { const result = await api.assignNewcomer(item.id, { team_id: team, position, jersey_number: jersey ? Number(jersey) : null }); if (result.invitation?.code) showMessage('Player confirmed', `Invitation: ${result.invitation.code}\n${result.invitation.share_url}`); return result; })} /></View>
    <View style={styles.section}><Text style={styles.sectionTitle}>Call notes</Text><FormField label="New note" multiline onChangeText={setNote} value={note} /><AppButton disabled={!note.trim()} label="Add note" onPress={() => save.mutate(async () => { await api.addNewcomerNote(item.id, note); setNote(''); })} />{item.notes.map((entry) => <View key={entry.id} style={styles.note}><Text style={styles.meta}>{formatEgyptDateTime(entry.created_at)}</Text><Text style={styles.factValue}>{entry.body}</Text></View>)}</View>
    {item.stage !== 'closed' ? <View style={styles.stack}><AppButton label="Mark joined" onPress={() => close('joined')} variant="secondary" /><AppButton label="Not interested" onPress={() => close('not_interested')} variant="ghost" /><AppButton label="Decline" onPress={() => close('declined')} variant="danger" /></View> : null}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ stack: { gap: theme.spacing.md }, filters: { flexDirection: 'row', gap: theme.spacing.sm }, flex: { flex: 1 }, counter: { backgroundColor: colors.highlightedSurface, borderRadius: theme.radius.md, color: colors.textPrimary, fontWeight: '800', padding: theme.spacing.md }, card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md }, name: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '900' }, meta: { color: colors.textMuted, fontSize: theme.type.label }, badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, badge: { backgroundColor: colors.surfaceRaised, borderRadius: 99, color: colors.textSecondary, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4, textTransform: 'capitalize' }, warning: { backgroundColor: colors.warningSurface, borderRadius: 99, color: colors.warningText, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4 }, overdue: { color: colors.errorText, fontWeight: '800' }, title: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, fact: { borderBottomColor: colors.border, borderBottomWidth: 1, gap: 4, paddingVertical: theme.spacing.sm }, factLabel: { color: colors.textMuted, fontSize: theme.type.label, fontWeight: '700' }, factValue: { color: colors.textPrimary, lineHeight: 22 }, section: { backgroundColor: colors.surface, borderRadius: theme.radius.md, gap: theme.spacing.md, padding: theme.spacing.md }, sectionTitle: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '900' }, note: { backgroundColor: colors.surfaceRaised, borderRadius: theme.radius.sm, gap: 4, padding: theme.spacing.sm } });
