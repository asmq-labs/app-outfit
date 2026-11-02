import * as React from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

type OutfitTransitionProps = React.PropsWithChildren<{ dimmed: boolean }>;

// Dims the outfit while the next one is on its way; the collage itself reveals the new one.
export function OutfitTransition({ dimmed, children }: OutfitTransitionProps) {
  const dim = useSharedValue(1);

  React.useEffect(() => {
    dim.value = withTiming(dimmed ? 0.35 : 1, { duration: 180 });
  }, [dimmed, dim]);

  const animated = useAnimatedStyle(() => ({ opacity: dim.value }));

  return <Animated.View style={[{ flex: 1, gap: 16 }, animated]}>{children}</Animated.View>;
}
