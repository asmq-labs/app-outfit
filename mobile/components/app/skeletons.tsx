import { View } from 'react-native';

import { Pulse } from '@/components/app/pulse';

// Placeholders shaped like the screen that is about to appear, so nothing jumps when it loads.

export function GarmentSkeleton() {
  return (
    <Pulse style={{ flex: 1, gap: 20, padding: 16 }}>
      <View className="aspect-square rounded-2xl bg-muted" />
      <View className="h-4 w-1/2 self-center rounded-full bg-muted" />
      <View className="h-11 rounded-md bg-muted" />
      <View className="h-11 rounded-full bg-muted" />
      <View className="h-11 rounded-full bg-muted" />
    </Pulse>
  );
}

export function LookSkeleton() {
  return (
    <Pulse style={{ flex: 1, gap: 20, padding: 16 }}>
      <View className="flex-row gap-3">
        <View className="aspect-[3/4] flex-1 rounded-3xl bg-muted" />
        <View className="aspect-[3/4] flex-1 rounded-3xl bg-muted" />
      </View>
      <View className="h-5 rounded-full bg-muted" />
      <View className="h-28 rounded-2xl bg-muted" />
      <View className="h-12 rounded-full bg-muted" />
    </Pulse>
  );
}

export function OutfitSkeleton() {
  return (
    <Pulse style={{ flex: 1, gap: 16, padding: 16 }}>
      <View className="aspect-[3/4] rounded-3xl bg-muted" />
      <View className="h-12 rounded-full bg-muted" />
    </Pulse>
  );
}
