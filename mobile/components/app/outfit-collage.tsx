import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import {
  type Garment,
  type GarmentCategory,
  type ImageSize,
  useGarmentImage,
} from '@/lib/garments';
import type { Outfit } from '@/lib/outfits';
import { cn } from '@/lib/utils';

// Pieces arrive one after another, like clothes laid on a bed.
const STAGGER_MS = 40;

type Slot = { garment: Garment; weight: number; order: number; size: ImageSize; reveal: boolean };
type PiecePress = (category: GarmentCategory) => void;

function Piece({
  garment,
  weight,
  order,
  size,
  reveal,
  onPiecePress,
}: Slot & { onPiecePress?: PiecePress }) {
  const image = useGarmentImage(garment, { size });
  return (
    <Animated.View
      entering={reveal ? FadeInDown.duration(240).delay(order * STAGGER_MS) : undefined}
      style={{ flex: weight }}>
      <Pressable
        accessibilityLabel={garment.name ?? undefined}
        style={{ flex: 1 }}
        onPress={() =>
          onPiecePress && garment.category
            ? onPiecePress(garment.category)
            : router.push({ pathname: '/garment/[id]', params: { id: garment.id } })
        }>
        <Image source={image} contentFit="contain" style={{ flex: 1 }} transition={150} />
      </Pressable>
    </Animated.View>
  );
}

function Column({ slots, onPiecePress }: { slots: Slot[]; onPiecePress?: PiecePress }) {
  return (
    <View className="flex-1 gap-1">
      {slots.map((slot) => (
        <Piece key={slot.garment.id} {...slot} onPiecePress={onPiecePress} />
      ))}
    </View>
  );
}

// Reading order of the collage: outer layer first, shoes and accessory last.
const ORDER = ['outerwear', 'top', 'one_piece', 'bottom', 'shoes', 'accessory'];

// Rough height/width of each kind of piece, used to balance the two columns.
const HEIGHT: Record<string, number> = {
  outerwear: 1.15,
  top: 1,
  one_piece: 1.8,
  bottom: 1.6,
  shoes: 0.75,
  accessory: 0.7,
};

function toSlot(garment: Garment, size: ImageSize, reveal: boolean): Slot {
  const category = garment.category ?? '';
  return { garment, size, reveal, weight: HEIGHT[category] ?? 1, order: ORDER.indexOf(category) };
}

const total = (column: Slot[]) => column.reduce((sum, slot) => sum + slot.weight, 0);

// Long piece anchors the right column, upper body the left; shoes and accessory fill the shorter one.
function layout(garments: Outfit['garments'], size: ImageSize, reveal: boolean): Slot[][] {
  const { top, bottom, one_piece, outerwear, shoes, accessory } = garments;
  const left: Slot[] = [outerwear, top].flatMap((g) => (g ? [toSlot(g, size, reveal)] : []));
  const right: Slot[] = [one_piece ?? bottom].flatMap((g) => (g ? [toSlot(g, size, reveal)] : []));
  for (const garment of [shoes, accessory]) {
    if (garment) (total(left) <= total(right) ? left : right).push(toSlot(garment, size, reveal));
  }
  return [left, right].map((column) => column.sort((a, b) => a.order - b.order));
}

// Two columns like a flat lay, each piece sized by how tall it naturally is.
// The canvas stays white in dark mode too: garment images come on a white background.
export function OutfitCollage({
  garments,
  size = 'full',
  reveal = false,
  onPiecePress,
}: {
  garments: Outfit['garments'];
  size?: ImageSize;
  // Only Hoy lays the pieces out: lists and detail screens just show them.
  reveal?: boolean;
  // Replaces opening the garment, where tapping a piece means choosing another one.
  onPiecePress?: PiecePress;
}) {
  return (
    <View
      // A thumbnail is one target: a tap belongs to its card, not to the piece under the finger.
      pointerEvents={size === 'thumb' ? 'none' : 'auto'}
      className={cn(
        'flex-1 flex-row gap-1 rounded-3xl border border-border bg-white',
        size === 'thumb' ? 'p-1.5' : 'p-3'
      )}>
      {layout(garments, size, reveal)
        .filter((column) => column.length > 0)
        .map((column) => (
          <Column key={column[0].garment.id} slots={column} onPiecePress={onPiecePress} />
        ))}
    </View>
  );
}
