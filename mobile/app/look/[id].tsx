import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { OutfitCollage } from '@/components/app/outfit-collage';
import { LookSkeleton } from '@/components/app/skeletons';
import { Button } from '@/components/app/button';
import { Text } from '@/components/ui/text';
import { ApiError } from '@/lib/api';
import { askToConfirm } from '@/lib/confirm';
import {
  type Inspiration,
  useDeleteInspiration,
  useInspirationImage,
  useInspirations,
  useWearLookToday,
} from '@/lib/inspirations';
import { useCoords } from '@/lib/location';

function Look({ inspiration }: { inspiration: Inspiration }) {
  const photo = useInspirationImage(inspiration);
  const wearToday = useWearLookToday(useCoords());
  const remove = useDeleteInspiration();
  const matched = Object.values(inspiration.garments).some((garment) => garment !== null);
  const notEnough =
    wearToday.error instanceof ApiError && wearToday.error.code === 'not_enough_garments';

  function confirmDelete(): void {
    askToConfirm({
      title: '¿Eliminar este look?',
      body: 'Tu ropa no se toca.',
      action: 'Eliminar',
      onConfirm: () => remove.mutate(inspiration.id, { onSuccess: () => router.back() }),
    });
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 p-4 pb-10">
      <View className="flex-row gap-3">
        <View className="flex-1 gap-2">
          <Text className="font-sans-medium text-sm text-muted-foreground">El look</Text>
          <View className="aspect-[3/4] overflow-hidden rounded-3xl bg-muted">
            <Image source={photo} contentFit="cover" style={{ flex: 1 }} transition={150} />
          </View>
        </View>
        <View className="flex-1 gap-2">
          <Text className="font-sans-medium text-sm text-muted-foreground">Con tu ropa</Text>
          <View className="aspect-[3/4]">
            {matched ? (
              <OutfitCollage garments={inspiration.garments} />
            ) : (
              <View className="flex-1 items-center justify-center rounded-3xl bg-muted p-4">
                <Text className="text-center text-sm text-muted-foreground">
                  Nada parecido en tu armario todavía
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {inspiration.explanation ? (
        <Text className="text-center font-serif-italic text-lg leading-6">
          {inspiration.explanation}
        </Text>
      ) : null}

      {inspiration.missing.length > 0 && (
        <View className="gap-2 rounded-2xl bg-secondary p-4">
          <Text className="font-sans-semibold">Para acercarte más te falta</Text>
          {inspiration.missing.map((piece) => (
            <Text key={`${piece.category}-${piece.name}`} className="text-muted-foreground">
              · {piece.name}
            </Text>
          ))}
        </View>
      )}

      {notEnough && (
        <Text className="text-center text-sm text-muted-foreground">
          Aún faltan prendas en tu armario para completar el outfit.
        </Text>
      )}
      {/* With nothing from the closet in it, the look would just be a random outfit. */}
      {matched && (
        <Button
          size="lg"
          disabled={wearToday.isPending}
          onPress={() =>
            wearToday.mutate(inspiration.id, { onSuccess: () => router.dismissTo('/') })
          }>
          <Text className="font-sans-semibold">
            {wearToday.isPending ? 'Armando…' : 'Usarlo hoy'}
          </Text>
        </Button>
      )}
      <Button variant="ghost" onPress={confirmDelete}>
        <Text className="text-destructive">Eliminar look</Text>
      </Button>
    </ScrollView>
  );
}

export default function LookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: looks, isLoading } = useInspirations();
  const inspiration = looks?.find((item) => item.id === id);

  if (inspiration) return <Look inspiration={inspiration} />;

  if (isLoading) {
    return (
      <View className="flex-1 bg-background">
        <LookSkeleton />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-background px-8">
      <Text className="text-center">Este look ya no existe.</Text>
    </View>
  );
}
