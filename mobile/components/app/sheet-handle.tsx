import { Platform, View } from 'react-native';

// Material 3 drag handle; iOS draws its own grabber.
export function SheetHandle() {
  if (Platform.OS !== 'android') return null;
  return <View className="-mt-2 mb-2 h-1 w-8 self-center rounded-full bg-muted-foreground/40" />;
}
