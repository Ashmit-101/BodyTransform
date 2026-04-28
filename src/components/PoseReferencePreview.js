import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import PoseSkeletonOverlay from './PoseSkeletonOverlay';
import { colors, typography, radius } from '../theme/theme';

export default function PoseReferencePreview({
  photo,
  referenceKeypoints,
  poseLabel,
  emptyLabel = 'No reference selected',
  statusLabel = null,
  style,
}) {
  if (!photo) {
    return (
      <View style={[styles.emptyPreview, style]}>
        <Ionicons name="image-outline" size={24} color={colors.textMuted} />
        <Text style={styles.emptyPreviewText}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.previewFrame, style]}>
      <Image
        source={{ uri: photo.ghost_file_path || photo.file_path }}
        style={styles.previewImage}
      />
      {referenceKeypoints && (
        <PoseSkeletonOverlay
          referenceKeypoints={referenceKeypoints}
          liveKeypoints={null}
          jointStateMap={{}}
          showReference
          referenceDimmed={false}
        />
      )}
      {poseLabel ? (
        <View style={styles.posePill}>
          <Text style={styles.posePillText}>{poseLabel}</Text>
        </View>
      ) : null}
      {statusLabel ? (
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>{statusLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  previewFrame: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceLight,
    minHeight: 176,
  },
  previewImage: {
    width: '100%',
    height: 176,
    opacity: 0.38,
  },
  posePill: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(10, 10, 15, 0.78)',
  },
  posePillText: {
    ...typography.caption,
    color: colors.secondary,
    textTransform: 'none',
    letterSpacing: 0.2,
  },
  statusPill: {
    position: 'absolute',
    right: 12,
    top: 12,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(10, 10, 15, 0.78)',
  },
  statusPillText: {
    ...typography.caption,
    color: colors.text,
    textTransform: 'none',
    letterSpacing: 0.2,
  },
  emptyPreview: {
    minHeight: 176,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyPreviewText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
});
