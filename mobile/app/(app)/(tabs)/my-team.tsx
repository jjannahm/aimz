import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import React from 'react';

import { useAuth } from '@/src/auth/AuthProvider';
import { CalendarButton } from '@/src/components/CalendarButton';
import { AnnouncementsSection } from '@/src/components/myTeam/AnnouncementsSection';
import { KitSection } from '@/src/components/myTeam/KitSection';
import { ScheduleSection } from '@/src/components/myTeam/ScheduleSection';
import { Screen } from '@/src/components/Screen';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { SettingsButton } from '@/src/components/SettingsButton';
import { api } from '@/src/lib/api';
import { announcementsSeenStore } from '@/src/lib/announcementsSeen';

const sections = [{ value: 'schedule', label: 'Schedule' }, { value: 'announcements', label: 'Announcements' }, { value: 'kit', label: 'Kit' }] as const;
type Section = (typeof sections)[number]['value'];

export default function HubScreen() {
  const { user } = useAuth();
  const [selected, setSelected] = React.useState<Section>('schedule');
  // A parent has children rather than a player record of their own, and an
  // account linked to neither is served no announcements at all.
  const linked = user?.role === 'parent' || Boolean(user?.player_id);
  // The same key and query the section itself reads under, so the two share one
  // fetch rather than asking twice.
  const announcements = useQuery({ queryKey: ['announcements', 'mine'], queryFn: () => api.announcements('?limit=100'), enabled: linked && user?.role !== 'admin' });
  const seen = React.useSyncExternalStore(announcementsSeenStore.subscribe, announcementsSeenStore.get, announcementsSeenStore.get);

  React.useEffect(() => { void announcementsSeenStore.restore(); }, []);

  const urgent = React.useMemo(
    () => (announcements.data?.items ?? []).filter((item) => item.priority === 'urgent').map((item) => item.id),
    [announcements.data],
  );
  const unread = React.useMemo(() => {
    const known = new Set(seen);
    return urgent.filter((id) => !known.has(id));
  }, [seen, urgent]);

  // Opening the tab is reading them: the notices are on the screen the moment
  // it is, so the mark is made here rather than per card.
  React.useEffect(() => {
    if (selected === 'announcements' && unread.length) void announcementsSeenStore.markSeen(unread);
  }, [selected, unread]);

  const options = React.useMemo(
    () => sections.map((section) => section.value === 'announcements'
      ? { ...section, accessibilityLabel: unread.length ? 'Announcements, urgent unread' : 'Announcements', dot: unread.length > 0 }
      : section),
    [unread.length],
  );

  if (user?.role === 'admin') return <Redirect href="/(app)/(tabs)" />;
  // The calendar sits left of the gear, so the header cluster composes itself
  // rather than taking Screen's default. Screen puts its own settings button
  // ahead of whatever a screen passes, which is what keeps a close button on
  // the outside edge everywhere else — Standings opts out the same way.
  return <Screen action={<><CalendarButton /><SettingsButton /></>} hideSettings title="Hub">
    <SegmentedControl label="Hub section" onChange={setSelected} options={options} value={selected} />
    {selected === 'schedule' ? <ScheduleSection /> : selected === 'announcements' ? <AnnouncementsSection /> : <KitSection />}
  </Screen>;
}
