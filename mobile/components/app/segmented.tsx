import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { selectionFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';

type SegmentedProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
};

// Two or three views of the same screen, like "Prendas | Outfits".
export function Segmented<T extends string>({ options, selected, onSelect }: SegmentedProps<T>) {
  return (
    <View className="flex-row rounded-full bg-muted p-1">
      {options.map(({ value, label }) => {
        const active = value === selected;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) selectionFeedback();
              onSelect(value);
            }}
            className={cn(
              'h-10 flex-1 items-center justify-center rounded-full',
              active && 'bg-background'
            )}>
            <Text
              className={cn(
                'font-sans-medium',
                active ? 'text-foreground' : 'text-muted-foreground'
              )}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
