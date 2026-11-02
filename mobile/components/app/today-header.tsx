import { CloudRainIcon, CloudSunIcon, SunIcon } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { Outfit } from '@/lib/outfits';
import { useSession } from '@/lib/session';

const WARM_FROM_C = 22;

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function dateLabel(now = new Date()): string {
  const label = now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function Weather({ forecast }: { forecast: NonNullable<Outfit['forecast']> }) {
  const icon = forecast.rain
    ? CloudRainIcon
    : forecast.max_c >= WARM_FROM_C
      ? SunIcon
      : CloudSunIcon;
  const range = `${Math.round(forecast.min_c)}° a ${Math.round(forecast.max_c)}°`;
  return (
    <Animated.View entering={FadeIn.duration(150)}>
      <View className="flex-row items-center gap-1.5 self-start rounded-full bg-secondary px-3 py-1.5">
        <Icon as={icon} size={15} />
        <Text className="text-sm">{forecast.rain ? `${range} · lluvia probable` : range}</Text>
      </View>
    </Animated.View>
  );
}

export function TodayHeader({ forecast }: { forecast: Outfit['forecast'] }) {
  const insets = useSafeAreaInsets();
  // Guests have no name until they sign in with Google or Apple.
  const firstName = useSession((state) => state.user?.display_name?.split(' ')[0]);

  return (
    <View className="gap-2 px-4 pb-3" style={{ paddingTop: insets.top + 12 }}>
      <View>
        <Text className="text-sm text-muted-foreground">{dateLabel()}</Text>
        <Text numberOfLines={1} className="font-serif-medium text-4xl leading-tight">
          {firstName ? `${greeting()}, ${firstName}` : greeting()}
        </Text>
      </View>
      {forecast ? <Weather forecast={forecast} /> : <View className="h-8" />}
    </View>
  );
}
