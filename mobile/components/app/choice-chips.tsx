import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { selectionFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';

type ChoiceChipsProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T) => void;
  // Fill the row with equal chips, or let them wrap at their natural width.
  layout?: 'fill' | 'wrap';
};

export function ChoiceChips<T extends string>({
  options,
  selected,
  onSelect,
  layout = 'fill',
}: ChoiceChipsProps<T>) {
  return (
    <View className={cn('flex-row gap-2', layout === 'wrap' && 'flex-wrap')}>
      {options.map(({ value, label }) => {
        const active = value === selected;
        return (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={() => {
              if (!active) selectionFeedback();
              onSelect(value);
            }}
            className={cn(
              'items-center rounded-full border py-2.5',
              layout === 'fill' ? 'flex-1' : 'px-4',
              active ? 'border-primary bg-primary' : 'border-border bg-transparent'
            )}>
            <Text
              className={cn(
                'font-sans-medium text-sm',
                active ? 'text-primary-foreground' : 'text-foreground'
              )}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
