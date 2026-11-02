import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/app/button';
import { ChoiceChips } from '@/components/app/choice-chips';
import { SheetHandle } from '@/components/app/sheet-handle';
import { Text } from '@/components/ui/text';
import { type Garment, useGarmentImage, useGarments } from '@/lib/garments';
import { selectionFeedback, successFeedback } from '@/lib/haptics';
import { useCoords } from '@/lib/location';
import { FEELING_REASONS, type Feeling, useSetFeeling } from '@/lib/outfits';
import { cn } from '@/lib/utils';

const TITLES: Record<Feeling, string> = {
  good: '¿Qué te gustó?',
  bad: '¿Qué no te convenció?',
};

function Piece({
  garment,
  selected,
  onPress,
}: {
  garment: Garment;
  selected: boolean;
  onPress: () => void;
}) {
  const image = useGarmentImage(garment, { size: 'thumb' });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={garment.name ?? undefined}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        'h-16 flex-1 overflow-hidden rounded-xl border-2 bg-white',
        selected ? 'border-primary' : 'border-border'
      )}>
      <Image source={image} contentFit="contain" style={{ flex: 1 }} />
    </Pressable>
  );
}

// Reasons are optional: a single tap on "Guardar" already says how it felt.
export default function OutfitFeelingSheet() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id: string;
    feeling: Feeling;
    reasons?: string;
    chosen?: string;
    pieces?: string;
    rated?: string;
    replace?: string;
  }>();
  const { id, feeling } = params;
  const replace = params.replace === '1';
  const [reasons, setReasons] = React.useState<string[]>(
    params.reasons ? JSON.parse(params.reasons) : []
  );
  const [chosen, setChosen] = React.useState<string[]>(
    params.chosen ? JSON.parse(params.chosen) : []
  );
  const { data: closet = [] } = useGarments();
  const pieceIds: string[] = params.pieces ? JSON.parse(params.pieces) : [];
  const pieces = closet.filter((garment) => pieceIds.includes(garment.id));
  const set = useSetFeeling(useCoords());

  function toggle(reason: string): void {
    setReasons((current) =>
      current.includes(reason) ? current.filter((r) => r !== reason) : [...current, reason]
    );
  }

  function submit(next: Feeling | null): void {
    set.mutate(
      {
        id,
        feeling: next,
        reasons: next ? reasons : [],
        garmentIds: next ? chosen : [],
        replace: replace && next === 'bad',
      },
      {
        onSuccess: () => {
          successFeedback();
          router.back();
        },
      }
    );
  }

  return (
    <View className="gap-5 bg-popover p-5" style={{ paddingBottom: insets.bottom + 16 }}>
      <View className="gap-1">
        <SheetHandle />
        <Text className="font-serif-medium text-2xl">{TITLES[feeling]}</Text>
        <Text className="text-muted-foreground">Así aprendemos lo que funciona para ti.</Text>
      </View>

      <ChoiceChips
        layout="wrap"
        options={FEELING_REASONS[feeling]}
        selected={reasons}
        onSelect={toggle}
      />

      {pieces.length > 0 && (
        <View className="gap-2">
          <Text className="font-sans-medium text-sm text-muted-foreground">
            ¿Fue por alguna prenda? (opcional)
          </Text>
          <View className="flex-row gap-2">
            {pieces.map((garment) => (
              <Piece
                key={garment.id}
                garment={garment}
                selected={chosen.includes(garment.id)}
                onPress={() => {
                  selectionFeedback();
                  setChosen((current) =>
                    current.includes(garment.id)
                      ? current.filter((id) => id !== garment.id)
                      : [...current, garment.id]
                  );
                }}
              />
            ))}
          </View>
        </View>
      )}

      {set.isError && (
        <Text className="text-center text-sm text-destructive">
          No pudimos guardarlo. Inténtalo de nuevo.
        </Text>
      )}
      <View className="gap-2">
        <Button size="lg" disabled={set.isPending} onPress={() => submit(feeling)}>
          <Text className="font-sans-semibold">
            {set.isPending ? 'Guardando…' : replace ? 'Guardar y ver otro' : 'Guardar'}
          </Text>
        </Button>
        {params.rated === '1' && (
          <Button variant="ghost" disabled={set.isPending} onPress={() => submit(null)}>
            <Text className="font-sans-medium text-muted-foreground">Quitar mi opinión</Text>
          </Button>
        )}
      </View>
    </View>
  );
}
