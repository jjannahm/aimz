import { Redirect } from 'expo-router';
import React from 'react';

import { useAuth } from '@/src/auth/AuthProvider';
import { AnnouncementsSection } from '@/src/components/myTeam/AnnouncementsSection';
import { HubBackdrop } from '@/src/components/myTeam/HubBackdrop';
import { HubSwitcher } from '@/src/components/myTeam/HubSwitcher';
import { ScheduleSection } from '@/src/components/myTeam/ScheduleSection';
import { Screen } from '@/src/components/Screen';

const sections = [{ value: 'schedule', label: 'Schedule' }, { value: 'announcements', label: 'Announcements' }] as const;
type Section = (typeof sections)[number]['value'];

export default function HubScreen() {
  const { user } = useAuth();
  const [selected, setSelected] = React.useState<Section>('schedule');
  if (user?.role === 'admin') return <Redirect href="/(app)/(tabs)" />;
  return <Screen title="Hub">
    {/* Behind everything: what the hub's glass has to look through. */}
    <HubBackdrop />
    <HubSwitcher label="Hub section" onChange={setSelected} options={sections} value={selected} />
    {selected === 'schedule' ? <ScheduleSection /> : <AnnouncementsSection />}
  </Screen>;
}
