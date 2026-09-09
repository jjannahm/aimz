import { Tabs } from 'expo-router';

import { useAuth } from '@/src/auth/AuthProvider';
import { FloatingTabBar } from '@/src/components/FloatingTabBar';
import { tabsForRole } from '@/src/lib/navigation';
import { useHasCompetition } from '@/src/lib/squad';

export default function TabsLayout() {
  const { user } = useAuth();
  const { hasCompetition } = useHasCompetition();
  // Which tabs this account gets is a rule, and it lives in one place beside
  // the roles it is about rather than inline here.
  const tabs = tabsForRole(user?.role, hasCompetition);

  // The bar floats over the page, so it draws itself rather than taking a
  // strip of the layout. Each screen leaves room for it at the foot of its
  // scroller.
  return <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} />}>
    {/* Every route stays registered whatever the role: a tab leaves the bar by
      * having no `href`, which keeps a deep link to it resolving. */}
    {tabs.map((tab) => <Tabs.Screen key={tab.name} name={tab.name} options={{ href: tab.onBar ? undefined : null, title: tab.title }} />)}
  </Tabs>;
}
