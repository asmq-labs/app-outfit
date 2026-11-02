import { router, useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/app/button';
import { ChoiceChips } from '@/components/app/choice-chips';
import { Input } from '@/components/app/input';
import { SheetHandle } from '@/components/app/sheet-handle';
import { Text } from '@/components/ui/text';
import { ApiError } from '@/lib/api';
import { successFeedback } from '@/lib/haptics';
import { useCoords } from '@/lib/location';
import { OCCASIONS, useOccasion, useRequestOutfit } from '@/lib/outfits';

// One place to ask for an outfit: from a chosen garment, or from Hoy for something different.
export default function OutfitRequestSheet() {
  const insets = useSafeAreaInsets();
  const { garmentId, garmentName } = useLocalSearchParams<{
    garmentId?: string;
    garmentName?: string;
  }>();
  const [occasion, setOccasion] = React.useState(useOccasion.getState().occasion);
  const [note, setNote] = React.useState('');
  const ask = useRequestOutfit(useCoords());
  const notEnough = ask.error instanceof ApiError && ask.error.code === 'not_enough_garments';

  function submit(): void {
    ask.mutate(
      { garmentId, occasion, note },
      {
        onSuccess: () => {
          successFeedback();
          router.dismissTo('/');
        },
      }
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding">
      <View className="gap-5 bg-popover p-5" style={{ paddingBottom: insets.bottom + 16 }}>
        <View className="gap-1">
          <SheetHandle />
          <Text className="font-serif-medium text-2xl">
            {garmentId ? 'Armar un outfit' : 'Pedir algo distinto'}
          </Text>
          {garmentName ? <Text className="text-muted-foreground">Con: {garmentName}</Text> : null}
        </View>

        <View className="gap-2">
          <Text className="font-sans-medium text-sm text-muted-foreground">¿Para qué ocasión?</Text>
          <ChoiceChips options={OCCASIONS} selected={occasion} onSelect={setOccasion} />
        </View>

        <View className="gap-2">
          <Text className="font-sans-medium text-sm text-muted-foreground">
            ¿Algo más? (opcional)
          </Text>
          <Input
            value={note}
            onChangeText={setNote}
            maxLength={200}
            multiline
            placeholder="Por ejemplo: para una cita, nada negro"
            style={{ textAlignVertical: 'top' }}
          />
        </View>

        {ask.isError && (
          <Text className="text-center text-sm text-destructive">
            {notEnough
              ? 'Aún no hay prendas suficientes para armarlo.'
              : 'No pudimos armarlo. Inténtalo de nuevo.'}
          </Text>
        )}
        <Button size="lg" disabled={ask.isPending} onPress={submit}>
          <Text className="font-sans-semibold">{ask.isPending ? 'Armando…' : 'Armar outfit'}</Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}
