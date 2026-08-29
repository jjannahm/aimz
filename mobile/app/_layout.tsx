import { Ionicons } from '@expo/vector-icons';
import { Roboto_400Regular } from '@expo-google-fonts/roboto/400Regular';
import { Roboto_500Medium } from '@expo-google-fonts/roboto/500Medium';
import { Roboto_600SemiBold } from '@expo-google-fonts/roboto/600SemiBold';
import { Roboto_700Bold } from '@expo-google-fonts/roboto/700Bold';
import { RobotoMono_500Medium } from '@expo-google-fonts/roboto-mono/500Medium';
import { RobotoMono_700Bold } from '@expo-google-fonts/roboto-mono/700Bold';
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

// The app's own faces land in that same unreachable place, for the same reason:
// Metro mirrors an asset's source path, and pnpm's is a dot directory. Left
// alone the page would render in a system face rather than saying anything was
// wrong. `scripts/copy-web-fonts.mjs` lifts them to `/fonts` after the export,
// so web asks for them there and native keeps the bundled asset.
const webFont = (family: string) => `/fonts/${family}.ttf`;
const textFonts = Platform.OS === 'web'
  ? {
    Roboto_400Regular: webFont('Roboto_400Regular'),
    Roboto_500Medium: webFont('Roboto_500Medium'),
    Roboto_600SemiBold: webFont('Roboto_600SemiBold'),
    Roboto_700Bold: webFont('Roboto_700Bold'),
    RobotoMono_500Medium: webFont('RobotoMono_500Medium'),
    RobotoMono_700Bold: webFont('RobotoMono_700Bold'),
  }
  : {
    Roboto_400Regular,
    Roboto_500Medium,
    Roboto_600SemiBold,
    Roboto_700Bold,
    RobotoMono_500Medium,
    RobotoMono_700Bold,
  };
const appFonts = { ...iconFont, ...textFonts };

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
