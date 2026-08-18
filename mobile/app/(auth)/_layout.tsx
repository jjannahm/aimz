import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/src/auth/AuthProvider';

export default function AuthLayout() {
  const { isReady, user } = useAuth();
  if (isReady && user) return <Redirect href="/(app)/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
