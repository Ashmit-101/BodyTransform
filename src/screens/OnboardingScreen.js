import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  ScrollView,
  Pressable,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, typography, spacing, radius, shadows } from '../theme/theme';
import {
  getAllPoses,
  getGhostPhotoForPose,
  getPoseReferenceData,
  getPoseReferencePhotoId,
} from '../database/db';
import { importReferencePhotoForPose } from '../utils/referencePhotos';
import PoseReferencePreview from '../components/PoseReferencePreview';
import { getPoseConfig } from '../constants/poseAlignment';
import { getPoseTypeForPose } from '../utils/poseAlignment';

export default function OnboardingScreen({ onFinish }) {
  const [poses, setPoses] = useState([]);
  const [ghostPhotos, setGhostPhotos] = useState({});
  const [referenceIds, setReferenceIds] = useState({});
  const [referenceKeypoints, setReferenceKeypoints] = useState({});
  const [poseTypes, setPoseTypes] = useState({});
  const [loadingPoseId, setLoadingPoseId] = useState(null);

  useEffect(() => {
    loadPoses();
  }, []);

  const loadPoses = async () => {
    try {
      const allPoses = await getAllPoses();
      setPoses(allPoses);

      const nextGhostPhotos = {};
      const nextReferenceIds = {};
      const nextReferenceKeypoints = {};
      const nextPoseTypes = {};

      for (const pose of allPoses) {
        const ghostPhoto = await getGhostPhotoForPose(pose.id);
        const referencePhotoId = await getPoseReferencePhotoId(pose.id);
        const referenceData = await getPoseReferenceData(pose.id);
        const resolvedPoseType = referenceData?.poseType || getPoseTypeForPose(pose);
        if (ghostPhoto) nextGhostPhotos[pose.id] = ghostPhoto;
        if (referencePhotoId) nextReferenceIds[pose.id] = referencePhotoId;
        nextPoseTypes[pose.id] = resolvedPoseType;
        if (referenceData?.source === 'detected' && referenceData?.keypoints) {
          nextReferenceKeypoints[pose.id] = referenceData.keypoints;
        }
      }

      setGhostPhotos(nextGhostPhotos);
      setReferenceIds(nextReferenceIds);
      setReferenceKeypoints(nextReferenceKeypoints);
      setPoseTypes(nextPoseTypes);
    } catch (err) {
      console.error('Failed to load onboarding poses:', err);
    }
  };

  const handleImportReference = async (pose) => {
    setLoadingPoseId(pose.id);
    try {
      const result = await importReferencePhotoForPose(pose);

      if (result.status === 'permission_denied') {
        Alert.alert(
          'Permission Required',
          'Please allow photo library access to import a reference photo for this pose.',
        );
        return;
      }

      if (result.status !== 'success') return;

      if (result.warning) {
        Alert.alert('Reference Saved', result.warning);
      }

      setGhostPhotos((prev) => ({
        ...prev,
        [pose.id]: result.photo,
      }));
      setReferenceIds((prev) => ({
        ...prev,
        [pose.id]: result.photo.id,
      }));
      setReferenceKeypoints((prev) => ({
        ...prev,
        [pose.id]: result.referenceKeypoints,
      }));
      setPoseTypes((prev) => ({
        ...prev,
        [pose.id]: result.poseType,
      }));
    } catch (err) {
      console.error('Failed to import onboarding reference photo:', err);
      Alert.alert('Error', 'Failed to import that photo. Please try again.');
    } finally {
      setLoadingPoseId(null);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.badge}>
            <Ionicons name="sparkles-outline" size={14} color={colors.secondary} />
            <Text style={styles.badgeText}>First-time setup</Text>
          </View>
          <Text style={styles.title}>Pick the photos you actually want to align against.</Text>
          <Text style={styles.subtitle}>
            For each pose, import your best existing shot once. That image becomes the default reference for live pose alignment instead of falling back to your latest check-in.
          </Text>
        </View>

        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>Recommended setup</Text>
          <Text style={styles.calloutBody}>
            Start with the poses you care about most. You can skip any pose now and set or replace its alignment reference later in Settings.
          </Text>
        </View>

        <View style={styles.steps}>
          {poses.map((pose) => {
            const ghostPhoto = ghostPhotos[pose.id];
            const hasReference = Boolean(referenceIds[pose.id]);
            const isLoading = loadingPoseId === pose.id;
            const poseLabel = getPoseConfig(poseTypes[pose.id] || getPoseTypeForPose(pose)).label;

            return (
              <View key={pose.id} style={styles.stepCard}>
                <View style={styles.stepHeader}>
                  <View style={styles.poseMeta}>
                    <Text style={styles.poseIcon}>{pose.icon}</Text>
                    <View style={styles.poseText}>
                      <Text style={styles.stepTitle}>{pose.name}</Text>
                      <Text style={styles.stepBody}>
                        {hasReference
                          ? 'Saved as this pose’s live alignment reference.'
                          : 'No reference yet. Import a clear pose photo to build the overlay guide.'}
                      </Text>
                    </View>
                  </View>
                  {hasReference && (
                    <View style={styles.statusPill}>
                      <Text style={styles.statusPillText}>Reference ready</Text>
                    </View>
                  )}
                </View>

                <PoseReferencePreview
                  photo={ghostPhoto}
                  referenceKeypoints={referenceKeypoints[pose.id]}
                  poseLabel={poseLabel}
                  statusLabel={referenceKeypoints[pose.id] ? 'Pose detected' : 'Photo only'}
                />

                <Pressable
                  style={[styles.importButton, isLoading && styles.importButtonDisabled]}
                  onPress={() => handleImportReference(pose)}
                  disabled={isLoading}
                >
                  <Ionicons
                    name={hasReference ? 'refresh-outline' : 'cloud-upload-outline'}
                    size={18}
                    color="#fff"
                  />
                  <Text style={styles.importButtonText}>
                    {isLoading
                      ? 'Importing…'
                      : hasReference
                        ? 'Replace reference photo'
                        : 'Import best photo'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.footerCard}>
          <Text style={styles.footerTitle}>How this affects pose alignment</Text>
          <Text style={styles.footerBody}>
            The camera will only draw a skeleton after real keypoints are extracted from the reference image. Until then, the saved photo is kept as the visual reference only.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable style={styles.primaryButton} onPress={onFinish}>
          <Text style={styles.primaryButtonText}>Continue to app</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={onFinish}>
          <Text style={styles.secondaryButtonText}>Skip remaining poses</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingTop: Platform.OS === 'ios' ? 72 : 48,
    paddingHorizontal: spacing.lg,
    paddingBottom: 180,
  },
  hero: {
    marginBottom: spacing.xl,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0, 217, 255, 0.12)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginBottom: spacing.md,
  },
  badgeText: {
    ...typography.caption,
    color: colors.secondary,
    textTransform: 'none',
    letterSpacing: 0.2,
  },
  title: {
    ...typography.title,
    fontSize: 34,
    lineHeight: 40,
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 24,
  },
  callout: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  calloutTitle: {
    ...typography.heading,
    fontSize: 18,
    marginBottom: spacing.sm,
  },
  calloutBody: {
    ...typography.bodySmall,
    lineHeight: 22,
  },
  steps: {
    gap: spacing.md,
  },
  stepCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: spacing.md,
  },
  stepHeader: {
    gap: spacing.sm,
  },
  poseMeta: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  poseIcon: {
    fontSize: 24,
    marginTop: 2,
  },
  poseText: {
    flex: 1,
  },
  stepTitle: {
    ...typography.body,
    fontWeight: '600',
    marginBottom: 6,
  },
  stepBody: {
    ...typography.bodySmall,
    lineHeight: 21,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    backgroundColor: 'rgba(0, 217, 255, 0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  statusPillText: {
    ...typography.caption,
    color: colors.secondary,
    textTransform: 'none',
    letterSpacing: 0.1,
  },
  previewImage: {
    width: '100%',
    aspectRatio: 0.8,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceLight,
  },
  emptyPreview: {
    width: '100%',
    aspectRatio: 0.8,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  emptyPreviewText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  importButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  importButtonDisabled: {
    opacity: 0.7,
  },
  importButtonText: {
    ...typography.body,
    color: '#fff',
    fontWeight: '700',
  },
  footerCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.lg,
  },
  footerTitle: {
    ...typography.body,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  footerBody: {
    ...typography.bodySmall,
    lineHeight: 21,
  },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? 34 : spacing.lg,
    backgroundColor: 'rgba(10, 10, 15, 0.96)',
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    gap: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    ...typography.body,
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
});
