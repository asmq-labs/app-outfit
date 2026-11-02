import { router } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';

import { OutfitCollage } from '@/components/app/outfit-collage';
import { Pulse } from '@/components/app/pulse';
import { Text } from '@/components/ui/text';
import { type SavedOutfit, useConfirmDeleteOutfit, useSavedOutfits } from '@/lib/outfits';

function SavedCard({ saved }: { saved: SavedOutfit }) {
  const confirmDelete = useConfirmDeleteOutfit(saved.id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ver outfit guardado"
      onPress={() => router.push({ pathname: '/saved/[id]', params: { id: saved.id } })}
      onLongPress={() => confirmDelete()}
      className="aspect-[4/5] max-w-[49%] flex-1 overflow-hidden rounded-3xl active:opacity-80">
      <OutfitCollage garments={saved.garments} size="thumb" />
    </Pressable>
  );
}

export function SavedOutfits() {
  const { data: saved = [], isLoading, refetch, isRefetching } = useSavedOutfits();

  if (isLoading) {
    return (
      <Pulse style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
        <View className="aspect-[4/5] flex-1 rounded-3xl bg-muted" />
        <View className="aspect-[4/5] flex-1 rounded-3xl bg-muted" />
      </Pulse>
    );
  }

  return (
    <FlatList
      data={saved}
      keyExtractor={(item) => item.id}
      numColumns={2}
      renderItem={({ item }) => <SavedCard saved={item} />}
      columnWrapperClassName="gap-2"
      contentContainerClassName="grow gap-2 px-4 pb-28 pt-1"
      onRefresh={() => void refetch()}
      refreshing={isRefetching}
      ListEmptyComponent={
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <Text className="text-center font-sans-semibold text-lg">Aún no guardas outfits</Text>
          <Text className="text-center text-muted-foreground">
            Toca el corazón en un outfit que te guste, o crea uno con tus prendas.
          </Text>
        </View>
      }
    />
  );
}
