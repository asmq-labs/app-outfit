import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ImagesIcon, XIcon } from 'lucide-react-native';
import * as React from 'react';
import { Linking, Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/app/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { tapFeedback } from '@/lib/haptics';
import { enqueuePhoto, pickFromGallery } from '@/lib/upload-queue';
import { cn } from '@/lib/utils';

export default function AddGarmentsScreen() {
  const insets = useSafeAreaInsets();
  const camera = React.useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [added, setAdded] = React.useState(0);
  const [lastPhoto, setLastPhoto] = React.useState<string | null>(null);
  const [shooting, setShooting] = React.useState(false);
  const flash = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  function addPhotos(uris: string[]): void {
    setAdded((count) => count + uris.length);
    setLastPhoto(uris[uris.length - 1]);
    // Each photo starts uploading right away while the user keeps shooting.
    uris.forEach((uri) => void enqueuePhoto(uri));
  }

  async function takePhoto(): Promise<void> {
    if (shooting) return;
    setShooting(true);
    tapFeedback();
    // A quick white blink confirms the shot without any sound.
    flash.value = withSequence(withTiming(0.7, { duration: 50 }), withTiming(0, { duration: 220 }));
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.8 });
      if (photo) addPhotos([photo.uri]);
    } finally {
      setShooting(false);
    }
  }

  async function pickPhotos(): Promise<void> {
    const uris = await pickFromGallery();
    // Going straight back shows the photos being analysed, so nobody picks them twice.
    if (uris.length > 0) router.back();
  }

  return (
    <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable accessibilityLabel="Cerrar" hitSlop={12} onPress={() => router.back()}>
          <Icon as={XIcon} size={26} className="text-white" />
        </Pressable>
        <Text className="font-sans-semibold text-white">
          {added === 0
            ? 'Fotografía tu ropa'
            : `${added} ${added === 1 ? 'foto añadida' : 'fotos añadidas'}`}
        </Text>
        <View className="h-10 w-10 overflow-hidden rounded-md">
          {lastPhoto && (
            <Image source={{ uri: lastPhoto }} contentFit="cover" style={{ flex: 1 }} />
          )}
        </View>
      </View>

      <View className="flex-1 overflow-hidden rounded-2xl">
        {permission?.granted ? (
          <>
            <CameraView ref={camera} facing="back" style={{ flex: 1 }} />
            <View pointerEvents="none" className="absolute inset-x-0 bottom-4 items-center px-6">
              <Text className="rounded-full bg-black/60 px-4 py-2 text-center text-sm text-white">
                Extiende cada prenda sobre la cama o el piso, sin que una tape a otra.
              </Text>
            </View>
            <Animated.View
              pointerEvents="none"
              style={[{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, flashStyle]}>
              <View className="flex-1 bg-white" />
            </Animated.View>
          </>
        ) : (
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Text className="text-center text-white">
              Necesitamos tu cámara para fotografiar tus prendas. También puedes elegir fotos de tu
              galería.
            </Text>
            {permission?.canAskAgain === false ? (
              <Button variant="secondary" onPress={() => void Linking.openSettings()}>
                <Text className="font-sans-semibold">Abrir ajustes</Text>
              </Button>
            ) : (
              <Button variant="secondary" onPress={() => void requestPermission()}>
                <Text className="font-sans-semibold">Permitir cámara</Text>
              </Button>
            )}
          </View>
        )}
      </View>

      <View
        className="flex-row items-center justify-between px-8 pt-5"
        style={{ paddingBottom: insets.bottom + 20 }}>
        <Pressable
          accessibilityLabel="Elegir de la galería"
          hitSlop={12}
          className="w-16 items-center"
          onPress={() => void pickPhotos()}>
          <Icon as={ImagesIcon} size={28} className="text-white" />
        </Pressable>

        <Pressable
          accessibilityLabel="Tomar foto"
          disabled={!permission?.granted || shooting}
          className="h-20 w-20 items-center justify-center rounded-full border-4 border-white active:opacity-70 disabled:opacity-40"
          onPress={() => void takePhoto()}>
          <View className="h-16 w-16 rounded-full bg-white" />
        </Pressable>

        <Pressable
          hitSlop={12}
          className={cn('w-16 items-center rounded-full py-2', added > 0 && 'bg-white')}
          onPress={() => router.back()}>
          <Text className={cn('font-sans-semibold', added > 0 ? 'text-black' : 'text-white')}>
            Listo
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
