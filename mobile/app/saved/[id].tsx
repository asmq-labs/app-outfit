import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { OutfitCollage } from '@/components/app/outfit-collage';
import { OutfitSkeleton } from '@/components/app/skeletons';
import { Button } from '@/components/app/button';
import { Text } from '@/components/ui/text';
import { ApiError } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import { useCoords } from '@/lib/location';
import {
  type SavedOutfit,
  useSavedOutfits,
  useUnsaveOutfit,
  useWearSavedToday,
} from '@/lib/outfits';

function Saved({ saved }: { saved: SavedOutfit }) {
  const wearToday = useWearSavedToday(useCoords());
  const unsave = useUnsaveOutfit();
  const notEnough =
    wearToday.error instanceof ApiError && wearToday.error.code === 'not_enough_garments';

  function confirmUnsave(): void {
    askToConfirm({
      title: '¿Quitar de guardados?',
      body: 'Tus prendas no se tocan.',
      action: 'Quitar',
      onConfirm: () => unsave.mutate(saved.id, { onSuccess: () => router.back() }),
    });
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-10">
      <View className="aspect-[3/4]">
        <OutfitCollage garments={saved.garments} />
      </View>
      {notEnough && (
        <Text className="text-center text-sm text-muted-foreground">
          Alguna prenda de este outfit ya no está en tu armario.
        </Text>
      )}
      <Button
        size="lg"
        disabled={wearToday.isPending}
        onPress={() => wearToday.mutate(saved.id, { onSuccess: () => router.dismissTo('/') })}>
        <Text className="font-sans-semibold">
          {wearToday.isPending ? 'Preparando…' : 'Usarlo hoy'}
        </Text>
      </Button>
      <Button variant="ghost" onPress={confirmUnsave}>
        <Text className="text-destructive">Quitar de guardados</Text>
      </Button>
    </ScrollView>
  );
}

export default function SavedOutfitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: list, isLoading } = useSavedOutfits();
  const saved = list?.find((item) => item.id === id);

  if (saved) return <Saved saved={saved} />;

  if (isLoading) {
    return (
      <View className="flex-1 bg-background">
        <OutfitSkeleton />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-background px-8">
      <Text className="text-center">Este outfit ya no existe.</Text>
    </View>
  );
}
