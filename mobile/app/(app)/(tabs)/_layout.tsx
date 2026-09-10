import { Redirect, Tabs } from 'expo-router';

import { useAuth } from '@/src/auth/AuthProvider';
import { FloatingTabBar } from '@/src/components/FloatingTabBar';
import { tabsForRole } from '@/src/lib/navigation';

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
  // An application still being read has no academy to look at yet.
  if (user?.onboarding_status === 'pending') return <Redirect href={'/(app)/pending' as never} />;
  // Which tabs this account gets is a rule, and it lives in one place beside
  // the roles it is about rather than inline here. Declaration order is dock
  // order, so the list comes back in the order it is drawn.
  const tabs = tabsForRole(user?.role);

  // The bar floats over the page, so it draws itself rather than taking a
  // strip of the layout. Each screen leaves room for it at the foot of its
  // scroller.
  return <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} />}>
    {/* Every route stays registered whatever the role: a tab leaves the dock by
      * having no `href`, which keeps a deep link to it resolving. */}
    {tabs.map((tab) => <Tabs.Screen key={tab.name} name={tab.name} options={{ href: tab.onBar ? undefined : null, title: tab.title }} />)}
  </Tabs>;
}
