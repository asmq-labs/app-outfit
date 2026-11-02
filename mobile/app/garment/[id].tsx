import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useHeaderHeight, usePreventRemove } from 'expo-router/react-navigation';
import * as React from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChoiceChips } from '@/components/app/choice-chips';
import { GarmentSkeleton } from '@/components/app/skeletons';
import { Button } from '@/components/app/button';
import { Input } from '@/components/app/input';
import { Text } from '@/components/ui/text';
import { askToConfirm } from '@/lib/confirm';
import {
  CATEGORY_OPTIONS,
  FORMALITY_OPTIONS,
  type Garment,
  type GarmentEdit,
  useGarmentImage,
  useGarments,
  useUpdateGarment,
  WARMTH_OPTIONS,
} from '@/lib/garments';
import { successFeedback } from '@/lib/haptics';
import { useConfirmDeleteGarment } from '@/lib/outfits';

function Field({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return (
    <View className="gap-2">
      <Text className="font-sans-medium text-sm text-muted-foreground">{label}</Text>
      {children}
    </View>
  );
}

function wearSummary(garment: Garment): string {
  if (!garment.last_worn_at) return 'Aún no te la has puesto';
  const times = garment.wear_count === 1 ? '1 vez' : `${garment.wear_count} veces`;
  const last = new Date(garment.last_worn_at).toLocaleDateString('es', {
    day: 'numeric',
    month: 'long',
  });
  return `Usada ${times} · la última, el ${last}`;
}

// Mounted only once the garment is loaded, so the form can start from its values.
function GarmentForm({ garment }: { garment: Garment }) {
  const [showOriginal, setShowOriginal] = React.useState(false);
  const image = useGarmentImage(garment, { variant: showOriginal ? 'original' : undefined });
  const update = useUpdateGarment();
  const confirmDelete = useConfirmDeleteGarment(garment);
  const [form, setForm] = React.useState<GarmentEdit>({
    name: garment.name ?? '',
    category: garment.category,
    warmth: garment.warmth,
    formality: garment.formality,
    brand: garment.brand ?? '',
    size: garment.size ?? '',
    notes: garment.notes ?? '',
  });
  const hasDetails = Boolean(garment.brand || garment.size || garment.notes);
  const [showDetails, setShowDetails] = React.useState(hasDetails);

  const changed =
    form.name !== (garment.name ?? '') ||
    form.category !== garment.category ||
    form.warmth !== garment.warmth ||
    form.formality !== garment.formality ||
    form.brand !== (garment.brand ?? '') ||
    form.size !== (garment.size ?? '') ||
    form.notes !== (garment.notes ?? '');
  const canSave = changed && form.name.trim().length > 0 && !update.isPending;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const [deleting, setDeleting] = React.useState(false);
  const [discarded, setDiscarded] = React.useState<{ leave: () => void } | null>(null);

  // Leaving with unsaved edits would lose them without a word.
  usePreventRemove(changed && !deleting && !discarded, ({ data }) => {
    askToConfirm({
      title: '¿Descartar los cambios?',
      body: 'Lo que cambiaste en esta prenda no se guardará.',
      action: 'Descartar',
      onConfirm: () => setDiscarded({ leave: () => navigation.dispatch(data.action) }),
    });
  });

  // Leaves only after the guard above has been switched off by this render.
  React.useEffect(() => discarded?.leave(), [discarded]);

  function save(): void {
    update.mutate(
      { id: garment.id, changes: { ...form, name: form.name.trim() } },
      { onSuccess: successFeedback }
    );
  }

  return (
    // Edge to edge, Android no longer shrinks the screen for the keyboard on its own.
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
      className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="gap-5 p-4"
        // Room for the save bar, which floats over the end of the form.
        contentContainerStyle={{ paddingBottom: changed ? 120 : 40 }}
        keyboardShouldPersistTaps="handled">
        <View className="aspect-square overflow-hidden rounded-2xl bg-white">
          <Image source={image} contentFit="contain" style={{ flex: 1 }} transition={150} />
        </View>
        {/* The main reason to open a garment, so it sits right under its picture. */}
        <Button
          size="lg"
          onPress={() =>
            router.push({
              pathname: '/outfit-request',
              params: { garmentId: garment.id, garmentName: garment.name ?? '' },
            })
          }>
          <Text className="font-sans-semibold">Armar un outfit con esta prenda</Text>
        </Button>
        <Text className="text-center text-sm text-muted-foreground">{wearSummary(garment)}</Text>
        {/* A basic was never photographed, so there is no original to show. */}
        {!garment.basic_key && (
          <Button variant="ghost" size="sm" onPress={() => setShowOriginal((value) => !value)}>
            <Text className="font-sans-semibold">
              {showOriginal ? 'Ver imagen del armario' : 'Ver mi foto original'}
            </Text>
          </Button>
        )}

        <Field label="Nombre">
          <Input
            value={form.name}
            onChangeText={(name) => setForm((current) => ({ ...current, name }))}
            maxLength={120}
            returnKeyType="done"
          />
        </Field>

        <Field label="Tipo">
          <ChoiceChips
            layout="wrap"
            options={CATEGORY_OPTIONS}
            selected={form.category}
            onSelect={(category) => setForm((current) => ({ ...current, category }))}
          />
        </Field>

        <Field label="Nivel de abrigo">
          <ChoiceChips
            options={WARMTH_OPTIONS}
            selected={form.warmth}
            onSelect={(warmth) => setForm((current) => ({ ...current, warmth }))}
          />
        </Field>

        <Field label="Formalidad">
          <ChoiceChips
            options={FORMALITY_OPTIONS}
            selected={form.formality}
            onSelect={(formality) => setForm((current) => ({ ...current, formality }))}
          />
        </Field>

        {showDetails ? (
          <Animated.View entering={FadeInDown.duration(250)} className="gap-5">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="Marca">
                  <Input
                    value={form.brand}
                    onChangeText={(brand) => setForm((current) => ({ ...current, brand }))}
                    maxLength={60}
                  />
                </Field>
              </View>
              <View className="w-28">
                <Field label="Talla">
                  <Input
                    value={form.size}
                    onChangeText={(size) => setForm((current) => ({ ...current, size }))}
                    maxLength={20}
                    autoCapitalize="characters"
                  />
                </Field>
              </View>
            </View>
            <Field label="Notas">
              <Input
                value={form.notes}
                onChangeText={(notes) => setForm((current) => ({ ...current, notes }))}
                maxLength={500}
                multiline
                placeholder="Por ejemplo: lavar a mano"
                style={{ textAlignVertical: 'top' }}
              />
            </Field>
          </Animated.View>
        ) : (
          <Button variant="ghost" size="sm" onPress={() => setShowDetails(true)}>
            <Text className="font-sans-semibold">Añadir marca, talla o notas</Text>
          </Button>
        )}

        <Button
          variant="ghost"
          onPress={() =>
            confirmDelete({
              onConfirm: () => setDeleting(true),
              onSuccess: () => router.back(),
              onError: () => setDeleting(false),
            })
          }>
          <Text className="text-destructive">Eliminar prenda</Text>
        </Button>
      </ScrollView>

      {/* Only shown once there is something to save, and always in sight while editing. */}
      {(changed || update.isPending) && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          exiting={FadeOutDown.duration(150)}
          className="absolute inset-x-0 bottom-0 gap-2 border-t border-border bg-background px-4 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}>
          {update.isError && (
            <Text className="text-center text-sm text-destructive">
              No pudimos guardar los cambios. Inténtalo de nuevo.
            </Text>
          )}
          <Button size="lg" disabled={!canSave} onPress={save}>
            <Text className="font-sans-semibold">
              {update.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Text>
          </Button>
        </Animated.View>
      )}
    </KeyboardAvoidingView>
  );
}

export default function GarmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: garments, isLoading } = useGarments();
  const garment = garments?.find((item) => item.id === id);

  if (garment) return <GarmentForm garment={garment} />;

  if (isLoading) {
    return (
      <View className="flex-1 bg-background">
        <GarmentSkeleton />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-background px-8">
      <Text className="text-center">Esta prenda ya no existe.</Text>
    </View>
  );
}
