import { router } from 'expo-router';
import { CheckIcon, RefreshCwIcon } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ChoiceChips } from '@/components/app/choice-chips';
import { FirstOutfitChecklist } from '@/components/app/first-outfit-checklist';
import { DislikeButton, FeelingRow, YesterdayFeeling } from '@/components/app/outfit-feeling';
import { OutfitCollage } from '@/components/app/outfit-collage';
import { OutfitTransition } from '@/components/app/outfit-transition';
import { Pulse } from '@/components/app/pulse';
import { SaveHeart } from '@/components/app/save-heart';
import { Spinner } from '@/components/app/spinner';
import { TodayHeader } from '@/components/app/today-header';
import { Button } from '@/components/app/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { ApiError } from '@/lib/api';
import { tellFailure } from '@/lib/confirm';
import { type Garment, type GarmentCategory, useGarments } from '@/lib/garments';
import { successFeedback, tapFeedback } from '@/lib/haptics';
import { useCoords } from '@/lib/location';
import {
  localDay,
  OCCASIONS,
  openSwap,
  type Outfit,
  retryFailedOutfits,
  useAnotherOutfit,
  useOccasion,
  useTodayOutfit,
  useUnwearOutfit,
  useWearOutfit,
} from '@/lib/outfits';

const SLOT_TEXT: Record<GarmentCategory, string> = {
  top: 'parte de arriba',
  bottom: 'parte de abajo',
  one_piece: 'vestido o enterizo',
  outerwear: 'chaqueta o abrigo',
  shoes: 'zapatos',
  accessory: 'accesorio',
};

function canDress(garments: Garment[]): boolean {
  const has = new Set(garments.filter((g) => g.status === 'ready').map((g) => g.category));
  return has.has('shoes') && (has.has('one_piece') || (has.has('top') && has.has('bottom')));
}

function offOccasionNote(outfit: Outfit): string | null {
  if (!outfit.off_occasion?.length) return null;
  const slots = outfit.off_occasion.map((category) => SLOT_TEXT[category]);
  const list =
    slots.length === 1 ? slots[0] : `${slots.slice(0, -1).join(', ')} ni ${slots.at(-1)}`;
  const occasion = OCCASIONS.find((option) => option.value === outfit.occasion)?.label;
  return `Aún no tienes ${list} para «${occasion}», así que usamos lo más cercano.`;
}

function Message({
  title,
  body,
  children,
}: React.PropsWithChildren<{ title: string; body: string }>) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      <Text className="text-center font-sans-semibold text-xl">{title}</Text>
      <Text className="text-center text-muted-foreground">{body}</Text>
      {children}
    </View>
  );
}

export default function TodayScreen() {
  const { data: garments = [], isLoading: loadingGarments } = useGarments();
  // Asked when the first outfit is possible, so the weather has a reason to be needed.
  const coords = useCoords(canDress(garments), loadingGarments);
  const { occasion, setOccasion } = useOccasion();
  const today = useTodayOutfit(occasion, coords);
  const another = useAnotherOutfit(coords);
  const wear = useWearOutfit(coords);
  const unwear = useUnwearOutfit(coords);

  // A failed attempt is only worth repeating once another garment has been catalogued.
  const readyCount = garments.filter((garment) => garment.status === 'ready').length;
  React.useEffect(retryFailedOutfits, [readyCount]);
  const noMoreOutfits =
    another.error instanceof ApiError && another.error.code === 'no_more_outfits';
  const switching = today.isPlaceholderData;
  const needsGarments =
    today.error instanceof ApiError && today.error.code === 'not_enough_garments';
  // After deleting clothes, the last outfit stays cached but its garments may be gone.
  const outfit = needsGarments ? undefined : today.data;
  const busy = another.isPending || wear.isPending || switching;

  function changeOccasion(next: typeof occasion): void {
    another.reset();
    setOccasion(next);
  }

  return (
    <View className="flex-1 bg-background">
      {/* "Tu estilo" appears once there is an outfit it can improve, never before the first one. */}
      <TodayHeader forecast={outfit?.forecast ?? null} showStyle={Boolean(outfit)} />
      <View className="flex-1 gap-4 px-4 pb-4">
        {/* Occasions mean nothing until the closet can make an outfit. */}
        {!needsGarments && (
          <ChoiceChips options={OCCASIONS} selected={occasion} onSelect={changeOccasion} />
        )}

        {outfit ? (
          <>
            <YesterdayFeeling />
            <OutfitTransition dimmed={another.isPending || switching}>
              <View className="flex-1">
                {/* A new outfit is laid out whole, even when it shares pieces with the last one. */}
                <OutfitCollage
                  key={outfit.id}
                  garments={outfit.garments}
                  reveal
                  // Today's question is "what else could I wear", more than "what is this piece".
                  onPiecePress={
                    outfit.worn
                      ? undefined
                      : (slot) => {
                          if (!busy) openSwap(outfit, slot);
                        }
                  }
                />
                <SaveHeart outfit={outfit} />
                {!outfit.worn && <DislikeButton outfit={outfit} disabled={busy} />}
              </View>

              <Animated.View key={outfit.id} entering={FadeIn.duration(200)}>
                <Text className="text-center font-serif-italic text-lg leading-6">
                  {outfit.explanation}
                </Text>
              </Animated.View>
            </OutfitTransition>
            {offOccasionNote(outfit) && (
              <Text className="text-center text-sm text-muted-foreground">
                {offOccasionNote(outfit)}
              </Text>
            )}
            {noMoreOutfits && (
              <Text className="text-center text-sm text-muted-foreground">
                No hay más combinaciones por hoy con tu armario.
              </Text>
            )}

            {outfit.worn ? (
              <View className="flex-row gap-3">
                <Animated.View entering={FadeIn.duration(150)} className="flex-1">
                  <View className="h-12 flex-row items-center justify-center gap-2 rounded-full bg-secondary">
                    <Icon as={CheckIcon} size={18} />
                    <Text className="font-sans-medium">Lo llevas hoy</Text>
                  </View>
                </Animated.View>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={unwear.isPending}
                  onPress={() => {
                    tapFeedback();
                    unwear.mutate(outfit);
                  }}>
                  <Text className="font-sans-semibold">Deshacer</Text>
                </Button>
              </View>
            ) : (
              <View className="flex-row gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={busy || noMoreOutfits}
                  onPress={() => {
                    tapFeedback();
                    another.mutate(outfit, {
                      // Running out of combinations has its own message above.
                      onError: (error) => {
                        if (!(error instanceof ApiError && error.code === 'no_more_outfits')) {
                          tellFailure();
                        }
                      },
                    });
                  }}>
                  {another.isPending ? (
                    <Spinner size="small" />
                  ) : (
                    <Icon as={RefreshCwIcon} size={16} />
                  )}
                  <Text className="font-sans-semibold">Otra</Text>
                </Button>
                <Button
                  size="lg"
                  className="flex-1"
                  disabled={busy}
                  onPress={() => wear.mutate(outfit, { onSuccess: successFeedback })}>
                  <Text className="font-sans-semibold">Me lo pongo</Text>
                </Button>
              </View>
            )}
            {outfit.worn ? (
              <FeelingRow outfit={outfit} />
            ) : (
              <View className="-mb-2 -mt-2 flex-row flex-wrap justify-center">
                <Button variant="ghost" size="sm" disabled={busy} onPress={() => openSwap(outfit)}>
                  <Text className="font-sans-medium text-muted-foreground">Cambiar prenda</Text>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onPress={() =>
                    router.push({
                      pathname: '/outfit/new',
                      params: { mode: 'plan', day: localDay(), occasion },
                    })
                  }>
                  <Text className="font-sans-medium text-muted-foreground">Armarlo yo</Text>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  accessibilityLabel="Pedir algo distinto"
                  onPress={() => router.push('/outfit-request')}>
                  <Text className="font-sans-medium text-muted-foreground">Pedir algo</Text>
                </Button>
              </View>
            )}
          </>
        ) : needsGarments ? (
          <FirstOutfitChecklist />
        ) : today.isError ? (
          <Message
            title="No pudimos armar tu outfit"
            body="Revisa tu conexión e inténtalo de nuevo.">
            <Button variant="outline" onPress={() => void today.refetch()}>
              <Text className="font-sans-semibold">Reintentar</Text>
            </Button>
          </Message>
        ) : (
          <Pulse style={{ flex: 1, gap: 16 }}>
            <View className="flex-1 rounded-3xl bg-muted" />
            <Text className="text-center font-serif-italic text-lg leading-6 text-muted-foreground">
              Armando tu outfit…
            </Text>
            <View className="h-12 rounded-full bg-muted" />
          </Pulse>
        )}
      </View>
    </View>
  );
}
