import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { AuthProvider } from '@/src/auth/AuthProvider';
import { theme } from '@/src/theme';

// Nothing registered the icon font on web, so every Ionicons glyph fell back to a
// tofu box. The bundled copy is unreachable once deployed: its asset path sits
// under pnpm's `.pnpm` directory, and Cloudflare Pages does not serve dot
// directories, so requests fall through to the SPA rewrite and return HTML.
// `public/fonts` is copied to the deploy root verbatim, which gives web a stable
// URL; native keeps using the bundled asset.
const iconFont = Platform.OS === 'web' ? { ionicons: '/fonts/Ionicons.ttf' } : Ionicons.font;

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 20_000 } },
  }));
  const [iconsLoaded, iconError] = useFonts(iconFont);
  if (!iconsLoaded && !iconError) return <View style={{ backgroundColor: theme.colors.background, flex: 1 }} />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ contentStyle: { backgroundColor: theme.colors.background }, headerShown: false, animation: 'fade' }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
