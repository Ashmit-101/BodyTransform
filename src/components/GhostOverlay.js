/**
 * GhostOverlay — Semi-transparent previous photo overlay
 * 
 * Displayed on top of the camera view to help the user
 * align their body in the same position as last time.
 */

import React from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

const AnimatedImage = Animated.createAnimatedComponent(Image);

export default function GhostOverlay({ imageUri, opacity, enabled }) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!imageUri || !enabled) return null;

  return (
    <AnimatedImage
      source={{ uri: imageUri }}
      style={[styles.overlay, animatedStyle]}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
});
