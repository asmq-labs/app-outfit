import { router } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/app/button';
import { SheetHandle } from '@/components/app/sheet-handle';
import { Text } from '@/components/ui/text';
import { useConfirm } from '@/lib/confirm';

export default function ConfirmSheet() {
  const insets = useSafeAreaInsets();
  const request = useConfirm((state) => state.request);
  const confirmed = React.useRef(false);

  // Runs once the sheet is gone: the action may navigate, and it needs its screen back on top.
  React.useEffect(
    () => () => {
      if (confirmed.current) useConfirm.getState().request?.onConfirm();
    },
    []
  );

  if (!request) return null;

  return (
    <View className="gap-2 bg-popover p-5" style={{ paddingBottom: insets.bottom + 16 }}>
      <SheetHandle />
      <Text className="font-serif-medium text-2xl">{request.title}</Text>
      <Text className="text-muted-foreground">{request.body}</Text>
      <View className="mt-4 flex-row gap-3">
        <Button variant="outline" size="lg" className="flex-1" onPress={() => router.back()}>
          <Text className="font-sans-semibold">Cancelar</Text>
        </Button>
        <Button
          variant="destructive"
          size="lg"
          className="flex-1"
          onPress={() => {
            confirmed.current = true;
            router.back();
          }}>
          <Text className="font-sans-semibold">{request.action}</Text>
        </Button>
      </View>
    </View>
  );
}
