/**
 * CaptureScreen — partial ghost overlay MVP.
 *
 * Flow: load reference photo → extract 5 anchors via sidecar → poll live
 * frames every 800ms → rings go green on alignment → 3s countdown →
 * auto-capture at full quality.
 *
 * Validation prototype: no chrome, no shutter button, no settings.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';

import GhostOverlay from '../components/capture/GhostOverlay';
import CountdownRing from '../components/capture/CountdownRing';
import AlignmentStatus from '../components/capture/AlignmentStatus';
import { STATUS, useCaptureStore } from '../store/captureStore';
import {
  extractAnchors,
  isGloballyLocked as checkGlobalLock,
  isPartiallyAligned,
  scoreAlignment,
} from '../utils/anchorUtils';
import { fetchLandmarks } from '../utils/sidecarClient';

const POLL_INTERVAL_MS = 800;
const COUNTDOWN_MS = 3000;
const MAX_CONSECUTIVE_FAILURES = 3;

export default function CaptureScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [loadingReference, setLoadingReference] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);

  const store = useCaptureStore();
  const {
    referenceAnchors,
    liveAnchors,
    anchorAlignment,
    isGloballyLocked,
    countdownActive,
    countdownSecondsRemaining,
    statusText,
    sidecarOffline,
    pollingStopped,
  } = store;

  // Refs so the polling loop always sees current state without re-subscribing
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollBusy = useRef(false);
  const failureCount = useRef(0);
  const countdownProgress = useRef(new Animated.Value(0)).current;
  const countdownTickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownDoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (permission && !permission.granted) requestPermission();
  }, [permission, requestPermission]);

  // ---------------------------------------------------------------------
  // Step 1 — Reference photo & anchor extraction
  // ---------------------------------------------------------------------
  const loadReferencePhoto = useCallback(async () => {
    setReferenceError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const uri = result.assets[0].uri;
    setLoadingReference(true);
    const landmarks = await fetchLandmarks(uri);
    setLoadingReference(false);

    if (!landmarks.ok) {
      if (landmarks.reason === 'no_body') {
        setReferenceError(
          'No body detected in photo. Try a clear full-body photo in good light.',
        );
      } else {
        setReferenceError(
          'Could not reach the pose service. Make sure the sidecar is running, then retry.',
        );
      }
      return;
    }

    const anchors = extractAnchors(landmarks.landmarks);
    if (!anchors) {
      setReferenceError(
        'No body detected in photo. Try a clear full-body photo in good light.',
      );
      return;
    }

    useCaptureStore.getState().setReference(anchors, uri);
  }, []);

  // ---------------------------------------------------------------------
  // Step 3 — Real-time alignment polling (800ms)
  // ---------------------------------------------------------------------
  const pollOnce = useCallback(async () => {
    const s = useCaptureStore.getState();
    if (!s.referenceAnchors || s.sidecarOffline || s.pollingStopped) return;
    if (pollBusy.current || !cameraRef.current) return;

    pollBusy.current = true;
    try {
      // Low-quality frame for detection only; the saved photo is quality 1.0
      const frame = await cameraRef.current.takePictureAsync({
        quality: 0.3,
        skipProcessing: true,
      });
      if (!frame?.uri) return;

      const result = await fetchLandmarks(frame.uri);

      if (!result.ok && result.reason === 'unreachable') {
        failureCount.current += 1;
        if (failureCount.current >= MAX_CONSECUTIVE_FAILURES) {
          // Silently stop polling; user can tap to resume
          useCaptureStore.getState().setPollingStopped(true);
        }
        return;
      }
      failureCount.current = 0;

      if (!result.ok) {
        // no_body: rings stay white, just wait
        useCaptureStore
          .getState()
          .setLiveResult(null, scoreAlignment(null, s.referenceAnchors), false, STATUS.MOVE_INTO_FRAME);
        return;
      }

      const live = extractAnchors(result.landmarks);
      const alignment = scoreAlignment(live, s.referenceAnchors);
      const locked = checkGlobalLock(alignment);

      // During countdown the overlay stays frozen green; we only use poll
      // results to detect a broken lock (any anchor drifting past "close").
      if (useCaptureStore.getState().countdownActive) {
        if (!locked && !isPartiallyAligned(alignment)) cancelCountdown(false);
        else if (Object.values(alignment).some((a) => a === 'misaligned')) cancelCountdown(false);
        return;
      }

      const status = locked
        ? STATUS.HOLD
        : isPartiallyAligned(alignment)
          ? STATUS.ALMOST
          : STATUS.MISALIGNED;

      useCaptureStore.getState().setLiveResult(live, alignment, locked, status);

      if (locked) startCountdown();
    } catch {
      failureCount.current += 1;
      if (failureCount.current >= MAX_CONSECUTIVE_FAILURES) {
        useCaptureStore.getState().setPollingStopped(true);
      }
    } finally {
      pollBusy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling loop — setTimeout chain so requests never overlap
  useEffect(() => {
    const shouldPoll =
      !!referenceAnchors && !sidecarOffline && !pollingStopped && !capturedUri;
    useCaptureStore.getState().setPolling(shouldPoll);
    if (!shouldPoll) return;

    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      await pollOnce();
      if (cancelled) return;
      pollTimer.current = setTimeout(loop, POLL_INTERVAL_MS);
    };
    loop();

    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [referenceAnchors, sidecarOffline, pollingStopped, capturedUri, pollOnce]);

  // ---------------------------------------------------------------------
  // Step 5 — Auto-capture countdown
  // ---------------------------------------------------------------------
  const clearCountdownTimers = () => {
    if (countdownTickTimer.current) clearInterval(countdownTickTimer.current);
    if (countdownDoneTimer.current) clearTimeout(countdownDoneTimer.current);
    countdownTickTimer.current = null;
    countdownDoneTimer.current = null;
  };

  const startCountdown = () => {
    if (useCaptureStore.getState().countdownActive) return;

    // Single haptic when global lock is first achieved
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    useCaptureStore.getState().startCountdown();

    countdownProgress.setValue(0);
    Animated.timing(countdownProgress, {
      toValue: 1,
      duration: COUNTDOWN_MS,
      useNativeDriver: true,
    }).start();

    let remaining = 3;
    countdownTickTimer.current = setInterval(() => {
      remaining -= 1;
      if (remaining >= 1) {
        useCaptureStore.getState().tickCountdown(remaining);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }, 1000);

    countdownDoneTimer.current = setTimeout(captureFinal, COUNTDOWN_MS);
  };

  /** Silent reset — no haptic; cancellation shouldn't feel punishing. */
  const cancelCountdown = (_manual: boolean) => {
    clearCountdownTimers();
    countdownProgress.stopAnimation();
    countdownProgress.setValue(0);
    useCaptureStore.getState().cancelCountdown();
  };

  const captureFinal = async () => {
    clearCountdownTimers();
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const photo = await cameraRef.current?.takePictureAsync({ quality: 1.0 });
      if (photo?.uri) {
        // Stub for the confirm screen — real navigation comes later
        setCapturedUri(photo.uri);
      }
      useCaptureStore.getState().cancelCountdown();
    } catch {
      cancelCountdown(false);
    }
  };

  useEffect(() => clearCountdownTimers, []);

  const resumePolling = () => {
    failureCount.current = 0;
    useCaptureStore.getState().setPollingStopped(false);
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  if (!permission?.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.dimText}>Camera permission required</Text>
        <Pressable style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Grant access</Text>
        </Pressable>
      </View>
    );
  }

  // No reference yet → single centered button
  if (!referenceAnchors) {
    return (
      <View style={styles.centered}>
        {loadingReference ? (
          <ActivityIndicator size="large" color="#22c55e" />
        ) : (
          <>
            {referenceError && <Text style={styles.errorText}>{referenceError}</Text>}
            <Pressable style={styles.primaryButton} onPress={loadReferencePhoto}>
              <Text style={styles.primaryButtonText}>
                {referenceError ? 'Retry' : 'Load reference photo'}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  // Confirm-screen stub after capture
  if (capturedUri) {
    return (
      <View style={styles.centered}>
        <Image source={{ uri: capturedUri }} style={styles.capturedPreview} />
        <Pressable style={styles.primaryButton} onPress={() => setCapturedUri(null)}>
          <Text style={styles.primaryButtonText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="front"
      />

      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
        onLayout={(e) => setOverlaySize(e.nativeEvent.layout)}
      >
        <GhostOverlay
          referenceAnchors={referenceAnchors}
          liveAnchors={liveAnchors}
          alignment={anchorAlignment}
          isGloballyLocked={isGloballyLocked || countdownActive}
          width={overlaySize.width}
          height={overlaySize.height}
        />

        {countdownActive && (
          <CountdownRing
            progress={countdownProgress}
            secondsRemaining={countdownSecondsRemaining}
            onCancel={() => cancelCountdown(true)}
          />
        )}

        <AlignmentStatus
          statusText={sidecarOffline ? STATUS.OFFLINE : statusText}
          countdownActive={countdownActive}
          pollingStopped={pollingStopped}
          onResumePolling={resumePolling}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  centered: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  primaryButton: {
    backgroundColor: 'rgba(34,197,94,0.9)',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  dimText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    marginBottom: 16,
  },
  capturedPreview: {
    width: '80%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    marginBottom: 24,
  },
});
