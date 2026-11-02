import { Link } from 'expo-router';
import { CameraIcon, CheckIcon } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Spinner } from '@/components/app/spinner';
import { Button } from '@/components/app/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { type Garment, type GarmentCategory, useGarments } from '@/lib/garments';
import { cn } from '@/lib/utils';

type Step = { label: string; hint: string; done: (has: Set<GarmentCategory>) => boolean };

// A dress or jumpsuit counts for both the top and the bottom.
const STEPS: Step[] = [
  {
    label: 'Algo de arriba',
    hint: 'Una camiseta, camisa o blusa',
    done: (has) => has.has('top') || has.has('one_piece'),
  },
  {
    label: 'Algo de abajo',
    hint: 'Un jean, pantalón, falda o short',
    done: (has) => has.has('bottom') || has.has('one_piece'),
  },
  { label: 'Unos zapatos', hint: 'Los que más uses', done: (has) => has.has('shoes') },
];

function readyCategories(garments: Garment[]): Set<GarmentCategory> {
  return new Set(
    garments
      .filter((garment) => garment.status === 'ready' && garment.category)
      .map((garment) => garment.category as GarmentCategory)
  );
}

function StepRow({ step, done, index }: { step: Step; done: boolean; index: number }) {
  return (
    <Animated.View entering={FadeInDown.duration(350).delay(120 + index * 80)}>
      <View className="flex-row items-center gap-3 rounded-2xl bg-secondary px-4 py-3">
        <View
          className={cn(
            'h-8 w-8 items-center justify-center rounded-full border-2',
            done ? 'border-primary bg-primary' : 'border-muted-foreground/50'
          )}>
          {done && (
            <Animated.View entering={FadeIn.duration(200)}>
              <Icon as={CheckIcon} size={16} className="text-primary-foreground" />
            </Animated.View>
          )}
        </View>
        <View className="flex-1">
          <Text className={cn('font-sans-semibold', done && 'text-muted-foreground line-through')}>
            {step.label}
          </Text>
          {!done && <Text className="text-sm text-muted-foreground">{step.hint}</Text>}
        </View>
      </View>
    </Animated.View>
  );
}

// Shown on Hoy until the closet can make a first outfit; it fills in as photos are catalogued.
export function FirstOutfitChecklist() {
  const { data: garments = [] } = useGarments();
  const has = readyCategories(garments);
  const analysing = garments.filter((garment) => garment.status === 'processing').length;
  const doneCount = STEPS.filter((step) => step.done(has)).length;

  return (
    <View className="flex-1 justify-center gap-5">
      <Animated.View entering={FadeInDown.duration(400)} className="gap-2">
        <Text className="font-serif-medium text-3xl leading-tight">Armemos tu primer outfit</Text>
        <Text className="text-muted-foreground">
          Fotografía estas prendas y te decimos qué ponerte cada mañana. Puedes poner varias en una
          misma foto.
        </Text>
      </Animated.View>

      <View className="gap-2">
        {STEPS.map((step, index) => (
          <StepRow key={step.label} step={step} done={step.done(has)} index={index} />
        ))}
      </View>

      {analysing > 0 && (
        <View className="flex-row items-center justify-center gap-2">
          <Spinner size="small" />
          <Text className="text-sm text-muted-foreground">
            {analysing === 1 ? 'Analizando 1 foto…' : `Analizando ${analysing} fotos…`}
          </Text>
        </View>
      )}

      <Link href="/add" asChild>
        <Button size="lg">
          <Icon as={CameraIcon} size={18} className="text-primary-foreground" />
          <Text className="font-sans-semibold">
            {doneCount === 0 ? 'Fotografiar mi ropa' : 'Seguir fotografiando'}
          </Text>
        </Button>
      </Link>
      <Link href="/basics" asChild>
        <Button variant="ghost">
          <Text className="font-sans-semibold">O elige básicos de una lista, sin fotos</Text>
        </Button>
      </Link>
    </View>
  );
}
