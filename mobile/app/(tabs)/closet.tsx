import { router } from 'expo-router';
import { PlusIcon, SearchIcon, SlidersHorizontalIcon } from 'lucide-react-native';
import * as React from 'react';
import { FlatList, ScrollView, View } from 'react-native';

import { ChoiceChips } from '@/components/app/choice-chips';
import { GarmentTile } from '@/components/app/garment-tile';
import { ScreenHeader } from '@/components/app/screen-header';
import { Pulse } from '@/components/app/pulse';
import { SavedOutfits } from '@/components/app/saved-outfits';
import { Segmented } from '@/components/app/segmented';
import { UploadBanner } from '@/components/app/upload-banner';
import { Button } from '@/components/app/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/app/input';
import { Text } from '@/components/ui/text';
import {
  activeFilterCount,
  type ClosetColumns,
  type ClosetSort,
  matchesFilters,
  matchesSearch,
  SORT_OPTIONS,
  useClosetColumns,
  useClosetFilters,
} from '@/lib/closet-filters';
import { type Garment, type GarmentCategory, useGarments } from '@/lib/garments';
import { useSavedOutfits } from '@/lib/outfits';

// Tile widths that leave room for the gaps between columns.
const TILE_WIDTH: Record<ClosetColumns, `${number}%`> = { 3: '32%', 4: '23.5%' };

type Filter = GarmentCategory | 'all';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'top', label: 'Arriba' },
  { value: 'bottom', label: 'Abajo' },
  { value: 'outerwear', label: 'Chaquetas' },
  { value: 'one_piece', label: 'Vestidos' },
  { value: 'shoes', label: 'Zapatos' },
  { value: 'accessory', label: 'Accesorios' },
];

type ClosetView = 'garments' | 'outfits';

const VIEWS: { value: ClosetView; label: string }[] = [
  { value: 'garments', label: 'Prendas' },
  { value: 'outfits', label: 'Outfits' },
];

function lastWorn(garment: Garment): number {
  return garment.last_worn_at ? Date.parse(garment.last_worn_at) : 0;
}

const COMPARE: Record<ClosetSort, (a: Garment, b: Garment) => number> = {
  recent: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  most_worn: (a, b) => b.wear_count - a.wear_count || lastWorn(b) - lastWorn(a),
  // Forgotten clothes first: never worn, then the longest since last worn.
  least_worn: (a, b) => a.wear_count - b.wear_count || lastWorn(a) - lastWorn(b),
};

function savedSummary(count: number): string {
  if (count === 0) return 'Tus combinaciones favoritas';
  return count === 1 ? '1 outfit' : `${count} outfits`;
}

function closetSummary(count: number): string {
  if (count === 0) return 'Sin prendas todavía';
  return count === 1 ? '1 prenda' : `${count} prendas`;
}

export default function ClosetScreen() {
  const { data: garments = [], isLoading, isError, refetch, isRefetching } = useGarments();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [search, setSearch] = React.useState('');
  const [view, setView] = React.useState<ClosetView>('garments');
  const { data: saved = [] } = useSavedOutfits();
  const filters = useClosetFilters();
  const { columns, sort } = useClosetColumns();
  const filterCount = activeFilterCount(filters);

  // Garments still being catalogued have no category yet, so they only show under "Todo".
  const visible = garments
    .filter((g) => filter === 'all' || g.category === filter)
    .filter((g) => matchesSearch(g, search.trim()))
    .filter((g) => matchesFilters(g, filters))
    .sort(COMPARE[sort]);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title="Armario"
        eyebrow={view === 'garments' ? closetSummary(garments.length) : savedSummary(saved.length)}
      />
      <UploadBanner />
      <View className="px-4 pb-3">
        <Segmented options={VIEWS} selected={view} onSelect={setView} />
      </View>

      {view === 'outfits' ? (
        <SavedOutfits />
      ) : (
        <>
          {garments.length > 0 && (
            <View className="flex-row items-center gap-2 px-4 pb-3">
              <View className="flex-1 justify-center">
                <Input
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar prenda"
                  returnKeyType="search"
                  className="h-11 rounded-full pl-10"
                />
                <View pointerEvents="none" className="absolute left-3.5">
                  <Icon as={SearchIcon} size={18} className="text-muted-foreground" />
                </View>
              </View>
              <View>
                {/* Named like the closet apps people know; sorting lives inside the same sheet. */}
                <Button
                  variant="outline"
                  accessibilityLabel="Ordenar y filtrar"
                  onPress={() =>
                    router.push({
                      pathname: '/closet-filters',
                      params: { category: filter, search },
                    })
                  }>
                  <Icon as={SlidersHorizontalIcon} size={18} />
                  <Text className="font-sans-medium">Filtros</Text>
                </Button>
                {filterCount > 0 && (
                  <View
                    pointerEvents="none"
                    className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <Text className="font-sans-bold text-xs text-primary-foreground">
                      {filterCount}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {garments.length > 0 && (
            // A horizontal ScrollView grows to fill the screen unless told not to.
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerClassName="px-4 pb-3">
              <ChoiceChips layout="wrap" options={FILTERS} selected={filter} onSelect={setFilter} />
            </ScrollView>
          )}

          {/* A different order is a choice that persists, so it is said out loud. */}
          {garments.length > 0 && sort !== 'recent' && (
            <Text className="px-4 pb-2 text-sm text-muted-foreground">
              Ordenadas por{' '}
              {SORT_OPTIONS.find((option) => option.value === sort)?.label.toLowerCase()}
            </Text>
          )}

          {isLoading ? (
            <Pulse style={{ gap: 8, paddingHorizontal: 16, paddingTop: 4 }}>
              {[0, 1, 2].map((row) => (
                <View key={row} className="flex-row gap-2">
                  {[0, 1, 2].map((tile) => (
                    <View key={tile} className="aspect-square flex-1 rounded-xl bg-muted" />
                  ))}
                </View>
              ))}
            </Pulse>
          ) : (
            <FlatList
              data={visible}
              keyExtractor={(garment) => garment.id}
              // A FlatList cannot change its column count in place, so it remounts.
              key={columns}
              numColumns={columns}
              renderItem={({ item }) => (
                <View style={{ flex: 1, maxWidth: TILE_WIDTH[columns], aspectRatio: 1 }}>
                  <GarmentTile garment={item} />
                </View>
              )}
              columnWrapperClassName="gap-2"
              contentContainerClassName="grow gap-2 px-4 pb-28 pt-1"
              onRefresh={() => void refetch()}
              refreshing={isRefetching}
              ListEmptyComponent={
                <View className="flex-1 items-center justify-center gap-2 px-8">
                  <Text className="text-center font-sans-semibold text-lg">
                    {isError
                      ? 'No pudimos cargar tu armario'
                      : garments.length > 0
                        ? 'No encontramos prendas así'
                        : 'Tu armario está vacío'}
                  </Text>
                  <Text className="text-center text-muted-foreground">
                    {isError
                      ? 'Desliza hacia abajo para intentarlo de nuevo.'
                      : garments.length > 0
                        ? 'Prueba con otra búsqueda, otro tipo o quita los filtros.'
                        : 'Fotografía tu ropa y la ordenamos por ti. Con una parte de arriba, una de abajo y unos zapatos ya tienes tu primer outfit.'}
                  </Text>
                  {!isError && garments.length === 0 && (
                    <Button
                      variant="outline"
                      className="mt-2"
                      onPress={() => router.push('/basics')}>
                      <Text className="font-sans-semibold">Elegir básicos de una lista</Text>
                    </Button>
                  )}
                </View>
              }
            />
          )}
        </>
      )}

      {view === 'outfits' ? (
        <Button
          size="lg"
          className="absolute bottom-6 right-4 rounded-full shadow-md"
          onPress={() => router.push({ pathname: '/outfit/new', params: { mode: 'save' } })}>
          <Icon as={PlusIcon} size={20} className="text-primary-foreground" />
          <Text className="font-sans-semibold">Crear outfit</Text>
        </Button>
      ) : (
        <Button
          size="lg"
          className="absolute bottom-6 right-4 shadow-md"
          onPress={() => router.push('/add-options')}>
          <Icon as={PlusIcon} size={20} className="text-primary-foreground" />
          <Text className="font-sans-semibold">Añadir prendas</Text>
        </Button>
      )}
    </View>
  );
}
