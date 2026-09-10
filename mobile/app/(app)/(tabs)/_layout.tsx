import { Redirect, Tabs } from 'expo-router';

import { useAuth } from '@/src/auth/AuthProvider';
import { FloatingTabBar } from '@/src/components/FloatingTabBar';

/**
 * Which tab the app opens on, said outright.
 *
 * A tab navigator with no anchor takes the first route declared, and Hub is
 * first now — which an admin does not have, and whose own guard would send them
 * straight back here. Matches is the landing tab, wherever it sits on the dock.
 */
export const unstable_settings = { anchor: 'index' };

export default function TabsLayout() {
  const { user } = useAuth();
  if (user?.onboarding_status === 'pending') return <Redirect href={'/(app)/pending' as never} />;
  // The bar floats over the page, so it draws itself rather than taking a
  // strip of the layout. Each screen leaves room for it at the foot of its
  // scroller.
  return <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} />}>
    {/* Declaration order is dock order. A family reads their own week first and
      * the academy's second, so Hub leads and Reports closes; an admin has
      * neither and reads Players, Matches, Manage. Standings is no longer a tab
      * at all — it is the last segment inside Matches. */}
    <Tabs.Screen name="my-team" options={{ title: 'Hub', href: user?.role === 'admin' ? null : undefined }} />
    <Tabs.Screen name="players" options={{ title: 'Players' }} />
    <Tabs.Screen name="index" options={{ title: 'Matches' }} />
    <Tabs.Screen name="reports" options={{ title: 'Reports', href: user?.role === 'admin' ? null : undefined }} />
    <Tabs.Screen name="manage" options={{ title: 'Manage', href: user?.role === 'admin' ? undefined : null }} />
    {/* Reached from the gear in every screen's header now, not the tab bar.
      * The route stays registered so `href: null` only takes it off the bar. */}
    <Tabs.Screen name="settings" options={{ title: 'Settings', href: null }} />
  </Tabs>;
}
