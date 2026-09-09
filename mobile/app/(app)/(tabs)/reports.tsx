import { Redirect } from 'expo-router';
import React from 'react';

import { useAuth } from '@/src/auth/AuthProvider';
import { ReportsSection } from '@/src/components/ReportsSection';
import { Screen } from '@/src/components/Screen';

/**
 * What a coach has written about your player, on the way in rather than three
 * presses down inside the Hub.
 *
 * A report is written about a squad player, so an admin has none of their own
 * to read: the tab is off their dock, and the route turns them away as well,
 * the way Hub does — hiding a tab does not unregister its route.
 */
export default function ReportsScreen() {
  const { user } = useAuth();
  if (user?.role === 'admin') return <Redirect href="/(app)/(tabs)" />;
  return <Screen title="Reports">
    <ReportsSection />
  </Screen>;
}
