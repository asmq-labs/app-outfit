import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChoiceChips } from '@/components/app/choice-chips';
import { Segmented } from '@/components/app/segmented';
import { SheetHandle } from '@/components/app/sheet-handle';
import { Button } from '@/components/app/button';
import { Text } from '@/components/ui/text';
import {
  type ClosetColumns,
  colorFamily,
  matchesFilters,
  matchesSearch,
  resetClosetView,
  SORT_OPTIONS,
  useClosetColumns,
  useClosetFilters,
} from '@/lib/closet-filters';
import { FORMALITY_OPTIONS, useGarments, WARMTH_OPTIONS } from '@/lib/garments';

const COLUMN_OPTIONS = [
  { value: '3', label: '3 por fila' },
  { value: '4', label: '4 por fila' },
];

function Group({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return (
    <View className="gap-2">
      <Text className="font-sans-medium text-sm text-muted-foreground">{label}</Text>
      {children}
    </View>
  );
}

export default function ClosetFiltersSheet() {
  const insets = useSafeAreaInsets();
  const filters = useClosetFilters();
  const display = useClosetColumns();
  const { data: garments = [] } = useGarments();
  // Category and search live on the closet screen; they come along so the count matches it.
  const { category = 'all', search = '' } = useLocalSearchParams<{
    category?: string;
    search?: string;
  }>();
  const count = garments.filter(
    (g) =>
      (category === 'all' || g.category === category) &&
      matchesSearch(g, search.trim()) &&
      matchesFilters(g, filters)
  ).length;
  // Only colors that actually exist in this closet are offered.
  const colors = [...new Set(garments.map((g) => colorFamily(g.color)).filter(Boolean))]
    .sort()
    .map((color) => ({ value: color as string, label: color as string }));

  function set(patch: Partial<typeof filters>): void {
    useClosetFilters.setState(patch);
  }

  return (
    <View className="bg-popover" style={{ paddingBottom: insets.bottom + 12 }}>
      <ScrollView className="shrink" contentContainerClassName="gap-5 p-5 pb-3">
        <SheetHandle />
        <Text className="font-serif-medium text-2xl">Ordenar y filtrar</Text>

        <Group label="Ordenar por">
          <Segmented
            options={SORT_OPTIONS}
            selected={display.sort}
            onSelect={(sort) => useClosetColumns.setState({ sort })}
          />
        </Group>

        <Group label="Columnas">
          <Segmented
            options={COLUMN_OPTIONS}
            selected={String(display.columns)}
            onSelect={(value) =>
              useClosetColumns.setState({ columns: Number(value) as ClosetColumns })
            }
          />
        </Group>

        {/* Single required choices above use segmented buttons; optional filters below use
            Material 3 filter chips at natural width, and tapping the selected one clears it. */}
        <Group label="Nivel de abrigo">
          <ChoiceChips
            layout="wrap"
            options={WARMTH_OPTIONS}
            selected={filters.warmth}
            onSelect={(warmth) => set({ warmth: warmth === filters.warmth ? null : warmth })}
          />
        </Group>

        <Group label="Formalidad">
          <ChoiceChips
            layout="wrap"
            options={FORMALITY_OPTIONS}
            selected={filters.formality}
            onSelect={(formality) =>
              set({ formality: formality === filters.formality ? null : formality })
            }
          />
        </Group>

        {colors.length > 1 && (
          <Group label="Color">
            <ChoiceChips
              layout="wrap"
              options={colors}
              selected={filters.color}
              onSelect={(color) => set({ color: color === filters.color ? null : color })}
            />
          </Group>
        )}
      </ScrollView>

      {/* Outside the scroll so the actions stay visible however long the sheet gets. */}
      <View className="flex-row gap-3 px-5 pt-2">
        <Button variant="outline" size="lg" onPress={resetClosetView}>
          <Text className="font-sans-semibold">Restablecer</Text>
        </Button>
        <Button size="lg" className="flex-1" onPress={() => router.back()}>
          <Text className="font-sans-semibold">
            {count === 0 ? 'Ninguna prenda' : count === 1 ? 'Ver 1 prenda' : `Ver ${count} prendas`}
          </Text>
        </Button>
      </View>
    </View>
  );
}
