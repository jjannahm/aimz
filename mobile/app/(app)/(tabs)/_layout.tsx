import { Tabs } from 'expo-router';

import { useAuth } from '@/src/auth/AuthProvider';
import { FloatingTabBar } from '@/src/components/FloatingTabBar';

export default function TabsLayout() {
  const { user } = useAuth();
  // The bar floats over the page, so it draws itself rather than taking a
  // strip of the layout. Each screen leaves room for it at the foot of its
  // scroller.
  return <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} />}>
    <Tabs.Screen name="index" options={{ title: 'Matches' }} />
    <Tabs.Screen name="standings" options={{ title: 'Standings' }} />
    <Tabs.Screen name="players" options={{ title: 'Players' }} />
    <Tabs.Screen name="my-team" options={{ title: 'Hub', href: user?.role === 'admin' ? null : undefined }} />
    <Tabs.Screen name="manage" options={{ title: 'Manage', href: user?.role === 'admin' ? undefined : null }} />
    {/* Reached from the gear in every screen's header now, not the tab bar.
      * The route stays registered so `href: null` only takes it off the bar. */}
    <Tabs.Screen name="settings" options={{ title: 'Settings', href: null }} />
  </Tabs>;
}
