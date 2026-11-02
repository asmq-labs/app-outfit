import { router } from 'expo-router';
import * as React from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/app/button';
import { Input } from '@/components/app/input';
import { SheetHandle } from '@/components/app/sheet-handle';
import { Text } from '@/components/ui/text';
import { successFeedback } from '@/lib/haptics';
import { useSaveStyleProfile, useStyleProfile } from '@/lib/profile';

// Mounted once the saved text is known, so the field can start from it.
function ProfileForm({ saved }: { saved: string }) {
  const [text, setText] = React.useState(saved);
  const save = useSaveStyleProfile();
  const changed = text.trim() !== saved;

  function submit(): void {
    save.mutate(text, {
      onSuccess: () => {
        successFeedback();
        router.back();
      },
    });
  }

  return (
    <>
      <Input
        value={text}
        onChangeText={setText}
        maxLength={300}
        multiline
        placeholder="Por ejemplo: trabajo en oficina, ropa de hombre, me gusta lo sencillo, no uso rojo"
        className="h-32"
        style={{ textAlignVertical: 'top' }}
      />
      {save.isError && (
        <Text className="text-center text-sm text-destructive">
          No pudimos guardarlo. Inténtalo de nuevo.
        </Text>
      )}
      <Button size="lg" disabled={!changed || save.isPending} onPress={submit}>
        <Text className="font-sans-semibold">{save.isPending ? 'Guardando…' : 'Guardar'}</Text>
      </Button>
    </>
  );
}

export default function StyleProfileSheet() {
  const insets = useSafeAreaInsets();
  const profile = useStyleProfile();

  return (
    <KeyboardAvoidingView behavior="padding">
      <View className="gap-4 bg-popover p-5" style={{ paddingBottom: insets.bottom + 16 }}>
        <View className="gap-1">
          <SheetHandle />
          <Text className="font-serif-medium text-2xl">Tu estilo</Text>
          <Text className="text-muted-foreground">
            Cuéntanos a qué te dedicas y qué te gusta. La IA que elige tus outfits lo tendrá en
            cuenta.
          </Text>
        </View>
        {profile.isError ? (
          <Text className="text-center text-sm text-destructive">
            No pudimos cargarlo. Cierra esta hoja e inténtalo de nuevo.
          </Text>
        ) : profile.data ? (
          <ProfileForm saved={profile.data.style_profile ?? ''} />
        ) : (
          <View className="h-32 rounded-xl bg-muted" />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
