import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { CheckIcon } from 'lucide-react-native';
import * as React from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/app/button';
import { ChoiceChips } from '@/components/app/choice-chips';
import { OutfitCollage } from '@/components/app/outfit-collage';
import { Pulse } from '@/components/app/pulse';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { askToConfirm } from '@/lib/confirm';
import { type Garment, type GarmentCategory, useGarmentImage, useGarments } from '@/lib/garments';
import { selectionFeedback, successFeedback } from '@/lib/haptics';
import { useCoords } from '@/lib/location';
import {
  type BuilderMode,
  garmentIds,
  localDay,
  OCCASIONS,
  type Outfit,
  useCreateOutfit,
  useOccasion,
  useSaveOutfit,
  useSwapOutfit,
  useUpdateSaved,
} from '@/lib/outfits';
import { cn } from '@/lib/utils';

const SLOTS: { value: GarmentCategory; label: string }[] = [
  { value: 'top', label: 'Arriba' },
  { value: 'bottom', label: 'Abajo' },
  { value: 'shoes', label: 'Zapatos' },
  { value: 'one_piece', label: 'Vestidos' },
  { value: 'outerwear', label: 'Chaquetas' },
  { value: 'accessory', label: 'Accesorios' },
];

// An outfit needs these, so they show even while the closet has none to offer.
const ALWAYS_SHOWN: GarmentCategory[] = ['top', 'bottom', 'shoes'];

const TITLES: Record<BuilderMode, string> = {
  wear: 'Lo que me puse',
  plan: 'Planear outfit',
  save: 'Nuevo outfit',
  swap: 'Cambiar prenda',
  'edit-saved': 'Cambiar prenda',
};

const ACTIONS: Record<BuilderMode, string> = {
  wear: 'Guardar en el calendario',
  plan: 'Planear',
  save: 'Guardar outfit',
  swap: 'Usar este outfit',
  'edit-saved': 'Guardar cambios',
};

type Selection = Outfit['garments'];

const EMPTY: Selection = {
  top: null,
  bottom: null,
  one_piece: null,
  outerwear: null,
  shoes: null,
  accessory: null,
};

function select(current: Selection, garment: Garment): Selection {
  const category = garment.category as GarmentCategory;
  const next = { ...current, [category]: current[category]?.id === garment.id ? null : garment };
  // A dress or jumpsuit replaces separates, and the other way round.
  if (category === 'one_piece' && next.one_piece) next.top = next.bottom = null;
  if ((category === 'top' || category === 'bottom') && next[category]) next.one_piece = null;
  return next;
}

function missingHint(selection: Selection): string | null {
  const hasBase = selection.one_piece || (selection.top && selection.bottom);
  if (!hasBase && !selection.shoes) return 'Elige algo de arriba, de abajo y unos zapatos.';
  if (!hasBase) return 'Falta algo de arriba y de abajo, o un vestido.';
  if (!selection.shoes) return 'Faltan los zapatos.';
  return null;
}

// Building piece by piece: after each choice, the next thing the outfit still needs.
function nextNeeded(selection: Selection, offered: Set<GarmentCategory>): GarmentCategory | null {
  const needed: GarmentCategory[] = selection.one_piece ? ['shoes'] : ['top', 'bottom', 'shoes'];
  return needed.find((slot) => !selection[slot] && offered.has(slot)) ?? null;
}

function Tile({
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
        'aspect-square max-w-[32%] flex-1 overflow-hidden rounded-xl border-2 bg-white',
        selected ? 'border-primary' : 'border-border'
      )}>
      <Image source={image} contentFit="contain" style={{ flex: 1 }} />
      {selected && (
        <View className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-primary">
          <Icon as={CheckIcon} size={14} className="text-primary-foreground" />
        </View>
      )}
    </Pressable>
  );
}

function initialSelection(garments: Garment[], pieces: string | undefined): Selection {
  if (!pieces) return EMPTY;
  const ids = Object.values(JSON.parse(pieces) as Record<string, string | null>);
  const chosen = garments.filter((garment) => ids.includes(garment.id));
  return { ...EMPTY, ...Object.fromEntries(chosen.map((g) => [g.category, g])) };
}

function sameSelection(a: Selection, b: Selection): boolean {
  return JSON.stringify(garmentIds(a)) === JSON.stringify(garmentIds(b));
}

function Builder({ ready }: { ready: Garment[] }) {
  const params = useLocalSearchParams<{
    mode: BuilderMode;
    day?: string;
    id?: string;
    slot?: GarmentCategory;
    pieces?: string;
    occasion?: Outfit['occasion'];
  }>();
  const { mode, day, id } = params;
  const editing = mode === 'swap' || mode === 'edit-saved';
  const offered = new Set(ready.map((garment) => garment.category as GarmentCategory));
  const [start] = React.useState(() => initialSelection(ready, params.pieces));
  const [selection, setSelection] = React.useState(start);
  const [occasion, setOccasion] = React.useState(
    params.occasion ?? useOccasion.getState().occasion
  );
  const [slot, setSlot] = React.useState<GarmentCategory>(
    params.slot ?? ALWAYS_SHOWN.find((category) => offered.has(category)) ?? 'top'
  );

  const coords = useCoords();
  const create = useCreateOutfit();
  const keep = useSaveOutfit();
  const swap = useSwapOutfit(coords);
  const update = useUpdateSaved();
  const pending = create.isPending || keep.isPending || swap.isPending || update.isPending;
  const failed = create.isError || keep.isError || swap.isError || update.isError;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const changed = !sameSelection(selection, start);
  const [leaving, setLeaving] = React.useState<{ leave: () => void } | null>(null);
  const forToday = mode === 'plan' && day === localDay();

  // Backing out of a half-built outfit would lose it without a word.
  usePreventRemove(changed && !leaving, ({ data }) => {
    askToConfirm({
      title: editing ? '¿Descartar el cambio?' : '¿Descartar este outfit?',
      body: 'Lo que elegiste aquí no se guardará.',
      action: 'Descartar',
      onConfirm: () => setLeaving({ leave: () => navigation.dispatch(data.action) }),
    });
  });

  // Leaves only after the guard above has been switched off by this render.
  React.useEffect(() => leaving?.leave(), [leaving]);

  function finish(leave: () => void = () => router.back()): void {
    successFeedback();
    setLeaving({ leave });
  }

  function save(): void {
    const done = { onSuccess: () => finish() };
    if (mode === 'swap' && id) swap.mutate({ id, garments: selection }, done);
    else if (mode === 'edit-saved' && id) {
      update.mutate(
        { id, garments: selection },
        {
          onSuccess: (saved) =>
            // Merged with an identical one: the outfit opened behind this screen is gone.
            finish(saved.id === id ? undefined : () => router.dismiss(2)),
        }
      );
    } else if (mode === 'save' || !day) keep.mutate(selection, done);
    else {
      create.mutate(
        { day, occasion, worn: mode === 'wear', garments: garmentIds(selection) },
        {
          onSuccess: () => {
            if (forToday) useOccasion.getState().setOccasion(occasion);
            finish();
          },
        }
      );
    }
  }

  function choose(garment: Garment): void {
    selectionFeedback();
    const next = select(selection, garment);
    setSelection(next);
    const choosing = next[garment.category as GarmentCategory]?.id === garment.id;
    if (!choosing || editing) return;
    const following = nextNeeded(next, offered);
    if (following) setSlot(following);
  }

  const hint = missingHint(selection);
  const slots = SLOTS.filter(({ value }) => ALWAYS_SHOWN.includes(value) || offered.has(value));
  const options = ready.filter((garment) => garment.category === slot);
  const filled = slots.map(({ value }) => value).filter((value) => selection[value]);
  // A saved or edited outfit keeps its occasion, so only new days ask for one.
  const asksOccasion = mode === 'wear' || mode === 'plan';

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: forToday ? 'Armar mi outfit' : TITLES[mode],
        }}
      />
      <View className="gap-3 px-4 pt-3">
        {asksOccasion && (
          <ChoiceChips options={OCCASIONS} selected={occasion} onSelect={setOccasion} />
        )}
        <View className="h-52">
          {Object.values(selection).some(Boolean) ? (
            <OutfitCollage garments={selection} onPiecePress={setSlot} />
          ) : (
            <View className="flex-1 items-center justify-center rounded-3xl bg-muted px-8">
              <Text className="text-center text-muted-foreground">
                Elige tus prendas abajo, una por una.
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Left alone it grows to fill the screen, or the grid below squeezes it flat. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerClassName="px-4 py-3">
        <ChoiceChips
          layout="wrap"
          options={slots}
          selected={slot}
          marked={filled}
          onSelect={setSlot}
        />
      </ScrollView>

      <FlatList
        // A new category starts from its top instead of keeping the last one's scroll.
        key={slot}
        className="flex-1"
        data={options}
        keyExtractor={(garment) => garment.id}
        numColumns={3}
        renderItem={({ item }) => (
          <Tile
            garment={item}
            selected={selection[slot]?.id === item.id}
            onPress={() => choose(item)}
          />
        )}
        columnWrapperClassName="gap-2"
        contentContainerClassName="grow gap-2 px-4 pb-4"
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center gap-3 px-6 py-6">
            <Text className="text-center text-muted-foreground">
              Aún no tienes prendas de este tipo.
            </Text>
            <Button variant="outline" onPress={() => router.push('/add-options')}>
              <Text className="font-sans-semibold">Añadir prendas</Text>
            </Button>
          </View>
        }
      />

      <View
        className="gap-2 border-t border-border bg-background px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}>
        {failed ? (
          <Text className="text-center text-sm text-destructive">
            No pudimos guardarlo. Inténtalo de nuevo.
          </Text>
        ) : hint ? (
          <Text className="text-center text-sm text-muted-foreground">{hint}</Text>
        ) : null}
        <Button
          size="lg"
          disabled={hint !== null || pending || (editing && !changed)}
          onPress={save}>
          <Text className="font-sans-semibold">
            {pending ? 'Guardando…' : forToday ? 'Usarlo hoy' : ACTIONS[mode]}
          </Text>
        </Button>
      </View>
    </View>
  );
}

export default function NewOutfitScreen() {
  const { data: garments, isLoading } = useGarments();

  // What is already chosen is read once from the closet, so the closet comes first.
  if (isLoading || !garments) {
    return (
      <Pulse style={{ flex: 1, gap: 16, padding: 16 }}>
        <View className="h-52 rounded-3xl bg-muted" />
        <View className="h-10 rounded-full bg-muted" />
      </Pulse>
    );
  }
  return <Builder ready={garments.filter((garment) => garment.status === 'ready')} />;
}
