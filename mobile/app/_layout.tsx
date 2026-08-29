import { Ionicons } from '@expo/vector-icons';
import { SpaceGrotesk_400Regular } from '@expo-google-fonts/space-grotesk/400Regular';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { AuthProvider } from '@/src/auth/AuthProvider';
import { DialogHost } from '@/src/components/DialogHost';
import { ToastHost } from '@/src/components/ToastHost';
import { ThemeProvider, useAppTheme } from '@/src/theme/ThemeProvider';

// Nothing registered the icon font on web, so every Ionicons glyph fell back to a
// tofu box. The bundled copy is unreachable once deployed: its asset path sits
// under pnpm's `.pnpm` directory, and Cloudflare Pages does not serve dot
// directories, so requests fall through to the SPA rewrite and return HTML.
// `public/fonts` is copied to the deploy root verbatim, which gives web a stable
// URL; native keeps using the bundled asset.
const iconFont = Platform.OS === 'web' ? { ionicons: '/fonts/Ionicons.ttf' } : Ionicons.font;
const appFonts = {
  ...iconFont,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
};

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedRoot />
    </ThemeProvider>
  );
}

// Split from `RootLayout` so the tree below can read the theme the provider
// resolves: the status bar, the stack background and the font-loading holder
// all have to follow the mode.
function ThemedRoot() {
  const { colors, mode } = useAppTheme();
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 20_000 } },
  }));
  const [fontsLoaded, fontError] = useFonts(appFonts);
  if (!fontsLoaded && !fontError) return <View style={{ backgroundColor: colors.background, flex: 1 }} />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerShown: false, animation: 'fade' }} />
        <DialogHost />
        <ToastHost />
      </AuthProvider>
    </QueryClientProvider>
  );
}
