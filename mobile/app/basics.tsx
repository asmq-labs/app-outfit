import { Image } from 'expo-image';
import { router } from 'expo-router';
import { CheckIcon } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/app/button';
import { Pulse } from '@/components/app/pulse';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { type Basic, type BasicColor, useAddBasics, useBasicImage, useBasics } from '@/lib/basics';
import { CATEGORY_OPTIONS } from '@/lib/garments';
import { selectionFeedback, successFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';

const pickKey = (shape: Basic, color: BasicColor) => `${shape.key}:${color.key}`;

// A check must stay visible on white or beige as much as on navy.
function isLight(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

function Swatch({
  color,
  selected,
  onPress,
}: {
  color: BasicColor;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={color.name}
      accessibilityState={{ checked: selected }}
      hitSlop={6}
      onPress={onPress}
      className={cn(
        'rounded-full border-2 p-0.5',
        selected ? 'border-foreground' : 'border-transparent'
      )}>
      {/* Garment colors are data, not theme colors, so they come inline. */}
      <View
        className="h-8 w-8 items-center justify-center rounded-full border border-border"
        style={{ backgroundColor: color.swatch }}>
        {selected && (
          <Icon
            as={CheckIcon}
            size={14}
            className={isLight(color.swatch) ? 'text-black' : 'text-white'}
          />
        )}
      </View>
    </Pressable>
  );
}

function ShapeRow({
  shape,
  selected,
  onToggle,
}: {
  shape: Basic;
  selected: Set<string>;
  onToggle: (shape: Basic, color: BasicColor) => void;
}) {
  // The picture follows the last color tapped, so the choice is seen, not imagined.
  const [preview, setPreview] = React.useState(shape.colors[0]);
  const image = useBasicImage(shape.key, preview.key);
  const owned = shape.colors.filter((color) => color.owned).map((color) => color.name);

  return (
    <View className="flex-row gap-4">
      <View className="h-24 w-24 overflow-hidden rounded-xl border border-border bg-white">
        <Image source={image} contentFit="contain" style={{ flex: 1 }} transition={120} />
      </View>
      <View className="flex-1 gap-2">
        <Text className="font-sans-semibold">{shape.name}</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {shape.colors.map((color) => (
            <Swatch
              key={color.key}
              color={color}
              selected={selected.has(pickKey(shape, color))}
              onPress={() => {
                setPreview(color);
                onToggle(shape, color);
              }}
            />
          ))}
        </View>
        {owned.length > 0 && (
          <Text className="text-xs text-muted-foreground">Ya tienes: {owned.join(', ')}</Text>
        )}
      </View>
    </View>
  );
}

function BasicsSkeleton() {
  return (
    <Pulse style={{ gap: 20 }}>
      {[0, 1, 2].map((row) => (
        <View key={row} className="flex-row gap-4">
          <View className="h-24 w-24 rounded-xl bg-muted" />
          <View className="flex-1 gap-3 pt-1">
            <View className="h-4 w-28 rounded-full bg-muted" />
            <View className="h-8 w-48 rounded-full bg-muted" />
          </View>
        </View>
      ))}
    </Pulse>
  );
}

// Common items picked from a list: a closet gets going without taking a single photo.
export default function BasicsScreen() {
  const insets = useSafeAreaInsets();
  const { data: basics = [], isLoading } = useBasics();
  const add = useAddBasics();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  function toggle(shape: Basic, color: BasicColor): void {
    selectionFeedback();
    const key = pickKey(shape, color);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save(): void {
    add.mutate([...selected], {
      onSuccess: () => {
        successFeedback();
        router.back();
      },
    });
  }

  const count = selected.size;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="gap-6 p-4"
        contentContainerStyle={{ paddingBottom: 120 }}>
        <Text className="text-muted-foreground">
          Toca los colores que tienes de cada prenda y los sumamos a tu armario, sin fotos.
        </Text>
        {isLoading ? (
          <BasicsSkeleton />
        ) : (
          CATEGORY_OPTIONS.map(({ value, label }) => {
            const shapes = basics.filter((shape) => shape.category === value);
            if (shapes.length === 0) return null;
            return (
              <View key={value} className="gap-4">
                <Text className="font-sans-medium text-sm text-muted-foreground">{label}</Text>
                {shapes.map((shape) => (
                  <ShapeRow key={shape.key} shape={shape} selected={selected} onToggle={toggle} />
                ))}
              </View>
            );
          })
        )}
      </ScrollView>

      {count > 0 && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          exiting={FadeOutDown.duration(150)}
          className="absolute inset-x-0 bottom-0 gap-2 border-t border-border bg-background px-4 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}>
          {add.isError && (
            <Text className="text-center text-sm text-destructive">
              No pudimos añadirlas. Inténtalo de nuevo.
            </Text>
          )}
          <Button size="lg" disabled={add.isPending} onPress={save}>
            <Text className="font-sans-semibold">
              {add.isPending
                ? 'Añadiendo…'
                : count === 1
                  ? 'Añadir 1 prenda'
                  : `Añadir ${count} prendas`}
            </Text>
          </Button>
        </Animated.View>
      )}
    </View>
  );
}
