/**
 * PhotoCard — Thumbnail card for the timeline grid
 * 
 * Displays a photo thumbnail with a date badge. Supports press and long-press.
 */

import React from 'react';
import { Image, StyleSheet, Text, View, Pressable, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '../theme/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_SIZE = (SCREEN_WIDTH - spacing.md * 4) / 3;

export default function PhotoCard({ photo, onPress, onLongPress, selected = false }) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const month = d.toLocaleString('default', { month: 'short' });
    const day = d.getDate();
    return `${month} ${day}`;
  };

  return (
    <AnimatedPressable
      onPress={() => onPress?.(photo)}
      onLongPress={() => onLongPress?.(photo)}
      onPressIn={() => { scale.value = withSpring(0.95); }}
      onPressOut={() => { scale.value = withSpring(1); }}
      style={[styles.container, animatedStyle, selected && styles.selected]}
    >
      <Image source={{ uri: photo.file_path }} style={styles.image} />
      
      {/* Date badge */}
      <View style={styles.dateBadge}>
        <Text style={styles.dateText}>{formatDate(photo.captured_at)}</Text>
      </View>

      {/* Selection indicator */}
      {selected && (
        <View style={styles.selectionBadge}>
          <Text style={styles.checkmark}>✓</Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: CARD_SIZE,
    height: CARD_SIZE * 1.4,
    borderRadius: radius.md,
    overflow: 'hidden',
    margin: spacing.xs,
    backgroundColor: colors.surface,
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  dateBadge: {
    position: 'absolute',
    bottom: spacing.xs,
    left: spacing.xs,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  dateText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '600',
  },
  selected: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  selectionBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
