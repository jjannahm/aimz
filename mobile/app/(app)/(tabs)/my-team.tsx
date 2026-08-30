import { Redirect } from 'expo-router';
import React from 'react';

import { useAuth } from '@/src/auth/AuthProvider';
import { CalendarButton } from '@/src/components/CalendarButton';
import { AnnouncementsSection } from '@/src/components/myTeam/AnnouncementsSection';
import { ScheduleSection } from '@/src/components/myTeam/ScheduleSection';
import { Screen } from '@/src/components/Screen';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { SettingsButton } from '@/src/components/SettingsButton';

const sections = [{ value: 'schedule', label: 'Schedule' }, { value: 'announcements', label: 'Announcements' }] as const;
type Section = (typeof sections)[number]['value'];

export default function HubScreen() {
  const { user } = useAuth();
  const [selected, setSelected] = React.useState<Section>('schedule');
  if (user?.role === 'admin') return <Redirect href="/(app)/(tabs)" />;
  // The calendar sits left of the gear, so the header cluster composes itself
  // rather than taking Screen's default. Screen puts its own settings button
  // ahead of whatever a screen passes, which is what keeps a close button on
  // the outside edge everywhere else — Standings opts out the same way.
  return <Screen action={<><CalendarButton /><SettingsButton /></>} hideSettings title="Hub">
    <SegmentedControl label="Hub section" onChange={setSelected} options={sections} value={selected} />
    {selected === 'schedule' ? <ScheduleSection /> : <AnnouncementsSection />}
  </Screen>;
}
