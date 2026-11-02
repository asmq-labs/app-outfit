import * as React from 'react';
import {
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

type TabButtonProps = Omit<PressableProps, 'style' | 'children' | 'onPress'> & {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
};

// Replaces Android's ripple on the tab bar: the icon dips slightly, without bouncing back.
export function TabButton({
  style,
  children,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: TabButtonProps) {
  const scale = useSharedValue(1);
  const press = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      {...rest}
      android_ripple={undefined}
      style={{ flex: 1 }}
      onPressIn={(event) => {
        scale.value = withTiming(0.86, { duration: 90 });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withTiming(1, { duration: 140 });
        onPressOut?.(event);
      }}
      onPress={onPress}>
      <Animated.View style={[style, press]}>{children}</Animated.View>
    </Pressable>
  );
}
