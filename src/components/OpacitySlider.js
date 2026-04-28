/**
 * OpacitySlider — Controls the ghost overlay transparency
 * 
 * Horizontal slider with ghost/solid icons.
 */

import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedProps,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors, spacing, radius } from '../theme/theme';

const SLIDER_WIDTH = 200;
const TRACK_HEIGHT = 4;
const THUMB_SIZE = 24;

export default function OpacitySlider({ opacity, onValueChange }) {
  const thumbStyle = useAnimatedStyle(() => {
    const left = opacity.value * SLIDER_WIDTH - THUMB_SIZE / 2;
    return {
      transform: [{ translateX: Math.max(0, Math.min(left, SLIDER_WIDTH - THUMB_SIZE)) }],
    };
  });

  const fillStyle = useAnimatedStyle(() => ({
    width: `${opacity.value * 100}%`,
  }));

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      const newValue = Math.max(0, Math.min(e.x / SLIDER_WIDTH, 0.8));
      opacity.value = newValue;
      onValueChange?.(newValue);
    })
    .hitSlop({ top: 20, bottom: 20, left: 10, right: 10 });

  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      const newValue = Math.max(0, Math.min(e.x / SLIDER_WIDTH, 0.8));
      opacity.value = newValue;
      onValueChange?.(newValue);
    });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>👻</Text>
      <GestureDetector gesture={composedGesture}>
        <View style={styles.trackContainer}>
          <View style={styles.track}>
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>
      <Text style={styles.icon}>🧍</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  icon: {
    fontSize: 18,
  },
  trackContainer: {
    width: SLIDER_WIDTH,
    height: THUMB_SIZE,
    justifyContent: 'center',
  },
  track: {
    width: SLIDER_WIDTH,
    height: TRACK_HEIGHT,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: TRACK_HEIGHT / 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.shutter,
    borderWidth: 2,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 5,
  },
});
