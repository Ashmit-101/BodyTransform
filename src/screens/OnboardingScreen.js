import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  ScrollView,
  Pressable,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';

import { colors, typography, spacing, radius, shadows } from '../theme/theme';
import {
  getAllPoses,
  getGhostPhotoForPose,
  getPoseReferenceData,
  getPoseReferencePhotoId,
  setAppSetting,
} from '../database/db';
import { importReferencePhotoForPose, saveReferencePhotoForPose } from '../utils/referencePhotos';
import PoseReferencePreview from '../components/PoseReferencePreview';
import PoseSkeletonOverlay from '../components/PoseSkeletonOverlay';
import CaptureButton from '../components/CaptureButton';
import { getPoseConfig } from '../constants/poseAlignment';
import {
  createReferenceKeypoints,
  evaluateAlignment,
  getPoseTypeForPose,
  smoothSkeleton,
} from '../utils/poseAlignment';
import { detectPoseInImage, validateExtractedKeypoints } from '../utils/poseDetection';
import { saveImageToAppDir } from '../utils/storage';
import { savePhoto } from '../database/db';

const LIVE_DETECTION_INTERVAL_MS = 900;

const DEFAULT_POSE_NAMES = ['Front Relaxed', 'Front Double Bicep'];
const CAMERA_SETUP_OPTIONS = [
  {
    id: 'handheld_front',
    title: 'Handheld front camera',
    subtitle: 'Fastest option. Best if you want selfie-style setup and mirrored preview.',
    facing: 'front',
    recommended: true,
  },
  {
    id: 'tripod_back',
    title: 'Tripod / back camera',
    subtitle: 'Best for stable framing and the cleanest full-body reference shots.',
    facing: 'back',
    recommended: false,
  },
  {
    id: 'mixed',
    title: 'Mixed setup',
    subtitle: 'Use whichever camera you reach for most. Defaults to front camera.',
    facing: 'front',
    recommended: false,
  },
];

function getFacingForSetup(setupId) {
  return CAMERA_SETUP_OPTIONS.find((option) => option.id === setupId)?.facing || 'front';
}

export default function OnboardingScreen({ onFinish }) {
  const [poses, setPoses] = useState([]);
  const [ghostPhotos, setGhostPhotos] = useState({});
  const [referenceIds, setReferenceIds] = useState({});
  const [referenceKeypoints, setReferenceKeypoints] = useState({});
  const [referenceSources, setReferenceSources] = useState({});
  const [poseTypes, setPoseTypes] = useState({});
  const [selectedPoseIds, setSelectedPoseIds] = useState(new Set());
  const [selectedCameraSetup, setSelectedCameraSetup] = useState('handheld_front');
  const [loadingPoseId, setLoadingPoseId] = useState(null);
  const [capturePose, setCapturePose] = useState(null);
  const [captureReady, setCaptureReady] = useState(false);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [liveKeypoints, setLiveKeypoints] = useState(null);
  const [liveDetectionActive, setLiveDetectionActive] = useState(false);
  const [liveAlignmentState, setLiveAlignmentState] = useState({
    joints: {},
    trackingState: 'scanning',
    isPoseAligned: false,
    progress: 0,
  });
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const cameraRef = useRef(null);
  const initializedSelectionRef = useRef(false);
  const liveDetectionTimerRef = useRef(null);
  const liveSkeletonRef = useRef(null);
  const liveDetectionInFlightRef = useRef(false);
  const liveAlignmentHistoryRef = useRef({});

  useEffect(() => {
    loadPoses();
  }, []);

  const selectedPoses = useMemo(
    () => poses.filter((pose) => selectedPoseIds.has(pose.id)),
    [poses, selectedPoseIds]
  );

  const selectedCount = selectedPoseIds.size;
  const completedCount = selectedPoses.filter(
    (pose) => referenceIds[pose.id] && referenceKeypoints[pose.id]
  ).length;
  const captureFacing = getFacingForSetup(selectedCameraSetup);
  const pendingCount = Math.max(0, selectedCount - completedCount);

  const loadPoses = async () => {
    try {
      const allPoses = await getAllPoses();
      setPoses(allPoses);

      const nextGhostPhotos = {};
      const nextReferenceIds = {};
      const nextReferenceKeypoints = {};
      const nextReferenceSources = {};
      const nextPoseTypes = {};

      for (const pose of allPoses) {
        const ghostPhoto = await getGhostPhotoForPose(pose.id);
        const referencePhotoId = await getPoseReferencePhotoId(pose.id);
        const referenceData = await getPoseReferenceData(pose.id);
        const resolvedPoseType = getPoseTypeForPose(pose);
        if (ghostPhoto) nextGhostPhotos[pose.id] = ghostPhoto;
        if (referencePhotoId) nextReferenceIds[pose.id] = referencePhotoId;
        nextPoseTypes[pose.id] = resolvedPoseType;
        if (referenceData?.keypoints) {
          nextReferenceKeypoints[pose.id] = referenceData.keypoints;
        }
        if (referenceData?.source) {
          nextReferenceSources[pose.id] = referenceData.source;
        }
      }

      setGhostPhotos(nextGhostPhotos);
      setReferenceIds(nextReferenceIds);
      setReferenceKeypoints(nextReferenceKeypoints);
      setReferenceSources(nextReferenceSources);
      setPoseTypes(nextPoseTypes);

      if (!initializedSelectionRef.current) {
        const nextSelected = new Set(
          allPoses.filter((pose) => DEFAULT_POSE_NAMES.includes(pose.name)).map((pose) => pose.id)
        );
        setSelectedPoseIds(nextSelected);
        initializedSelectionRef.current = true;
      }
    } catch (err) {
      console.error('Failed to load onboarding poses:', err);
    }
  };

  const updateReferenceState = (pose, result) => {
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
    setReferenceSources((prev) => ({
      ...prev,
      [pose.id]: result.referenceSource,
    }));
    setPoseTypes((prev) => ({
      ...prev,
      [pose.id]: result.poseType,
    }));
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

      updateReferenceState(pose, result);

      if (result.warning) {
        Alert.alert('Reference Saved', result.warning);
      }
    } catch (err) {
      console.error('Failed to import onboarding reference photo:', err);
      Alert.alert('Error', 'Failed to import that photo. Please try again.');
    } finally {
      setLoadingPoseId(null);
    }
  };

  const handleStartCapture = async (pose) => {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        Alert.alert(
          'Camera Permission Required',
          'Please allow camera access so you can take a reference photo directly.'
        );
        return;
      }
    }

    setCapturePose(pose);
    setCaptureReady(false);
  };

  const handleCapturePhoto = async () => {
    if (!capturePose || !cameraRef.current || captureLoading || !captureReady) return;

    setCaptureLoading(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.95,
        skipProcessing: false,
      });

      const saved = await saveImageToAppDir(photo.uri, capturePose.id);
      const capturedAt = new Date().toISOString();
      const photoId = await savePhoto(
        capturePose.id,
        saved.filePath,
        saved.width,
        saved.height,
        capturedAt
      );

      const savedPhoto = {
        id: photoId,
        pose_id: capturePose.id,
        file_path: saved.filePath,
        captured_at: capturedAt,
        width: saved.width,
        height: saved.height,
      };

      const result = await saveReferencePhotoForPose(capturePose, savedPhoto);
      updateReferenceState(capturePose, result);

      if (result.warning) {
        Alert.alert('Reference Saved', result.warning);
      } else {
        Alert.alert(
          'Reference Saved',
          'This pose now has an alignment reference. Keep using the same shape for future progress photos.'
        );
      }

      setCapturePose(null);
    } catch (err) {
      console.error('Failed to capture onboarding reference photo:', err);
      Alert.alert('Error', 'Failed to save the captured reference photo.');
    } finally {
      setCaptureLoading(false);
    }
  };

  const handleFinish = async () => {
    try {
      await setAppSetting('camera_setup_mode', selectedCameraSetup);
      await setAppSetting('camera_default_facing', captureFacing);
      await setAppSetting('onboarding_selected_pose_ids', JSON.stringify([...selectedPoseIds]));
      await onFinish?.();
    } catch (err) {
      console.error('Failed to finish onboarding:', err);
      Alert.alert('Error', 'Failed to save onboarding choices.');
    }
  };

  const togglePoseSelection = (poseId) => {
    setSelectedPoseIds((prev) => {
      const next = new Set(prev);
      if (next.has(poseId)) {
        next.delete(poseId);
      } else {
        next.add(poseId);
      }
      return next;
    });
  };

  const captureGuideKeypoints = useMemo(() => {
    if (!capturePose) return null;
    return createReferenceKeypoints({ pose: capturePose, width: 1080, height: 1440 });
  }, [capturePose]);

  const capturePoseType = useMemo(
    () => (capturePose ? getPoseTypeForPose(capturePose) : null),
    [capturePose]
  );

  useEffect(() => {
    if (!capturePose || !captureReady || captureLoading) {
      setLiveKeypoints(null);
      setLiveDetectionActive(false);
      setLiveAlignmentState({
        joints: {},
        trackingState: capturePose ? 'scanning' : 'idle',
        isPoseAligned: false,
        progress: 0,
      });
      liveSkeletonRef.current = null;
      if (liveDetectionTimerRef.current) {
        clearTimeout(liveDetectionTimerRef.current);
      }
      return undefined;
    }

    let cancelled = false;

    const runDetectionLoop = async () => {
      if (
        cancelled ||
        captureLoading ||
        !cameraRef.current ||
        !captureReady ||
        liveDetectionInFlightRef.current
      ) {
        liveDetectionTimerRef.current = setTimeout(runDetectionLoop, LIVE_DETECTION_INTERVAL_MS);
        return;
      }

      liveDetectionInFlightRef.current = true;

      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.35,
          skipProcessing: true,
          shutterSound: false,
        });

        if (!photo?.uri || cancelled) {
          setLiveDetectionActive(false);
          return;
        }

        const detectedKeypoints = await detectPoseInImage(
          photo.uri,
          photo.width || 1080,
          photo.height || 1440
        );

        if (cancelled) return;

        if (detectedKeypoints && validateExtractedKeypoints(detectedKeypoints, 0.35)) {
          const smoothedKeypoints = smoothSkeleton(detectedKeypoints, liveSkeletonRef.current, 0.42);
          liveSkeletonRef.current = smoothedKeypoints;
          setLiveKeypoints(smoothedKeypoints);
          setLiveDetectionActive(true);
        } else {
          liveSkeletonRef.current = null;
          setLiveKeypoints(null);
        setLiveDetectionActive(false);
      }

      if (captureGuideKeypoints && capturePoseType) {
        const nextAlignment = evaluateAlignment({
          poseType: capturePoseType,
          referenceKeypoints: captureGuideKeypoints,
          liveKeypoints: liveSkeletonRef.current,
          previousState: liveAlignmentHistoryRef.current,
          now: Date.now(),
        });
        liveAlignmentHistoryRef.current = nextAlignment.joints;
        setLiveAlignmentState(nextAlignment);
      }

        FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => {});
      } catch (err) {
        if (!cancelled) {
          console.warn('Onboarding pose detection failed:', err);
          liveSkeletonRef.current = null;
          setLiveKeypoints(null);
          setLiveDetectionActive(false);
        }
      } finally {
        liveDetectionInFlightRef.current = false;
        if (!cancelled) {
          liveDetectionTimerRef.current = setTimeout(runDetectionLoop, LIVE_DETECTION_INTERVAL_MS);
        }
      }
    };

    runDetectionLoop();

    return () => {
      cancelled = true;
      if (liveDetectionTimerRef.current) {
        clearTimeout(liveDetectionTimerRef.current);
      }
      liveDetectionInFlightRef.current = false;
      liveSkeletonRef.current = null;
      liveAlignmentHistoryRef.current = {};
    };
  }, [capturePose, captureReady, captureLoading, captureGuideKeypoints, capturePoseType]);

  const selectedSetup = CAMERA_SETUP_OPTIONS.find((option) => option.id === selectedCameraSetup) || CAMERA_SETUP_OPTIONS[0];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.badge}>
            <Ionicons name="sparkles-outline" size={14} color={colors.secondary} />
            <Text style={styles.badgeText}>First-time setup</Text>
          </View>
          <Text style={styles.title}>Choose your poses, camera setup, and reference photos.</Text>
          <Text style={styles.subtitle}>
            Pick the poses you actually train, choose how you shoot them, then add one clean reference photo per pose.
            Direct capture is recommended because the app can guide alignment while you take the shot.
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Selected poses</Text>
            <Text style={styles.summaryValue}>{selectedCount}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>References ready</Text>
            <Text style={styles.summaryValue}>{completedCount}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Camera setup</Text>
            <Text style={styles.summaryValue}>{selectedSetup.title}</Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>1. Select poses</Text>
              <Text style={styles.sectionBody}>
                Tap the poses you want to set up now. You can add the rest later in Settings.
              </Text>
            </View>
          </View>

          <View style={styles.poseGrid}>
            {poses.map((pose) => {
              const selected = selectedPoseIds.has(pose.id);
              return (
                <Pressable
                  key={pose.id}
                  style={[styles.poseChip, selected && styles.poseChipSelected]}
                  onPress={() => togglePoseSelection(pose.id)}
                >
                  <Text style={styles.poseChipIcon}>{pose.icon}</Text>
                  <View style={styles.poseChipText}>
                    <Text style={styles.poseChipTitle}>{pose.name}</Text>
                    <Text style={styles.poseChipSubtitle}>
                      {selected ? 'Selected for setup' : 'Tap to include'}
                    </Text>
                  </View>
                  <Ionicons
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={selected ? colors.secondary : colors.textMuted}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>2. Camera setup</Text>
              <Text style={styles.sectionBody}>
                This changes the default camera direction used later in the app.
              </Text>
            </View>
          </View>

          <View style={styles.setupList}>
            {CAMERA_SETUP_OPTIONS.map((option) => {
              const selected = selectedCameraSetup === option.id;
              return (
                <Pressable
                  key={option.id}
                  style={[styles.setupCard, selected && styles.setupCardSelected]}
                  onPress={() => setSelectedCameraSetup(option.id)}
                >
                  <View style={styles.setupCardTop}>
                    <Text style={styles.setupTitle}>{option.title}</Text>
                    {option.recommended && (
                      <View style={styles.recommendedPill}>
                        <Text style={styles.recommendedPillText}>Recommended</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.setupSubtitle}>{option.subtitle}</Text>
                  <View style={styles.setupCardBottom}>
                    <Text style={styles.setupMeta}>
                      Default camera: {option.facing === 'front' ? 'front' : 'back'}
                    </Text>
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={18}
                      color={selected ? colors.secondary : colors.textMuted}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>3. Add reference photos</Text>
              <Text style={styles.sectionBody}>
                Take a photo first if you can. The camera will show a pose guide while you capture.
                Upload is available if you already have a strong shot.
              </Text>
            </View>
            <View style={styles.progressPill}>
              <Text style={styles.progressPillText}>{completedCount}/{selectedCount || 0}</Text>
            </View>
          </View>

          {selectedPoses.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="images-outline" size={28} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Select one or more poses to continue</Text>
              <Text style={styles.emptyBody}>
                Your chosen poses will appear here with capture and upload options.
              </Text>
            </View>
          ) : (
            selectedPoses.map((pose) => {
              const ghostPhoto = ghostPhotos[pose.id];
              const hasReference = Boolean(referenceIds[pose.id]);
              const isLoading = loadingPoseId === pose.id;
              const referenceSource = referenceSources[pose.id];
              const poseLabel = getPoseConfig(poseTypes[pose.id] || getPoseTypeForPose(pose)).label;
              const referenceStatusLabel = !hasReference
                ? 'No reference'
                : referenceKeypoints[pose.id]
                  ? referenceSource === 'template'
                    ? 'Fallback guide'
                    : 'Guide ready'
                  : 'Photo only';

              return (
                <View key={pose.id} style={styles.referenceCard}>
                  <View style={styles.referenceHeader}>
                    <View style={styles.poseMeta}>
                      <Text style={styles.poseIcon}>{pose.icon}</Text>
                      <View style={styles.poseText}>
                        <Text style={styles.referenceTitle}>{pose.name}</Text>
                        <Text style={styles.referenceBody}>
                          {hasReference
                            ? referenceSource === 'template'
                              ? 'Saved with a fallback skeleton. Replace it with a cleaner bodybuilding pose when you can.'
                              : 'Saved as the alignment anchor for this pose.'
                            : 'No reference yet. Capture a clean pose or upload your best shot.'}
                        </Text>
                      </View>
                    </View>
                    {hasReference && (
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>
                          {referenceSource === 'template' ? 'Needs a better photo' : 'Reference ready'}
                        </Text>
                      </View>
                    )}
                  </View>

                  <PoseReferencePreview
                    photo={ghostPhoto}
                    referenceKeypoints={referenceKeypoints[pose.id]}
                    poseLabel={poseLabel}
                    statusLabel={referenceStatusLabel}
                    referenceSource={referenceSource}
                  />

                  <View style={styles.actionRow}>
                    <Pressable
                      style={[styles.primaryAction, isLoading && styles.actionDisabled]}
                      onPress={() => handleStartCapture(pose)}
                      disabled={isLoading}
                    >
                      <Ionicons name="camera-outline" size={18} color="#fff" />
                      <Text style={styles.primaryActionText}>
                        {isLoading ? 'Loading…' : 'Take photo'}
                      </Text>
                      <Text style={styles.primaryActionMeta}>Recommended</Text>
                    </Pressable>

                    <Pressable
                      style={[styles.secondaryAction, isLoading && styles.actionDisabled]}
                      onPress={() => handleImportReference(pose)}
                      disabled={isLoading}
                    >
                      <Ionicons name="cloud-upload-outline" size={18} color={colors.secondary} />
                      <Text style={styles.secondaryActionText}>
                        {isLoading ? 'Loading…' : 'Upload photo'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.footerCard}>
          <Text style={styles.footerTitle}>Why this matters</Text>
          <Text style={styles.footerBody}>
            A clean first reference beats a guessed template. If the app can detect joints from your reference shot,
            it will use them. If not, it falls back to a pose template until you replace it with a better photo.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable style={styles.primaryButton} onPress={handleFinish}>
          <Text style={styles.primaryButtonText}>Finish setup</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={handleFinish}>
          <Text style={styles.secondaryButtonText}>
            Skip for now
          </Text>
        </Pressable>
        {pendingCount > 0 && (
          <Text style={styles.footerNote}>
            {pendingCount} selected pose{pendingCount === 1 ? '' : 's'} still need a reference photo.
          </Text>
        )}
      </View>

      <Modal visible={Boolean(capturePose)} animationType="slide" statusBarTranslucent>
        <View style={styles.captureModal}>
          <CameraView
            ref={cameraRef}
            style={styles.captureCamera}
            facing={captureFacing}
            onCameraReady={() => setCaptureReady(true)}
          />
          <View pointerEvents="box-none" style={styles.captureOverlay}>
            {capturePose && captureGuideKeypoints && (
              <PoseSkeletonOverlay
                referenceKeypoints={captureGuideKeypoints}
                liveKeypoints={null}
                jointStateMap={{}}
                showReference
                referenceDimmed={false}
              />
            )}

            <View style={styles.captureTopBar}>
              <Pressable
                style={[styles.captureClose, captureLoading && styles.captureDisabled]}
                onPress={() => setCapturePose(null)}
                disabled={captureLoading}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </Pressable>
              <View style={styles.captureTitleCard}>
                <Text style={styles.captureTitle}>{capturePose?.name || 'Capture reference'}</Text>
                <Text style={styles.captureSubtitle}>
                  Match the guide, keep your full body visible, then take the shot.
                </Text>
              </View>
            </View>

            <View style={styles.captureBottomBar}>
              {!captureReady ? (
                <View style={styles.captureLoading}>
                  <ActivityIndicator size="small" color={colors.secondary} />
                  <Text style={styles.captureLoadingText}>Opening camera…</Text>
                </View>
              ) : (
                <>
                  <View style={styles.captureStatusRow}>
                    <View style={[styles.captureStatusPill, liveDetectionActive && styles.captureStatusPillActive]}>
                      <Text style={[styles.captureStatusText, liveDetectionActive && styles.captureStatusTextActive]}>
                        {liveDetectionActive ? 'Joints detected' : 'Finding pose...'}
                      </Text>
                    </View>
                    <Text style={styles.captureStatusMeta}>
                      {liveAlignmentState.trackingState === 'move_into_frame'
                        ? 'Move farther back'
                        : liveAlignmentState.isPoseAligned
                          ? 'Aligned'
                          : 'Adjust until the guide locks'}
                    </Text>
                  </View>
                  <Text style={styles.captureTip}>
                    Capture a clean bodybuilding pose. This becomes the anchor for live joint alignment.
                  </Text>
                  <View style={styles.captureActionRow}>
                    <Pressable
                      style={[styles.captureCancel, captureLoading && styles.captureDisabled]}
                      onPress={() => setCapturePose(null)}
                      disabled={captureLoading}
                    >
                      <Text style={styles.captureCancelText}>Cancel</Text>
                    </Pressable>
                    <CaptureButton
                      onCapture={handleCapturePhoto}
                      disabled={captureLoading}
                    />
                  </View>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingTop: 72,
    paddingHorizontal: spacing.lg,
    paddingBottom: 190,
  },
  hero: {
    marginBottom: spacing.lg,
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
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  summaryLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  summaryValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.text,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.heading,
    fontSize: 18,
    marginBottom: 6,
  },
  sectionBody: {
    ...typography.bodySmall,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  poseGrid: {
    gap: spacing.sm,
  },
  poseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  poseChipSelected: {
    borderColor: colors.secondary,
    backgroundColor: 'rgba(0, 217, 255, 0.1)',
  },
  poseChipIcon: {
    fontSize: 22,
  },
  poseChipText: {
    flex: 1,
  },
  poseChipTitle: {
    ...typography.body,
    fontWeight: '600',
    marginBottom: 4,
  },
  poseChipSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'none',
  },
  setupList: {
    gap: spacing.sm,
  },
  setupCard: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    gap: spacing.sm,
  },
  setupCardSelected: {
    borderColor: colors.secondary,
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
  },
  setupCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  setupTitle: {
    ...typography.body,
    fontWeight: '700',
    flex: 1,
  },
  recommendedPill: {
    borderRadius: radius.full,
    backgroundColor: 'rgba(0, 217, 255, 0.16)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  recommendedPillText: {
    ...typography.caption,
    color: colors.secondary,
    textTransform: 'none',
  },
  setupSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  setupCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  setupMeta: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'none',
  },
  progressPill: {
    borderRadius: radius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  progressPillText: {
    ...typography.caption,
    color: colors.text,
    textTransform: 'none',
  },
  referenceCard: {
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  referenceHeader: {
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
  referenceTitle: {
    ...typography.body,
    fontWeight: '700',
    marginBottom: 6,
  },
  referenceBody: {
    ...typography.bodySmall,
    lineHeight: 21,
    color: colors.textSecondary,
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
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryAction: {
    flex: 1,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  primaryActionText: {
    ...typography.body,
    color: '#fff',
    fontWeight: '700',
  },
  primaryActionMeta: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.78)',
    textTransform: 'none',
  },
  secondaryAction: {
    flex: 1,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0, 217, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 217, 255, 0.22)',
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryActionText: {
    ...typography.body,
    color: colors.secondary,
    fontWeight: '700',
  },
  actionDisabled: {
    opacity: 0.65,
  },
  captureDisabled: {
    opacity: 0.55,
  },
  footerCard: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  footerTitle: {
    ...typography.body,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  footerBody: {
    ...typography.bodySmall,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.body,
    fontWeight: '700',
  },
  emptyBody: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 34,
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
  footerNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    textTransform: 'none',
  },
  captureModal: {
    flex: 1,
    backgroundColor: colors.background,
  },
  captureCamera: {
    ...StyleSheet.absoluteFillObject,
  },
  captureOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  captureTopBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  captureClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureTitleCard: {
    flex: 1,
    backgroundColor: 'rgba(10, 10, 15, 0.82)',
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  captureTitle: {
    ...typography.heading,
    marginBottom: 6,
  },
  captureSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  captureBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 36,
    backgroundColor: 'rgba(10, 10, 15, 0.65)',
    gap: spacing.md,
  },
  captureTip: {
    ...typography.bodySmall,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 20,
  },
  captureActionRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    gap: spacing.md,
  },
  captureCancel: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  captureCancelText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  captureLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  captureStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  captureStatusPill: {
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  captureStatusPillActive: {
    backgroundColor: 'rgba(0, 230, 118, 0.18)',
  },
  captureStatusText: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'none',
  },
  captureStatusTextActive: {
    color: colors.success,
  },
  captureStatusMeta: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'none',
    flex: 1,
    textAlign: 'right',
  },
  captureLoadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
});
