import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { useAuth } from '@/src/auth/AuthProvider';
import { theme } from '@/src/theme';

export default function TabsLayout() {
  const { user } = useAuth();
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: theme.colors.lightBlue,
    tabBarInactiveTintColor: theme.colors.textMuted,
    tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, minHeight: 64, paddingTop: 6 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
  }}>
    <Tabs.Screen name="index" options={{ title: 'Matches', tabBarIcon: ({ color, size }) => <Ionicons color={color} name="football-outline" size={size} /> }} />
    <Tabs.Screen name="standings" options={{ title: 'Standings', tabBarIcon: ({ color, size }) => <Ionicons color={color} name="podium-outline" size={size} /> }} />
    <Tabs.Screen name="players" options={{ title: 'Players', tabBarIcon: ({ color, size }) => <Ionicons color={color} name="people-outline" size={size} /> }} />
    <Tabs.Screen name="manage" options={{ title: 'Manage', href: user?.role === 'admin' ? undefined : null, tabBarIcon: ({ color, size }) => <Ionicons color={color} name="create-outline" size={size} /> }} />
    <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons color={color} name="settings-outline" size={size} /> }} />
  </Tabs>;
}
