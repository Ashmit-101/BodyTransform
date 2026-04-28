/**
 * PoseCard — Card for the pose category list
 * 
 * Shows pose name, icon, photo count, last capture date, and latest thumbnail.
 */

import React from 'react';
import { Image, StyleSheet, Text, View, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { colors, typography, spacing, radius, shadows } from '../theme/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function PoseCard({ pose, latestPhoto, onPress }) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const formatDate = (dateStr) => {
    if (!dateStr) return 'No photos yet';
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <AnimatedPressable
      onPress={() => onPress?.(pose)}
      onPressIn={() => { scale.value = withSpring(0.97); }}
      onPressOut={() => { scale.value = withSpring(1); }}
      style={[styles.container, animatedStyle]}
    >
      {/* Thumbnail */}
      <View style={styles.thumbnailContainer}>
        {latestPhoto ? (
          <Image source={{ uri: latestPhoto.file_path }} style={styles.thumbnail} />
        ) : (
          <View style={styles.emptyThumbnail}>
            <Text style={styles.emptyIcon}>{pose.icon || '💪'}</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.icon}>{pose.icon || '💪'}</Text>
          <Text style={styles.name} numberOfLines={1}>{pose.name}</Text>
        </View>
        <Text style={styles.stats}>
          {pose.photo_count} photo{pose.photo_count !== 1 ? 's' : ''}
        </Text>
        <Text style={styles.date}>{formatDate(pose.last_capture)}</Text>
      </View>

      {/* Chevron */}
      <Text style={styles.chevron}>›</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  thumbnailContainer: {
    width: 60,
    height: 80,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginRight: spacing.md,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  emptyThumbnail: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  emptyIcon: {
    fontSize: 28,
  },
  info: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 4,
  },
  icon: {
    fontSize: 18,
  },
  name: {
    ...typography.heading,
    fontSize: 17,
  },
  stats: {
    ...typography.bodySmall,
    marginBottom: 2,
  },
  date: {
    ...typography.caption,
    fontSize: 11,
  },
  chevron: {
    fontSize: 28,
    color: colors.textMuted,
    fontWeight: '300',
  },
});
