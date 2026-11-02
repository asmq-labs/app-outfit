import { CheckIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { selectionFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';

type ChoiceChipsProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  // A list lets several be on at once; the caller decides what a tap toggles.
  selected: T | readonly T[] | null;
  marked?: readonly T[];
  onSelect: (value: T) => void;
  // Fill the row with equal chips, or let them wrap at their natural width.
  layout?: 'fill' | 'wrap';
};

export function ChoiceChips<T extends string>({
  options,
  selected,
  marked,
  onSelect,
  layout = 'fill',
}: ChoiceChipsProps<T>) {
  return (
    <View className={cn('flex-row gap-2', layout === 'wrap' && 'flex-wrap')}>
      {options.map(({ value, label }) => {
        const active = Array.isArray(selected) ? selected.includes(value) : value === selected;
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
              'flex-row items-center justify-center gap-1 rounded-full border py-2.5',
              layout === 'fill' ? 'flex-1' : 'px-4',
              active ? 'border-primary bg-primary' : 'border-border bg-transparent'
            )}>
            {marked?.includes(value) && (
              <Icon
                as={CheckIcon}
                size={14}
                className={active ? 'text-primary-foreground' : 'text-foreground'}
              />
            )}
            <Text
              // Equal chips share a narrow row: shrink a little rather than wrap on small phones.
              numberOfLines={1}
              adjustsFontSizeToFit={layout === 'fill'}
              className={cn(
                'shrink font-sans-medium text-sm',
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
