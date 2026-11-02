import { router, useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/app/button';
import { ChoiceChips } from '@/components/app/choice-chips';
import { SheetHandle } from '@/components/app/sheet-handle';
import { Text } from '@/components/ui/text';
import { successFeedback } from '@/lib/haptics';
import { useCoords } from '@/lib/location';
import { FEELING_REASONS, type Feeling, useSetFeeling } from '@/lib/outfits';

const TITLES: Record<Feeling, string> = {
  good: '¿Qué te gustó?',
  bad: '¿Qué no te convenció?',
};

// Reasons are optional: a single tap on "Guardar" already says how it felt.
export default function OutfitFeelingSheet() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id: string;
    feeling: Feeling;
    reasons?: string;
    rated?: string;
    replace?: string;
  }>();
  const { id, feeling } = params;
  const replace = params.replace === '1';
  const [reasons, setReasons] = React.useState<string[]>(
    params.reasons ? JSON.parse(params.reasons) : []
  );
  const set = useSetFeeling(useCoords());

  function toggle(reason: string): void {
    setReasons((current) =>
      current.includes(reason) ? current.filter((r) => r !== reason) : [...current, reason]
    );
  }

  function submit(next: Feeling | null): void {
    set.mutate(
      { id, feeling: next, reasons: next ? reasons : [], replace: replace && next === 'bad' },
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
        <Text className="text-muted-foreground">
          Elige lo que quieras. Nos ayuda a acertar la próxima vez.
        </Text>
      </View>

      <ChoiceChips
        layout="wrap"
        options={FEELING_REASONS[feeling]}
        selected={reasons}
        onSelect={toggle}
      />

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
