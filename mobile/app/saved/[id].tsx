import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { OutfitCollage } from '@/components/app/outfit-collage';
import { OutfitSkeleton } from '@/components/app/skeletons';
import { Button } from '@/components/app/button';
import { Text } from '@/components/ui/text';
import { useCoords } from '@/lib/location';
import {
  type SavedOutfit,
  useConfirmDeleteOutfit,
  useSavedOutfits,
  useWearSavedToday,
} from '@/lib/outfits';

function Saved({ saved }: { saved: SavedOutfit }) {
  const wearToday = useWearSavedToday(useCoords());
  const confirmDelete = useConfirmDeleteOutfit(saved.id);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-10">
      <View className="aspect-[3/4]">
        <OutfitCollage garments={saved.garments} />
      </View>
      <Button
        size="lg"
        disabled={wearToday.isPending}
        onPress={() => wearToday.mutate(saved.id, { onSuccess: () => router.dismissTo('/') })}>
        <Text className="font-sans-semibold">
          {wearToday.isPending ? 'Preparando…' : 'Usarlo hoy'}
        </Text>
      </Button>
      <Button variant="ghost" onPress={() => confirmDelete(() => router.back())}>
        <Text className="text-destructive">Eliminar outfit</Text>
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
    <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
      <Text className="text-center">Este outfit ya no existe.</Text>
      <Button variant="outline" onPress={() => router.back()}>
        <Text className="font-sans-semibold">Volver</Text>
      </Button>
    </View>
  );
}
