/**
 * SettingsScreen — App preferences and info
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Pressable,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../theme/theme';
import { useFocusEffect } from '@react-navigation/native';
import {
  getPhotoCount,
  setAppSetting,
  getAllPoses,
  getGhostPhotoForPose,
  getPoseReferenceData,
  getPoseReferencePhotoId,
} from '../database/db';
import { getStorageUsed, formatBytes } from '../utils/storage';
import { importReferencePhotoForPose } from '../utils/referencePhotos';
import PoseReferencePreview from '../components/PoseReferencePreview';
import { getPoseTypeForPose } from '../utils/poseAlignment';
import { getPoseConfig } from '../constants/poseAlignment';

export default function SettingsScreen({ onRequestOnboarding }) {
  const [photoCount, setPhotoCount] = useState(0);
  const [storageUsed, setStorageUsed] = useState(0);
  const [poses, setPoses] = useState([]);
  const [ghostPhotos, setGhostPhotos] = useState({});
  const [referenceIds, setReferenceIds] = useState({});
  const [referenceKeypoints, setReferenceKeypoints] = useState({});
  const [poseTypes, setPoseTypes] = useState({});
  const [loadingPoseId, setLoadingPoseId] = useState(null);

  useEffect(() => {
    loadStats();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadPoseReferences();
    }, [])
  );

  const loadStats = async () => {
    try {
      const count = await getPhotoCount();
      const storage = await getStorageUsed();
      setPhotoCount(count);
      setStorageUsed(storage);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const loadPoseReferences = async () => {
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
      console.error('Failed to load pose references:', err);
    }
  };

  const handleReferenceImport = async (pose) => {
    setLoadingPoseId(pose.id);
    try {
      const result = await importReferencePhotoForPose(pose);

      if (result.status === 'permission_denied') {
        Alert.alert(
          'Permission Required',
          'Please allow photo library access to choose a default pose reference photo.',
        );
        return;
      }

      if (result.status !== 'success') return;

      if (result.warning) {
        Alert.alert('Reference Updated', result.warning);
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
      loadStats();
    } catch (err) {
      console.error('Failed to import reference photo:', err);
      Alert.alert('Error', 'Failed to update the reference photo.');
    } finally {
      setLoadingPoseId(null);
    }
  };

  const SettingRow = ({ icon, title, subtitle, onPress, color = colors.text, showChevron = true }) => (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={[styles.rowIcon, { backgroundColor: `${color}15` }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.rowTitle, { color }]}>{title}</Text>
        {subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}
      </View>
      {showChevron && (
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      )}
    </Pressable>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      {/* Stats card */}
      <View style={styles.statsCard}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{photoCount}</Text>
          <Text style={styles.statLabel}>Photos</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{formatBytes(storageUsed)}</Text>
          <Text style={styles.statLabel}>Storage Used</Text>
        </View>
      </View>

      {/* Camera section */}
      <Text style={styles.sectionTitle}>CAMERA</Text>
      <View style={styles.section}>
        <SettingRow
          icon="image-outline"
          title="Photo Quality"
          subtitle="High (1080px)"
          onPress={() => {
            Alert.alert('Photo Quality', 'Currently set to High (1080px wide). Future versions will allow customization.');
          }}
        />
        <View style={styles.separator} />
        <SettingRow
          icon="eye-outline"
          title="Pose Guidance"
          subtitle="Reference skeleton + live joint feedback"
          onPress={() => {
            Alert.alert('Pose Guidance', 'Use the camera screen toggle to hide or show the alignment overlay for the active pose.');
          }}
        />
      </View>

      <Text style={styles.sectionTitle}>GETTING STARTED</Text>
      <View style={styles.section}>
        <SettingRow
          icon="sparkles-outline"
          title="Replay Onboarding"
          subtitle="See the setup walkthrough again"
          onPress={async () => {
            await setAppSetting('onboarding_completed', false);
            onRequestOnboarding?.();
          }}
        />
      </View>

      <Text style={styles.sectionTitle}>POSE REFERENCES</Text>
      <View style={styles.poseSection}>
        {poses.map((pose) => {
          const ghostPhoto = ghostPhotos[pose.id];
          const hasReference = Boolean(referenceIds[pose.id]);
          const isLoading = loadingPoseId === pose.id;
          const poseLabel = getPoseConfig(poseTypes[pose.id] || getPoseTypeForPose(pose)).label;

          return (
            <View key={pose.id} style={styles.poseReferenceCard}>
              <View style={styles.poseReferenceHeader}>
                <View style={styles.poseReferenceMeta}>
                  <Text style={styles.poseReferenceIcon}>{pose.icon}</Text>
                  <View style={styles.poseReferenceText}>
                    <Text style={styles.poseReferenceTitle}>{pose.name}</Text>
                    <Text style={styles.poseReferenceSubtitle}>
                      {hasReference
                        ? referenceKeypoints[pose.id]
                          ? 'Used as the default live alignment reference for this pose'
                          : 'Reference photo saved. Skeleton overlay is waiting for real pose extraction.'
                        : 'No saved reference yet. Camera will fall back to the first captured pose photo.'}
                    </Text>
                  </View>
                </View>
              </View>

              <PoseReferencePreview
                photo={ghostPhoto}
                referenceKeypoints={referenceKeypoints[pose.id]}
                poseLabel={poseLabel}
                emptyLabel="No reference selected"
                statusLabel={referenceKeypoints[pose.id] ? 'Pose detected' : 'Photo only'}
              />

              <Pressable
                style={({ pressed }) => [
                  styles.poseReferenceButton,
                  pressed && styles.rowPressed,
                  isLoading && styles.poseReferenceButtonLoading,
                ]}
                onPress={() => handleReferenceImport(pose)}
                disabled={isLoading}
              >
                <Ionicons
                  name={hasReference ? 'refresh-outline' : 'cloud-upload-outline'}
                  size={18}
                  color={colors.primary}
                />
                <Text style={styles.poseReferenceButtonText}>
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

      {/* Data section */}
      <Text style={styles.sectionTitle}>DATA</Text>
      <View style={styles.section}>
        <SettingRow
          icon="shield-checkmark-outline"
          title="Privacy"
          subtitle="All photos stored locally on your device"
          showChevron={false}
          color={colors.success}
        />
      </View>

      {/* About section */}
      <Text style={styles.sectionTitle}>ABOUT</Text>
      <View style={styles.section}>
        <SettingRow
          icon="information-circle-outline"
          title="BodyTransform"
          subtitle="Version 1.0.0"
          showChevron={false}
        />
      </View>

      {/* Footer */}
      <Text style={styles.footer}>
        Your progress photos never leave your device. 🔒
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.title,
  },

  // Stats
  statsCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: spacing.lg,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    ...typography.number,
    fontSize: 24,
  },
  statLabel: {
    ...typography.caption,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.cardBorder,
    marginHorizontal: spacing.md,
  },

  // Sections
  sectionTitle: {
    ...typography.caption,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  poseSection: {
    marginHorizontal: spacing.md,
    gap: spacing.md,
  },
  separator: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginLeft: 60,
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.glass,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: {
    flex: 1,
  },
  rowTitle: {
    ...typography.body,
    fontSize: 15,
  },
  rowSubtitle: {
    ...typography.bodySmall,
    fontSize: 13,
    marginTop: 2,
  },
  poseReferenceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    gap: spacing.md,
  },
  poseReferenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  poseReferenceMeta: {
    flexDirection: 'row',
    gap: spacing.md,
    flex: 1,
  },
  poseReferenceIcon: {
    fontSize: 22,
    marginTop: 2,
  },
  poseReferenceText: {
    flex: 1,
  },
  poseReferenceTitle: {
    ...typography.body,
    fontWeight: '600',
    marginBottom: 4,
  },
  poseReferenceSubtitle: {
    ...typography.bodySmall,
    lineHeight: 20,
  },
  poseReferenceImage: {
    width: '100%',
    aspectRatio: 0.78,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceLight,
  },
  poseReferenceEmpty: {
    width: '100%',
    aspectRatio: 0.78,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  poseReferenceEmptyText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  poseReferenceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.md,
  },
  poseReferenceButtonLoading: {
    opacity: 0.7,
  },
  poseReferenceButtonText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },

  // Footer
  footer: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginTop: spacing.xl,
    color: colors.textMuted,
  },
});
