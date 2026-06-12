/**
 * CameraScreen — Pose alignment camera
 *
 * Replaces the old photo ghost overlay with a reference skeleton and
 * real-time alignment feedback states.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Pressable,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';

import PoseSkeletonOverlay from '../components/PoseSkeletonOverlay';
import CaptureButton from '../components/CaptureButton';
import { colors, typography, spacing, radius } from '../theme/theme';
import {
  getAllPoses,
  getGhostPhotoForPose,
  getAppSetting,
  getBooleanAppSetting,
  getPoseReferenceData,
  getPoseReferencePhotoId,
  savePhoto,
  savePoseReferenceKeypoints,
  setAppSetting,
  setPoseType,
} from '../database/db';
import { saveImageToAppDir } from '../utils/storage';
import {
  createReferenceKeypoints,
  evaluateAlignment,
  getPoseTypeForPose,
  smoothSkeleton,
} from '../utils/poseAlignment';
import { getPoseConfig } from '../constants/poseAlignment';
import { detectPoseInImage, validateExtractedKeypoints } from '../utils/poseDetection';
import { saveReferencePhotoForPose } from '../utils/referencePhotos';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GUIDE_SETTING_KEY = 'pose_alignment_enabled';
const CAMERA_SETUP_KEY = 'camera_setup_mode';
const CAMERA_FACING_KEY = 'camera_default_facing';
const LIVE_DETECTION_INTERVAL_MS = 900;

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState('front');
  const [poses, setPoses] = useState([]);
  const [selectedPose, setSelectedPose] = useState(null);
  const [referencePhoto, setReferencePhoto] = useState(null);
  const [referenceKeypoints, setReferenceKeypoints] = useState(null);
  const [referenceSource, setReferenceSource] = useState(null);
  const [poseType, setSelectedPoseType] = useState('front_double_biceps');
  const [capturing, setCapturing] = useState(false);
  const [showPoseSelector, setShowPoseSelector] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [guidanceEnabled, setGuidanceEnabled] = useState(true);
  const [guidancePreferenceLoaded, setGuidancePreferenceLoaded] = useState(false);
  const [showHelperCard, setShowHelperCard] = useState(true);
  const [liveKeypoints, setLiveKeypoints] = useState(null);
  const [liveDetectionActive, setLiveDetectionActive] = useState(false);
  const [cameraSetupMode, setCameraSetupMode] = useState('handheld_front');
  const [alignmentState, setAlignmentState] = useState({
    joints: {},
    progress: 0,
    alignedCount: 0,
    visibleCount: 0,
    lockedKeyJointCount: 0,
    requiredKeyJointCount: 0,
    requiredVisibleKeyJointCount: 0,
    hasEnoughVisibleJoints: false,
    isPoseAligned: false,
    trackingState: 'scanning',
    symmetry: { score: null, insights: [] },
  });
  const [successArmed, setSuccessArmed] = useState(true);

  const cameraRef = useRef(null);
  const helperTimerRef = useRef(null);
  const liveDetectionTimerRef = useRef(null);
  const alignmentHistoryRef = useRef({});
  const liveSkeletonRef = useRef(null);
  const liveDetectionInFlightRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      loadGuidancePreference();
      loadPoses();
      setShowHelperCard(true);
      helperTimerRef.current = setTimeout(() => setShowHelperCard(false), 18000);
      return () => clearTimeout(helperTimerRef.current);
    }, [])
  );

  useEffect(() => {
    loadCameraSetup();
  }, []);

  useEffect(() => {
    if (!guidanceEnabled || !referenceKeypoints) {
      setLiveKeypoints(null);
      setLiveDetectionActive(false);
      alignmentHistoryRef.current = {};
      liveSkeletonRef.current = null;
      return undefined;
    }

    let cancelled = false;

    const runDetectionLoop = async () => {
      if (
        cancelled ||
        capturing ||
        !cameraReady ||
        !cameraRef.current ||
        !guidanceEnabled ||
        !referenceKeypoints ||
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
          photo.width || SCREEN_WIDTH,
          photo.height || SCREEN_WIDTH * 1.6
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

        FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => {});
      } catch (err) {
        if (!cancelled) {
          console.warn('Live pose detection failed:', err);
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
    };
  }, [cameraReady, capturing, guidanceEnabled, referenceKeypoints]);

  useEffect(() => {
    if (!referenceKeypoints || !liveKeypoints) {
      setAlignmentState({
        joints: {},
        progress: 0,
        alignedCount: 0,
        visibleCount: 0,
        lockedKeyJointCount: 0,
        requiredKeyJointCount: Math.ceil(getPoseConfig(poseType).keyJoints.length * getPoseConfig(poseType).requiredJointsAligned),
        requiredVisibleKeyJointCount: Math.max(4, Math.ceil(getPoseConfig(poseType).keyJoints.length * 0.6)),
        hasEnoughVisibleJoints: false,
        isPoseAligned: false,
        trackingState: liveKeypoints ? 'not_aligned' : 'scanning',
        symmetry: { score: null, insights: [] },
      });
      return;
    }

    const nextAlignment = evaluateAlignment({
      poseType,
      referenceKeypoints,
      liveKeypoints,
      previousState: alignmentHistoryRef.current,
      now: Date.now(),
      mirrorLiveX: facing === 'front',
    });

    alignmentHistoryRef.current = nextAlignment.joints;
    setAlignmentState(nextAlignment);
  }, [facing, liveKeypoints, poseType, referenceKeypoints]);

  useEffect(() => {
    if (!alignmentState.isPoseAligned) {
      setSuccessArmed(true);
      return;
    }

    if (!successArmed) return;

    setSuccessArmed(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [alignmentState.isPoseAligned, successArmed]);

  const loadGuidancePreference = async () => {
    try {
      const enabled = await getBooleanAppSetting(GUIDE_SETTING_KEY, true);
      setGuidanceEnabled(enabled);
    } catch (err) {
      console.error('Failed to load pose guidance preference:', err);
      setGuidanceEnabled(true);
    } finally {
      setGuidancePreferenceLoaded(true);
    }
  };

  const loadCameraSetup = async () => {
    try {
      const setupMode = await getAppSetting(CAMERA_SETUP_KEY, 'handheld_front');
      const storedFacing = await getAppSetting(CAMERA_FACING_KEY, getFacingFromSetup(setupMode));
      setCameraSetupMode(setupMode);
      setFacing(storedFacing === 'back' ? 'back' : 'front');
    } catch (err) {
      console.error('Failed to load camera setup:', err);
    }
  };

  function getFacingFromSetup(setupMode) {
    return setupMode === 'tripod_back' ? 'back' : 'front';
  }

  const ensureReferenceSkeletonForPose = async (pose, photo) => {
    const referenceData = await getPoseReferenceData(pose.id);
    const resolvedPoseType = getPoseTypeForPose(pose);

    if (referenceData?.poseType !== resolvedPoseType) {
      await setPoseType(pose.id, resolvedPoseType);
    }

    setSelectedPoseType(resolvedPoseType);
    setReferenceSource(referenceData?.source || null);

    if (referenceData?.source === 'template' && photo) {
      const templateNeedsRefresh = referenceData?.poseType !== resolvedPoseType || !referenceData?.keypoints;

      if (templateNeedsRefresh) {
        const fallbackKeypoints = createReferenceKeypoints({
          pose: { ...pose, pose_type: resolvedPoseType },
          width: photo.width || 1080,
          height: photo.height || 1440,
        });

        await savePoseReferenceKeypoints(pose.id, fallbackKeypoints, 'template');
        setReferenceKeypoints(fallbackKeypoints);
        setReferenceSource('template');
        return;
      }
    }

    if (referenceData?.keypoints) {
      setReferenceKeypoints(referenceData.keypoints);
      return;
    }

    if (!photo) {
      setReferenceKeypoints(null);
      return;
    }

    const fallbackKeypoints = createReferenceKeypoints({
      pose: { ...pose, pose_type: resolvedPoseType },
      width: photo.width || 1080,
      height: photo.height || 1440,
    });

    await savePoseReferenceKeypoints(pose.id, fallbackKeypoints, 'template');
    setReferenceKeypoints(fallbackKeypoints);
    setReferenceSource('template');
  };

  const loadPoses = async () => {
    try {
      const allPoses = await getAllPoses();
      setPoses(allPoses);

      const nextPose = selectedPose && allPoses.some((pose) => pose.id === selectedPose.id)
        ? allPoses.find((pose) => pose.id === selectedPose.id)
        : allPoses[0] || null;

      setSelectedPose(nextPose);

      if (nextPose) {
        await loadReferenceForPose(nextPose);
      } else {
        setReferencePhoto(null);
        setReferenceKeypoints(null);
      }
    } catch (err) {
      console.error('Failed to load poses:', err);
    }
  };

  const loadReferenceForPose = async (pose) => {
    try {
      const reference = await getGhostPhotoForPose(pose.id);
      setReferencePhoto(reference || null);
      if (reference) {
        await ensureReferenceSkeletonForPose(pose, reference);
      } else {
        setSelectedPoseType(getPoseTypeForPose(pose));
        setReferenceKeypoints(null);
        setReferenceSource(null);
      }
    } catch (err) {
      console.error('Failed to load pose reference:', err);
      setReferencePhoto(null);
      setReferenceKeypoints(null);
      setReferenceSource(null);
    }
  };

  const handlePoseSelect = async (pose) => {
    setSelectedPose(pose);
    setShowPoseSelector(false);
    alignmentHistoryRef.current = {};
    liveSkeletonRef.current = null;
    await loadReferenceForPose(pose);
  };

  const persistGuidancePreference = async (enabled) => {
    setGuidanceEnabled(enabled);
    try {
      await setAppSetting(GUIDE_SETTING_KEY, enabled);
    } catch (err) {
      console.error('Failed to save guidance preference:', err);
    }
  };

  const handleGuideToggle = async () => {
    if (!referencePhoto) {
      Alert.alert(
        'Add a Reference Pose',
        'Import or capture a clean bodybuilding reference photo for this pose before turning on pose guidance.',
      );
      return;
    }

    if (!referenceKeypoints) {
      Alert.alert(
        'Pose Detection Unavailable',
        'This pose has a saved reference photo, but this build does not have extracted skeleton keypoints for it yet. Re-import a clearer bodybuilding reference photo after the native pose detector is installed.',
      );
      return;
    }

    await persistGuidancePreference(!guidanceEnabled);
  };

  const handleCapture = async () => {
    if (!cameraRef.current || capturing || !selectedPose || !cameraReady) return;

    const referencePhotoId = await getPoseReferencePhotoId(selectedPose.id);
    if (!referencePhotoId) {
      Alert.alert(
        `${selectedPose.name} reference`,
        'This category needs a first reference photo before normal progress shots. Use a clear bodybuilding pose, keep your full body visible, and hold the pose steady so the joints line up correctly.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Take reference',
            onPress: () => captureReferencePhoto(),
          },
        ]
      );
      return;
    }

    await captureProgressPhoto();
  };

  const captureProgressPhoto = async () => {
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
      });

      const saved = await saveImageToAppDir(photo.uri, selectedPose.id);
      await savePhoto(selectedPose.id, saved.filePath, saved.width, saved.height);

      await loadReferenceForPose(selectedPose);
      loadPoses();
    } catch (err) {
      console.error('Capture failed:', err);
      Alert.alert('Error', 'Failed to capture photo. Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  const captureReferencePhoto = async () => {
    if (!cameraRef.current || capturing || !selectedPose || !cameraReady) return;

    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
      });

      const saved = await saveImageToAppDir(photo.uri, selectedPose.id);
      const capturedAt = new Date().toISOString();
      const photoId = await savePhoto(
        selectedPose.id,
        saved.filePath,
        saved.width,
        saved.height,
        capturedAt
      );

      const savedPhoto = {
        id: photoId,
        pose_id: selectedPose.id,
        file_path: saved.filePath,
        captured_at: capturedAt,
        width: saved.width,
        height: saved.height,
      };

      const referenceResult = await saveReferencePhotoForPose(selectedPose, savedPhoto);

      await loadReferenceForPose(selectedPose);
      loadPoses();

      if (referenceResult.referenceSource === 'template') {
        Alert.alert(
          'Reference needs a clearer pose',
          referenceResult.warning || 'This first reference photo was saved with a fallback skeleton. Retake it with a cleaner bodybuilding pose so your alignment matches your joints.'
        );
      } else {
        Alert.alert(
          'Reference saved',
          'This pose now has a reference anchor. Keep using the same bodybuilding shape for future alignment and progress photos.'
        );
      }
    } catch (err) {
      console.error('Reference capture failed:', err);
      Alert.alert('Error', 'Failed to save the reference photo. Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  const parseExifDate = (exifDate) => {
    if (!exifDate || typeof exifDate !== 'string') return null;
    const parts = exifDate.split(' ');
    if (parts.length < 2) return null;
    const datePart = parts[0].replace(/:/g, '-');
    return `${datePart} ${parts[1]}`;
  };

  const handleGalleryImport = async () => {
    if (!selectedPose) {
      Alert.alert('Select a Pose', 'Please select a pose category before importing photos.');
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'Please allow access to your photo library in Settings to import reference shots.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
      selectionLimit: 20,
      orderedSelection: true,
      exif: true,
    });

    if (result.canceled || result.assets.length === 0) return;

    setCapturing(true);
    try {
      let fallbackReferenceSaved = false;

      for (const asset of result.assets) {
        const saved = await saveImageToAppDir(asset.uri, selectedPose.id);
        const capturedAt = parseExifDate(asset.exif?.DateTimeOriginal) || null;
        const photoId = await savePhoto(selectedPose.id, saved.filePath, saved.width, saved.height, capturedAt);
        const referencePhotoId = await getPoseReferencePhotoId(selectedPose.id);

        if (!referencePhotoId) {
          const referenceResult = await saveReferencePhotoForPose(selectedPose, {
            id: photoId,
            pose_id: selectedPose.id,
            file_path: saved.filePath,
            captured_at: capturedAt || new Date().toISOString(),
            width: saved.width,
            height: saved.height,
          });
          fallbackReferenceSaved = fallbackReferenceSaved || referenceResult.referenceSource === 'template';
        }
      }

      await loadReferenceForPose(selectedPose);
      loadPoses();

      const count = result.assets.length;
      Alert.alert(
        'Imported',
        fallbackReferenceSaved
          ? `${count} photo${count > 1 ? 's' : ''} added to ${selectedPose.name}. The first reference used a fallback skeleton, so replace it with a cleaner bodybuilding pose when you can.`
          : `${count} photo${count > 1 ? 's' : ''} added to ${selectedPose.name}.`
      );
    } catch (err) {
      console.error('Gallery import failed:', err);
      Alert.alert('Error', 'Failed to import photos. Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  const toggleCamera = () => {
    setFacing((currentFacing) => (currentFacing === 'front' ? 'back' : 'front'));
  };

  const poseConfig = getPoseConfig(poseType);
  const poseReferenceReady = Boolean(referencePhoto && referenceKeypoints);
  const hasReferencePhotoOnly = Boolean(referencePhoto && !referenceKeypoints);
  const referenceNeedsRebuild = referenceSource === 'template';
  const liveTrackingVisible = Boolean(liveKeypoints);
  const guideStatusTitle = !referencePhoto
    ? 'Set your first reference'
    : referenceNeedsRebuild
      ? 'Reference needs a clearer pose'
      : hasReferencePhotoOnly
      ? 'Reference photo saved'
      : !guidanceEnabled
        ? 'Guidance hidden'
        : alignmentState.trackingState === 'move_into_frame'
          ? 'Move into frame'
          : liveDetectionActive
          ? 'Live pose tracking active'
          : 'Reference skeleton ready';
  const guideStatusBody = !referencePhoto
    ? 'This category does not have an anchor photo yet. Capture a clean bodybuilding pose with your full body visible so the app can build its pose guide.'
    : referenceNeedsRebuild
      ? 'This pose is using a fallback skeleton. Retake the reference with a cleaner bodybuilding pose so the joint alignment matches your actual shape.'
    : hasReferencePhotoOnly
      ? 'This pose has a saved reference photo, but no skeleton data yet. Re-import a cleaner bodybuilding reference photo to rebuild its pose guide.'
      : !guidanceEnabled
        ? 'Turn guidance back on when you want live joint feedback during your setup.'
        : liveDetectionActive && alignmentState.isPoseAligned
          ? 'You are aligned to the reference skeleton. Hold steady to capture this pose.'
          : alignmentState.trackingState === 'move_into_frame'
          ? 'Move into frame until the camera can see enough of your body to compare the pose.'
          : liveDetectionActive
          ? 'You are not aligned yet. Move your joints to match the reference skeleton, then hold steady for live feedback.'
          : 'Waiting for a readable body pose in the camera view. Keep your full body visible and hold the phone steady for live joint feedback.';
  const cameraSetupHint = cameraSetupMode === 'tripod_back'
    ? 'Onboarding set this camera to back-facing for a stable setup.'
    : 'Onboarding set this camera to front-facing for a mirrored setup.';
  const symmetryScore = alignmentState.symmetry.score;
  const symmetryLabel = symmetryScore === null
    ? 'Symmetry waiting'
    : `${Math.round(symmetryScore * 100)}% symmetry`;
  const progressPercent = Math.round(alignmentState.progress * 100);
  const helperPillLabel = !referencePhoto
    ? 'Setup'
    : alignmentState.isPoseAligned
      ? 'Aligned'
      : alignmentState.trackingState === 'move_into_frame'
        ? 'Move into frame'
        : liveTrackingVisible
        ? 'Not aligned'
        : 'Scanning';

  if (!permission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Ionicons name="camera-outline" size={64} color={colors.textMuted} />
        <Text style={styles.permTitle}>Camera Access Required</Text>
        <Text style={styles.permSubtitle}>
          BodyTransform needs camera access to coach your pose and capture progress photos.
        </Text>
        <Pressable style={styles.permButton} onPress={requestPermission}>
          <Text style={styles.permButtonText}>Enable Camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        onCameraReady={() => setCameraReady(true)}
      />
      <View pointerEvents="box-none" style={styles.cameraOverlay}>
        {guidanceEnabled && referenceKeypoints && (
          <PoseSkeletonOverlay
            referenceKeypoints={referenceKeypoints}
            liveKeypoints={liveKeypoints}
            jointStateMap={alignmentState.joints}
            showReference
            referenceDimmed={liveTrackingVisible}
          />
        )}

        <View style={styles.topBar}>
          <Pressable
            style={styles.poseSelector}
            onPress={() => setShowPoseSelector((current) => !current)}
          >
            <Text style={styles.poseSelectorIcon}>{selectedPose?.icon || '💪'}</Text>
            <Text style={styles.poseSelectorText} numberOfLines={1}>
              {selectedPose?.name || 'Select Pose'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.text} />
          </Pressable>

          <Pressable style={styles.iconButton} onPress={toggleCamera}>
            <Ionicons name="camera-reverse-outline" size={24} color={colors.text} />
          </Pressable>
        </View>

        {showPoseSelector && (
          <View style={styles.dropdown}>
            {poses.map((pose) => (
              <Pressable
                key={pose.id}
                style={[
                  styles.dropdownItem,
                  selectedPose?.id === pose.id && styles.dropdownItemActive,
                ]}
                onPress={() => handlePoseSelect(pose)}
              >
                <Text style={styles.dropdownIcon}>{pose.icon}</Text>
                <Text style={styles.dropdownText}>{pose.name}</Text>
                {selectedPose?.id === pose.id && (
                  <Ionicons name="checkmark" size={18} color={colors.secondary} />
                )}
              </Pressable>
            ))}
          </View>
        )}

        {poseReferenceReady && (
          <View style={styles.modeBadge}>
            <Ionicons name="body-outline" size={14} color={colors.secondary} />
            <Text style={styles.modeBadgeText}>{poseConfig.label}</Text>
          </View>
        )}

        <View style={styles.bottomBar}>
          {showHelperCard && (!guidancePreferenceLoaded ? (
            <View style={styles.helperCard}>
              <ActivityIndicator size="small" color={colors.secondary} />
              <Text style={styles.helperBody}>Loading pose guidance…</Text>
            </View>
          ) : (
            <View style={styles.helperCard}>
              <View style={styles.helperHeader}>
                <View style={styles.helperTitleRow}>
                  <Ionicons
                    name={!referencePhoto ? 'camera-outline' : guidanceEnabled ? 'body-outline' : 'eye-off-outline'}
                    size={16}
                    color={!referencePhoto ? colors.warning : guidanceEnabled ? colors.secondary : colors.textMuted}
                  />
                  <Text style={styles.helperTitle}>{guideStatusTitle}</Text>
                </View>
                <View style={[styles.helperPill, alignmentState.isPoseAligned && styles.helperPillActive]}>
                  <Text style={[styles.helperPillText, alignmentState.isPoseAligned && styles.helperPillTextActive]}>
                    {helperPillLabel}
                  </Text>
                </View>
              </View>
              <Text style={styles.helperBody}>{guideStatusBody}</Text>
              <Text style={styles.helperNote}>{cameraSetupHint}</Text>
            </View>
          ))}

          {poseReferenceReady && guidanceEnabled && liveTrackingVisible && (
            <View style={styles.statsCard}>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Locked joints</Text>
                <Text style={styles.statValue}>
                  {alignmentState.lockedKeyJointCount}/{poseConfig.keyJoints.length}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
              <View style={styles.statFooter}>
                <Text style={styles.statCaption}>{symmetryLabel}</Text>
                <Text style={styles.statCaption}>
                  Hold steady for {poseConfig.holdTimeMs / 1000}s
                </Text>
              </View>
              {alignmentState.symmetry.insights?.[0] && (
                <Text style={styles.symmetryHint}>{alignmentState.symmetry.insights[0]}</Text>
              )}
            </View>
          )}

          <View style={styles.captureRow}>
            <Pressable
              style={styles.iconButton}
              onPress={handleGalleryImport}
              disabled={capturing}
            >
              <Ionicons name="image-outline" size={26} color={capturing ? colors.textMuted : colors.text} />
            </Pressable>

            <CaptureButton onCapture={handleCapture} disabled={capturing || !cameraReady} />

            <Pressable
              style={styles.iconButton}
              onPress={handleGuideToggle}
              disabled={!guidancePreferenceLoaded}
            >
              <Ionicons
                name={!referencePhoto ? 'body-outline' : !referenceKeypoints ? 'alert-circle-outline' : guidanceEnabled ? 'eye-outline' : 'body-outline'}
                size={26}
                color={!referencePhoto || !guidancePreferenceLoaded ? colors.textMuted : !referenceKeypoints ? colors.warning : colors.text}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  permTitle: {
    ...typography.heading,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  permSubtitle: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  permButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  permButtonText: {
    ...typography.body,
    fontWeight: '600',
    color: '#fff',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: spacing.md,
    zIndex: 100,
  },
  poseSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    gap: spacing.xs,
    maxWidth: SCREEN_WIDTH * 0.64,
  },
  poseSelectorIcon: {
    fontSize: 18,
  },
  poseSelectorText: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '600',
  },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdown: {
    position: 'absolute',
    top: 110,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(19, 19, 26, 0.96)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
    zIndex: 200,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  dropdownItemActive: {
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
  },
  dropdownIcon: {
    fontSize: 20,
  },
  dropdownText: {
    ...typography.body,
    fontSize: 15,
    flex: 1,
  },
  modeBadge: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 217, 255, 0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    gap: 4,
    zIndex: 50,
  },
  modeBadgeText: {
    color: colors.secondary,
    fontSize: 11,
    fontWeight: '700',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 100,
    paddingTop: spacing.md,
    alignItems: 'center',
    zIndex: 100,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  helperCard: {
    width: '88%',
    backgroundColor: 'rgba(10, 10, 15, 0.82)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  helperHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  helperTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  helperTitle: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '600',
  },
  helperBody: {
    ...typography.bodySmall,
    lineHeight: 20,
  },
  helperNote: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'none',
    lineHeight: 18,
  },
  helperPill: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  helperPillActive: {
    backgroundColor: 'rgba(0, 230, 118, 0.18)',
  },
  helperPillText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  helperPillTextActive: {
    color: colors.success,
  },
  statsCard: {
    width: '88%',
    backgroundColor: 'rgba(6, 8, 12, 0.84)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  statValue: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '700',
  },
  progressTrack: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.success,
  },
  statFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statCaption: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'none',
    letterSpacing: 0.2,
  },
  symmetryHint: {
    ...typography.bodySmall,
    color: colors.warning,
  },
  captureRow: {
    width: '84%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
