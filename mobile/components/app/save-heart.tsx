import { HeartIcon } from 'lucide-react-native';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { selectionFeedback } from '@/lib/haptics';
import { type Outfit, useSaveOutfit, useUnsaveOutfit } from '@/lib/outfits';
import { THEME } from '@/lib/theme';

// Sits on the white collage canvas, so it always uses the light theme's ink.
const INK = THEME.light.foreground;

export function SaveHeart({ outfit }: { outfit: Pick<Outfit, 'garments' | 'saved_id'> }) {
  const save = useSaveOutfit();
  const unsave = useUnsaveOutfit();
  const saved = Boolean(outfit.saved_id);
  const scale = useSharedValue(1);
  const beat = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  function toggle(): void {
    selectionFeedback();
    if (outfit.saved_id) {
      unsave.mutate(outfit.saved_id);
    } else {
      // A quick beat says "saved" before the server even answers.
      scale.value = withSequence(
        withTiming(1.2, { duration: 110 }),
        withTiming(1, { duration: 140 })
      );
      save.mutate(outfit.garments);
    }
  }

  return (
    <Pressable
      accessibilityLabel={saved ? 'Quitar de guardados' : 'Guardar outfit'}
      accessibilityState={{ selected: saved }}
      disabled={save.isPending || unsave.isPending}
      hitSlop={10}
      onPress={toggle}
      className="absolute right-3 top-3 h-11 w-11 items-center justify-center rounded-full bg-white/90 active:opacity-70">
      <Animated.View style={beat}>
        <Icon
          as={HeartIcon}
          size={22}
          color={INK}
          fill={saved || save.isPending ? INK : 'transparent'}
        />
      </Animated.View>
    </Pressable>
  );
}
