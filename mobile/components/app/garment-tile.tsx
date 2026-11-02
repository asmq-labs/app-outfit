import { Image } from 'expo-image';
import { router } from 'expo-router';
import { RotateCwIcon, Trash2Icon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Spinner } from '@/components/app/spinner';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { type Garment, useDeleteGarment, useGarmentImage, useRetryGarment } from '@/lib/garments';
import { useConfirmDeleteGarment } from '@/lib/outfits';

const FAILURE_TEXT: Record<string, string> = {
  not_a_garment: 'No vimos una prenda',
  processing_error: 'No se pudo procesar',
};

export function GarmentTile({ garment }: { garment: Garment }) {
  const image = useGarmentImage(garment, { size: 'thumb' });
  const retry = useRetryGarment();
  const remove = useDeleteGarment();
  const confirmDelete = useConfirmDeleteGarment(garment);

  function openDetail(): void {
    if (garment.status !== 'ready') return;
    router.push({ pathname: '/garment/[id]', params: { id: garment.id } });
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={garment.name ?? 'Prenda en proceso'}
      onPress={openDetail}
      onLongPress={() => confirmDelete()}
      className="flex-1 overflow-hidden rounded-xl border border-border bg-white">
      <Image
        source={image}
        contentFit="cover"
        style={{ flex: 1 }}
        transition={150}
        recyclingKey={garment.id}
      />

      {garment.status === 'processing' && (
        <View className="absolute inset-0 items-center justify-center gap-1 bg-background/70">
          <Spinner />
          <Text className="text-xs text-muted-foreground">Analizando</Text>
        </View>
      )}

      {garment.status === 'failed' && (
        <View className="absolute inset-0 items-center justify-center gap-2 bg-background/85 px-1">
          <Text className="text-center text-xs">
            {FAILURE_TEXT[garment.failure_reason ?? ''] ?? FAILURE_TEXT.processing_error}
          </Text>
          <View className="flex-row gap-4">
            <Pressable
              accessibilityLabel="Reintentar"
              hitSlop={8}
              onPress={() => retry.mutate(garment.id)}>
              <Icon as={RotateCwIcon} size={20} />
            </Pressable>
            <Pressable
              accessibilityLabel="Eliminar"
              hitSlop={8}
              onPress={() => remove.mutate(garment.id)}>
              <Icon as={Trash2Icon} size={20} className="text-destructive" />
            </Pressable>
          </View>
        </View>
      )}
    </Pressable>
  );
}
