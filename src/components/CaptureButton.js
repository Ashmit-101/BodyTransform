/**
 * CaptureButton — Animated shutter button with haptic feedback
 * 
 * Large circular button with a glowing ring that scales on press.
 */

import React from 'react';
import { StyleSheet, Pressable, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, shadows } from '../theme/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function CaptureButton({ onCapture, disabled = false }) {
  const scale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.4);

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const handlePress = async () => {
    if (disabled) return;

    // Haptic feedback
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Scale animation
    scale.value = withSequence(
      withSpring(0.85, { damping: 10, stiffness: 400 }),
      withSpring(1, { damping: 8, stiffness: 300 })
    );

    // Glow pulse
    glowOpacity.value = withSequence(
      withSpring(0.8, { damping: 10, stiffness: 400 }),
      withSpring(0.4, { damping: 8, stiffness: 200 })
    );

    onCapture?.();
  };

  return (
    <View style={styles.container}>
      {/* Glow ring */}
      <Animated.View style={[styles.glowRing, glowStyle]} />
      
      {/* Main button */}
      <AnimatedPressable
        onPress={handlePress}
        style={[styles.button, buttonStyle, disabled && styles.disabled]}
        disabled={disabled}
      >
        <View style={styles.innerRing} />
      </AnimatedPressable>
    </View>
  );
}

const BUTTON_SIZE = 76;
const GLOW_SIZE = BUTTON_SIZE + 20;

const styles = StyleSheet.create({
  container: {
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: colors.primary,
    ...shadows.glow(colors.primary),
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: colors.shutter,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.surfaceLight,
  },
  innerRing: {
    width: BUTTON_SIZE - 16,
    height: BUTTON_SIZE - 16,
    borderRadius: (BUTTON_SIZE - 16) / 2,
    backgroundColor: colors.shutter,
    borderWidth: 2,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  disabled: {
    opacity: 0.5,
  },
});
