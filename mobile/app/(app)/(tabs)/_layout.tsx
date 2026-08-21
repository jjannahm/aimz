import { Tabs } from 'expo-router';

import { useAuth } from '@/src/auth/AuthProvider';
import { TabIcon } from '@/src/components/TabIcon';
import { useColors } from '@/src/theme/ThemeProvider';

export default function TabsLayout() {
  const colors = useColors();
  const { user } = useAuth();
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: colors.accentSoft,
    tabBarInactiveTintColor: colors.textMuted,
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, minHeight: 64, paddingTop: 6 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
  }}>
    <Tabs.Screen name="index" options={{ title: 'Matches', tabBarIcon: ({ color, size }) => <TabIcon color={color} name="matches" size={size} /> }} />
    <Tabs.Screen name="standings" options={{ title: 'Standings', tabBarIcon: ({ color, size }) => <TabIcon color={color} name="standings" size={size} /> }} />
    <Tabs.Screen name="players" options={{ title: 'Players', tabBarIcon: ({ color, size }) => <TabIcon color={color} name="players" size={size} /> }} />
    <Tabs.Screen name="manage" options={{ title: 'Manage', href: user?.role === 'admin' ? undefined : null, tabBarIcon: ({ color, size }) => <TabIcon color={color} name="manage" size={size} /> }} />
    <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <TabIcon color={color} name="settings" size={size} /> }} />
  </Tabs>;
}
