import { Image } from 'expo-image';
import { router } from 'expo-router';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react-native';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ChoiceChips } from '@/components/app/choice-chips';
import { OutfitCollage } from '@/components/app/outfit-collage';
import { Pulse } from '@/components/app/pulse';
import { ScreenHeader } from '@/components/app/screen-header';
import { Spinner } from '@/components/app/spinner';
import { Button } from '@/components/app/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { askToConfirm } from '@/lib/confirm';
import { type Garment, useGarmentImage } from '@/lib/garments';
import { useCoords } from '@/lib/location';
import {
  defaultOccasion,
  garmentIds,
  localDay,
  OCCASIONS,
  type Outfit,
  useAnotherOutfit,
  useCalendar,
  useCreateOutfit,
  useDayOutfit,
  useDeleteOutfit,
} from '@/lib/outfits';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
// The forecast is reliable enough for about a week.
const SUGGEST_DAYS_AHEAD = 7;

function parseDay(day: string, hour = 0): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, hour);
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Weeks start on Monday; the grid always shows whole weeks.
function monthGrid(month: Date): Date[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const weeks: Date[][] = [];
  const cursor = new Date(start);
  do {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === month.getMonth());
  return weeks;
}

function mainGarment(outfit: Outfit): Garment | null {
  const { one_piece, top, bottom, shoes } = outfit.garments;
  return one_piece ?? top ?? bottom ?? shoes;
}

function CellThumb({ garment }: { garment: Garment }) {
  const image = useGarmentImage(garment, { size: 'thumb' });
  return (
    <View className="h-7 w-7 overflow-hidden rounded-md bg-white">
      <Image source={image} contentFit="contain" style={{ flex: 1 }} />
    </View>
  );
}

function DayCell({
  date,
  inMonth,
  selected,
  isToday,
  outfit,
  onPress,
}: {
  date: Date;
  inMonth: boolean;
  selected: boolean;
  isToday: boolean;
  outfit: Outfit | undefined;
  onPress: () => void;
}) {
  const garment = outfit ? mainGarment(outfit) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${date.toLocaleDateString('es', { day: 'numeric', month: 'long' })}${
        outfit?.worn ? ', con outfit registrado' : outfit?.planned ? ', con outfit planeado' : ''
      }`}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        'h-16 flex-1 items-center gap-1 rounded-xl pt-1.5',
        selected && 'bg-secondary',
        !inMonth && 'opacity-30'
      )}>
      {/* Material 3 date pickers mark today with an outlined circle. */}
      <View
        className={cn(
          'h-6 w-6 items-center justify-center rounded-full',
          isToday && 'border border-foreground'
        )}>
        <Text className={cn('text-sm', isToday && 'font-sans-bold')}>{date.getDate()}</Text>
      </View>
      {garment && outfit?.worn ? (
        <CellThumb garment={garment} />
      ) : outfit?.planned ? (
        <View className="h-2 w-2 rounded-full border border-foreground" />
      ) : null}
    </Pressable>
  );
}

function DayOutfit({ outfit }: { outfit: Outfit }) {
  const remove = useDeleteOutfit();
  const occasion = OCCASIONS.find((option) => option.value === outfit.occasion)?.label;

  function confirmDelete(): void {
    askToConfirm({
      title: outfit.worn ? '¿Quitar este registro?' : '¿Quitar este plan?',
      body: 'Tus prendas no se tocan.',
      action: 'Quitar',
      onConfirm: () => remove.mutate(outfit.id),
    });
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-medium">
          {outfit.worn ? 'Te lo pusiste' : 'Planeado'} · {occasion}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quitar"
          className="-mr-3 h-12 w-12 items-center justify-center"
          onPress={confirmDelete}>
          <Icon as={Trash2Icon} size={18} className="text-muted-foreground" />
        </Pressable>
      </View>
      <View className="h-64">
        <OutfitCollage garments={outfit.garments} />
      </View>
    </View>
  );
}

function DaySuggestion({ day }: { day: string }) {
  const coords = useCoords();
  const [asked, setAsked] = React.useState(false);
  // Morning of that day, so a Friday gets "Trabajo" and a Saturday "Casual".
  const [occasion, setOccasion] = React.useState(() => defaultOccasion(parseDay(day, 8)));
  const suggestion = useDayOutfit(day, occasion, coords, asked);
  const another = useAnotherOutfit(coords);
  const plan = useCreateOutfit();
  const outfit = suggestion.data;

  if (!asked) {
    return (
      <Button onPress={() => setAsked(true)}>
        <Icon as={SparklesIcon} size={16} className="text-primary-foreground" />
        <Text className="font-sans-semibold">Sugerirme un outfit</Text>
      </Button>
    );
  }

  return (
    <View className="gap-3">
      <ChoiceChips options={OCCASIONS} selected={occasion} onSelect={setOccasion} />
      {outfit ? (
        <>
          <View className="h-64" style={{ opacity: another.isPending ? 0.4 : 1 }}>
            <OutfitCollage garments={outfit.garments} />
          </View>
          <Text className="text-center font-serif-italic leading-6">{outfit.explanation}</Text>
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              disabled={another.isPending || plan.isPending}
              onPress={() => another.mutate(outfit)}>
              {another.isPending ? <Spinner size="small" /> : <Icon as={RefreshCwIcon} size={16} />}
              <Text className="font-sans-semibold">Otra</Text>
            </Button>
            <Button
              className="flex-1"
              disabled={another.isPending || plan.isPending}
              onPress={() =>
                plan.mutate({ day, occasion, worn: false, garments: garmentIds(outfit.garments) })
              }>
              <Text className="font-sans-semibold">
                {plan.isPending ? 'Guardando…' : 'Planearlo'}
              </Text>
            </Button>
          </View>
        </>
      ) : suggestion.isError ? (
        <Text className="text-center text-muted-foreground">
          No pudimos armar un outfit para ese día.
        </Text>
      ) : (
        <Pulse>
          <View className="h-64 rounded-3xl bg-muted" />
        </Pulse>
      )}
    </View>
  );
}

export default function CalendarScreen() {
  const today = localDay();
  const [month, setMonth] = React.useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = React.useState(today);

  const weeks = monthGrid(month);
  const start = localDay(weeks[0][0]);
  const end = localDay(weeks[weeks.length - 1][6]);
  const { data: outfits = [], isLoading } = useCalendar(start, end);

  const byDay = new Map<string, Outfit[]>();
  for (const outfit of outfits) byDay.set(outfit.day, [...(byDay.get(outfit.day) ?? []), outfit]);
  const dayOutfits = byDay.get(selectedDay) ?? [];

  const selectedLabel = capitalize(
    parseDay(selectedDay).toLocaleDateString('es', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  );

  function shiftMonth(delta: number): void {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function openBuilder(mode: 'wear' | 'plan'): void {
    router.push({ pathname: '/outfit/new', params: { day: selectedDay, mode } });
  }

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Calendario" eyebrow="Lo que te pusiste y lo que planeas" />
      <ScrollView contentContainerClassName="gap-4 px-4 pb-10">
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mes anterior"
            className="-ml-3 h-12 w-12 items-center justify-center"
            onPress={() => shiftMonth(-1)}>
            <Icon as={ChevronLeftIcon} size={22} />
          </Pressable>
          <Text className="font-sans-semibold text-lg">
            {capitalize(month.toLocaleDateString('es', { month: 'long', year: 'numeric' }))}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mes siguiente"
            className="-mr-3 h-12 w-12 items-center justify-center"
            onPress={() => shiftMonth(1)}>
            <Icon as={ChevronRightIcon} size={22} />
          </Pressable>
        </View>

        <View className="gap-1">
          <View className="flex-row">
            {WEEKDAYS.map((weekday, index) => (
              <Text key={index} className="flex-1 text-center text-xs text-muted-foreground">
                {weekday}
              </Text>
            ))}
          </View>
          {weeks.map((week) => (
            <View key={localDay(week[0])} className="flex-row">
              {week.map((cellDate) => {
                const key = localDay(cellDate);
                const cellOutfits = byDay.get(key);
                return (
                  <DayCell
                    key={key}
                    date={cellDate}
                    inMonth={cellDate.getMonth() === month.getMonth()}
                    selected={key === selectedDay}
                    isToday={key === today}
                    outfit={cellOutfits?.find((item) => item.worn) ?? cellOutfits?.[0]}
                    onPress={() => setSelectedDay(key)}
                  />
                );
              })}
            </View>
          ))}
        </View>

        <View className="gap-4 rounded-3xl border border-border p-4">
          <Text className="font-serif-medium text-2xl">{selectedLabel}</Text>
          {isLoading && (
            <Pulse>
              <View className="h-64 rounded-3xl bg-muted" />
            </Pulse>
          )}
          {!isLoading && dayOutfits.length === 0 && (
            <Text className="text-muted-foreground">
              {selectedDay > today ? 'Aún no hay nada planeado.' : 'No registraste nada este día.'}
            </Text>
          )}
          {dayOutfits.map((outfit) => (
            <DayOutfit key={outfit.id} outfit={outfit} />
          ))}
          {selectedDay > today &&
            daysBetween(today, selectedDay) <= SUGGEST_DAYS_AHEAD &&
            !dayOutfits.some((outfit) => outfit.planned) && (
              <DaySuggestion key={selectedDay} day={selectedDay} />
            )}
          <View className="gap-2">
            {selectedDay <= today && (
              <Button variant="outline" onPress={() => openBuilder('wear')}>
                <Text className="font-sans-semibold">Registrar lo que me puse</Text>
              </Button>
            )}
            {selectedDay >= today && (
              <Button variant="outline" onPress={() => openBuilder('plan')}>
                <Text className="font-sans-semibold">
                  {selectedDay > today ? 'Prefiero armarlo yo' : 'Planear un outfit'}
                </Text>
              </Button>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
