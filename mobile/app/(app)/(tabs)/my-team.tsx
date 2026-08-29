import { Redirect } from 'expo-router';
import React from 'react';

import { useAuth } from '@/src/auth/AuthProvider';
import { AnnouncementsSection } from '@/src/components/myTeam/AnnouncementsSection';
import { ScheduleSection } from '@/src/components/myTeam/ScheduleSection';
import { Screen } from '@/src/components/Screen';
import { SegmentedControl } from '@/src/components/SegmentedControl';

const sections = [{ value: 'schedule', label: 'Schedule' }, { value: 'announcements', label: 'Announcements' }] as const;
type Section = (typeof sections)[number]['value'];

export default function HubScreen() {
  const { user } = useAuth();
  const [selected, setSelected] = React.useState<Section>('schedule');
  if (user?.role === 'admin') return <Redirect href="/(app)/(tabs)" />;
  return <Screen title="Hub">
    <SegmentedControl label="Hub section" onChange={setSelected} options={sections} value={selected} />
    {selected === 'schedule' ? <ScheduleSection /> : <AnnouncementsSection />}
  </Screen>;
}
