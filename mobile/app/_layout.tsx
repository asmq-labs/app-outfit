import '@/global.css';

import { PortalHost } from '@rn-primitives/portal';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { ThemeProvider } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import * as React from 'react';
import { View } from 'react-native';

import { Spinner } from '@/components/app/spinner';
import { Button } from '@/components/app/button';
import { Text } from '@/components/ui/text';
import { FONTS } from '@/lib/fonts';
import { queryClient } from '@/lib/query';
import { startSession, useSession } from '@/lib/session';
import { NAV_THEME } from '@/lib/theme';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

const SHEET = {
  headerShown: false,
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  sheetCornerRadius: 24,
} as const;

function SessionGate({ children }: { children: React.ReactNode }) {
  const status = useSession((state) => state.status);

  React.useEffect(() => {
    void startSession();
  }, []);

  if (status === 'ready') return children;

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
      {status === 'loading' ? (
        <Spinner />
      ) : (
        <>
          <Text className="text-center font-sans-semibold text-lg">No pudimos conectarnos</Text>
          <Text className="text-center text-muted-foreground">
            Revisa tu conexión a internet e inténtalo de nuevo.
          </Text>
          <Button onPress={() => void startSession()}>
            <Text className="font-sans-semibold">Reintentar</Text>
          </Button>
        </>
      )}
    </View>
  );
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const [fontsLoaded] = useFonts(FONTS);

  // Nothing is drawn until the fonts are ready, so text never jumps between typefaces.
  if (!fontsLoaded) return null;

  return (
    <ThemeProvider value={NAV_THEME[colorScheme ?? 'light']}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        <SessionGate>
          {/* One smooth push/pop for every detail screen, instead of Android's default fade. */}
          {/* Flat header with the serif title, like the tabs' own headers. */}
          <Stack
            screenOptions={{
              animation: 'ios_from_right',
              headerShadowVisible: false,
              headerTitleStyle: { fontFamily: 'Newsreader_500Medium', fontSize: 24 },
            }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="add"
              options={{
                headerShown: false,
                presentation: 'modal',
                animation: 'slide_from_bottom',
              }}
            />
            <Stack.Screen name="garment/[id]" options={{ title: 'Prenda' }} />
            <Stack.Screen name="basics" options={{ title: 'Básicos' }} />
            <Stack.Screen name="look/[id]" options={{ title: 'Look' }} />
            <Stack.Screen name="outfit/new" options={{ title: 'Outfit' }} />
            <Stack.Screen name="saved/[id]" options={{ title: 'Outfit guardado' }} />
            <Stack.Screen name="add-options" options={SHEET} />
            <Stack.Screen name="closet-filters" options={SHEET} />
            <Stack.Screen name="confirm" options={SHEET} />
          </Stack>
        </SessionGate>
        <PortalHost />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
