import { router } from 'expo-router';
import { CameraIcon, ImagesIcon, ListChecksIcon, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetHandle } from '@/components/app/sheet-handle';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { pickFromGallery } from '@/lib/upload-queue';

type Option = { icon: LucideIcon; title: string; hint: string; run: () => void };

const OPTIONS: Option[] = [
  {
    icon: CameraIcon,
    title: 'Tomar fotos',
    hint: 'Extiende la prenda y tómale una foto',
    run: () => router.replace('/add'),
  },
  {
    icon: ImagesIcon,
    title: 'Elegir de la galería',
    hint: 'Fotos de tu ropa que ya tienes',
    run: () => {
      router.back();
      void pickFromGallery();
    },
  },
  {
    icon: ListChecksIcon,
    title: 'Elegir básicos',
    hint: 'Prendas comunes de una lista, sin fotos',
    run: () => router.replace('/basics'),
  },
];

// Bottom sheet instead of a dropdown: big targets within thumb reach, closes with a tap outside.
export default function AddOptionsSheet() {
  const insets = useSafeAreaInsets();
  return (
    <View className="gap-2 bg-popover p-5" style={{ paddingBottom: insets.bottom + 16 }}>
      <SheetHandle />
      <Text className="mb-2 font-serif-medium text-2xl">Añadir prendas</Text>
      {OPTIONS.map((option) => (
        <Pressable
          key={option.title}
          accessibilityRole="button"
          className="-mx-2 flex-row items-center gap-4 rounded-2xl px-2 py-3 active:bg-accent"
          onPress={option.run}>
          <View className="h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <Icon as={option.icon} size={22} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="font-sans-semibold">{option.title}</Text>
            <Text className="text-sm text-muted-foreground">{option.hint}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
