import { Image } from 'expo-image';
import * as SecureStore from 'expo-secure-store';
import { ThumbsDownIcon, ThumbsUpIcon, XIcon } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/app/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useGarmentImage, type Garment } from '@/lib/garments';
import { tapFeedback } from '@/lib/haptics';
import {
  FEELING_REASONS,
  type Feeling,
  localDay,
  openFeeling,
  type Outfit,
  useCalendar,
} from '@/lib/outfits';
import { THEME } from '@/lib/theme';

// Sits on the white collage canvas, so it always uses the light theme's ink.
const INK = THEME.light.foreground;
const DISMISSED_DAY_KEY = 'feeling_prompt_dismissed_day';

const OPINION: Record<Feeling, string> = { good: 'Te gustó', bad: 'No te convenció' };

function opinionText(outfit: Outfit): string {
  if (!outfit.feeling) return '¿Cómo te sentiste con este outfit?';
  const reasons = FEELING_REASONS[outfit.feeling]
    .filter(({ value }) => outfit.feeling_reasons.includes(value))
    .map(({ label }) => label.toLowerCase())
    .join(', ');
  return reasons ? `${OPINION[outfit.feeling]}: ${reasons}.` : `${OPINION[outfit.feeling]}.`;
}

// Beside the heart: saving keeps an outfit, this one says it is not for you and moves on.
export function DislikeButton({ outfit, disabled }: { outfit: Outfit; disabled: boolean }) {
  const disliked = outfit.feeling === 'bad';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="No me convence este outfit"
      accessibilityState={{ selected: disliked }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        tapFeedback();
        openFeeling(outfit, 'bad', true);
      }}
      className="absolute right-3 top-16 h-11 w-11 items-center justify-center rounded-full bg-white/90 active:opacity-70">
      <Icon as={ThumbsDownIcon} size={20} color={INK} fill={disliked ? INK : 'transparent'} />
    </Pressable>
  );
}

function FeelingButton({
  outfit,
  feeling,
  icon,
  label,
}: {
  outfit: Outfit;
  feeling: Feeling;
  icon: typeof ThumbsUpIcon;
  label: string;
}) {
  const active = outfit.feeling === feeling;
  return (
    <Button
      variant={active ? 'secondary' : 'outline'}
      className="flex-1"
      accessibilityState={{ selected: active }}
      onPress={() => {
        tapFeedback();
        openFeeling(outfit, feeling);
      }}>
      <Icon as={icon} size={16} fill={active ? 'currentColor' : 'transparent'} />
      <Text className="font-sans-semibold">{label}</Text>
    </Button>
  );
}

// Once it was worn there is a real answer to give, so the question comes after "Me lo pongo".
export function FeelingRow({ outfit }: { outfit: Outfit }) {
  return (
    <View className="gap-2">
      <Text className="text-center text-sm text-muted-foreground">{opinionText(outfit)}</Text>
      <View className="flex-row gap-3">
        <FeelingButton outfit={outfit} feeling="good" icon={ThumbsUpIcon} label="Bien" />
        <FeelingButton outfit={outfit} feeling="bad" icon={ThumbsDownIcon} label="No tanto" />
      </View>
    </View>
  );
}

function Thumbnail({ garment }: { garment: Garment }) {
  const image = useGarmentImage(garment, { size: 'thumb' });
  return (
    <View className="h-10 w-10 overflow-hidden rounded-lg bg-white">
      <Image source={image} contentFit="contain" style={{ flex: 1 }} />
    </View>
  );
}

function PromptIcon({
  icon,
  label,
  onPress,
}: {
  icon: typeof ThumbsUpIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      className="h-10 w-10 items-center justify-center rounded-full active:bg-accent">
      <Icon as={icon} size={18} />
    </Pressable>
  );
}

function yesterday(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDay(date);
}

// The honest moment to ask is the next morning, when the whole day has been lived in that outfit.
export function YesterdayFeeling() {
  const day = yesterday();
  const { data: outfits = [] } = useCalendar(day, day);
  // Undefined until read, so the prompt never flashes on a morning it was already dismissed.
  const [dismissedDay, setDismissedDay] = React.useState<string | null | undefined>(undefined);

  React.useEffect(() => {
    SecureStore.getItemAsync(DISMISSED_DAY_KEY)
      .catch(() => null)
      .then(setDismissedDay);
  }, []);

  const outfit = outfits.find((item) => item.worn && !item.feeling);
  if (!outfit || dismissedDay === undefined || dismissedDay === day) return null;

  const { one_piece, top, bottom, shoes } = outfit.garments;
  const garment = one_piece ?? top ?? bottom ?? shoes;

  function dismiss(): void {
    setDismissedDay(day);
    void SecureStore.setItemAsync(DISMISSED_DAY_KEY, day).catch(() => undefined);
  }

  return (
    <View className="flex-row items-center gap-2 rounded-2xl bg-secondary py-2 pl-2 pr-1">
      {garment && <Thumbnail garment={garment} />}
      <Text className="flex-1 pl-1 text-sm">¿Qué tal el outfit de ayer?</Text>
      <PromptIcon
        icon={ThumbsUpIcon}
        label="Me sentí bien"
        onPress={() => openFeeling(outfit, 'good')}
      />
      <PromptIcon
        icon={ThumbsDownIcon}
        label="No tanto"
        onPress={() => openFeeling(outfit, 'bad')}
      />
      <PromptIcon icon={XIcon} label="Ahora no" onPress={dismiss} />
    </View>
  );
}
