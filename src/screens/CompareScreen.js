/**
 * CompareScreen — Side-by-side photo comparison
 * 
 * Displays two photos side by side with date labels.
 * Supports a swipe-reveal slider for before/after effect.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Image,
  Pressable,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const COMPARE_HEIGHT = SCREEN_HEIGHT * 0.65;

export default function CompareScreen({ route, navigation }) {
  const { photo1, photo2, poseName } = route.params;
  const [mode, setMode] = useState('side'); // 'side' or 'slider'

  // Slider position (0 to SCREEN_WIDTH)
  const sliderX = useSharedValue(SCREEN_WIDTH / 2);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      sliderX.value = Math.max(20, Math.min(e.absoluteX, SCREEN_WIDTH - 20));
    });

  const clipStyle = useAnimatedStyle(() => ({
    width: sliderX.value,
  }));

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sliderX.value }],
  }));

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('default', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Sort photos by date (earlier on left)
  const earlier = new Date(photo1.captured_at) <= new Date(photo2.captured_at) ? photo1 : photo2;
  const later = earlier === photo1 ? photo2 : photo1;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Compare</Text>
        <View style={styles.modeToggle}>
          <Pressable
            style={[styles.modeButton, mode === 'side' && styles.modeActive]}
            onPress={() => setMode('side')}
          >
            <Ionicons name="albums-outline" size={18} color={mode === 'side' ? '#fff' : colors.textMuted} />
          </Pressable>
          <Pressable
            style={[styles.modeButton, mode === 'slider' && styles.modeActive]}
            onPress={() => setMode('slider')}
          >
            <Ionicons name="swap-horizontal-outline" size={18} color={mode === 'slider' ? '#fff' : colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {/* Pose label */}
      <Text style={styles.poseLabel}>{poseName}</Text>

      {mode === 'side' ? (
        /* ─── Side-by-side mode ─── */
        <View style={styles.sideContainer}>
          <View style={styles.sideItem}>
            <Image source={{ uri: earlier.file_path }} style={styles.sideImage} />
            <View style={styles.dateTag}>
              <Text style={styles.dateTagText}>{formatDate(earlier.captured_at)}</Text>
            </View>
            <Text style={styles.beforeLabel}>BEFORE</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.sideItem}>
            <Image source={{ uri: later.file_path }} style={styles.sideImage} />
            <View style={styles.dateTag}>
              <Text style={styles.dateTagText}>{formatDate(later.captured_at)}</Text>
            </View>
            <Text style={styles.afterLabel}>AFTER</Text>
          </View>
        </View>
      ) : (
        /* ─── Slider mode ─── */
        <GestureDetector gesture={panGesture}>
          <View style={styles.sliderContainer}>
            {/* After (full background) */}
            <Image source={{ uri: later.file_path }} style={styles.sliderImage} />

            {/* Before (clipped) */}
            <Animated.View style={[styles.sliderClip, clipStyle]}>
              <Image source={{ uri: earlier.file_path }} style={styles.sliderImageClipped} />
            </Animated.View>

            {/* Slider line */}
            <Animated.View style={[styles.sliderLine, lineStyle]}>
              <View style={styles.sliderHandle}>
                <Ionicons name="swap-horizontal" size={18} color="#fff" />
              </View>
            </Animated.View>

            {/* Labels */}
            <View style={[styles.sliderLabel, { left: spacing.md }]}>
              <Text style={styles.sliderLabelText}>{formatDate(earlier.captured_at)}</Text>
            </View>
            <View style={[styles.sliderLabel, { right: spacing.md }]}>
              <Text style={styles.sliderLabelText}>{formatDate(later.captured_at)}</Text>
            </View>
          </View>
        </GestureDetector>
      )}

      {/* Time difference */}
      <View style={styles.timeDiff}>
        <Ionicons name="time-outline" size={16} color={colors.textMuted} />
        <Text style={styles.timeDiffText}>
          {getDaysDifference(earlier.captured_at, later.captured_at)}
        </Text>
      </View>
    </View>
  );
}

function getDaysDifference(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffMs = Math.abs(d2 - d1);
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Same day';
  if (diffDays === 1) return '1 day apart';
  if (diffDays < 7) return `${diffDays} days apart`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} apart`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) > 1 ? 's' : ''} apart`;
  return `${(diffDays / 365).toFixed(1)} years apart`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.heading,
    flex: 1,
    marginLeft: spacing.sm,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    padding: 2,
  },
  modeButton: {
    width: 36,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeActive: {
    backgroundColor: colors.primary,
  },
  poseLabel: {
    ...typography.caption,
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  // Side-by-side
  sideContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    height: COMPARE_HEIGHT,
  },
  sideItem: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  sideImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  divider: {
    width: 2,
    backgroundColor: colors.primary,
    marginHorizontal: 2,
  },
  dateTag: {
    position: 'absolute',
    bottom: spacing.sm,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  dateTagText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  beforeLabel: {
    ...typography.caption,
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    color: colors.secondary,
    fontSize: 10,
  },
  afterLabel: {
    ...typography.caption,
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    color: colors.success,
    fontSize: 10,
  },

  // Slider
  sliderContainer: {
    height: COMPARE_HEIGHT,
    marginHorizontal: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  sliderImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  sliderClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  sliderImageClipped: {
    width: SCREEN_WIDTH - spacing.sm * 2,
    height: '100%',
    resizeMode: 'cover',
  },
  sliderLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#fff',
    marginLeft: -1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderHandle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  sliderLabel: {
    position: 'absolute',
    bottom: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  sliderLabelText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },

  // Time difference
  timeDiff: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  timeDiffText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
});
