/**
 * Pose Detection Utility for React Native/Expo
 *
 * Extracts skeleton keypoints from static images.
 * Uses native ML Kit pose detection when available.
 */

import { NativeModules, Platform } from 'react-native';

import { JOINTS } from '../constants/poseAlignment';

let detectorInstance = null;
let isInitializing = false;

function getNativePoseDetectionModule() {
  return NativeModules.PoseDetectionModule ?? null;
}

/**
 * Initialize the pose detector
 */
async function initializePoseDetector() {
  if (detectorInstance) {
    return detectorInstance;
  }

  if (isInitializing) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (detectorInstance) {
          clearInterval(checkInterval);
          resolve(detectorInstance);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
      }, 30000);
    });
  }

  isInitializing = true;

  try {
    const nativeModule = getNativePoseDetectionModule();

    detectorInstance = {
      ready: Boolean(nativeModule),
      type: nativeModule ? `ml-kit-native-${Platform.OS}` : 'unavailable',
      supportsStaticImageDetection: Boolean(nativeModule),
      detectPoseInImage: nativeModule?.detectPoseInImage?.bind(nativeModule),
      releaseDetector: nativeModule?.releaseDetector?.bind(nativeModule),
    };

    isInitializing = false;
    return detectorInstance;
  } catch (err) {
    isInitializing = false;
    console.error('Failed to initialize pose detector:', err);
    throw err;
  }
}

export async function getPoseDetectorStatus() {
  const detector = await initializePoseDetector();
  return {
    ready: Boolean(detector?.ready),
    type: detector?.type ?? 'unknown',
    supportsStaticImageDetection: Boolean(detector?.supportsStaticImageDetection),
  };
}

/**
 * Extract skeleton keypoints from a static image
 *
 * @param {string} imageUri - Local file path or data URI of the image
 * @param {number} expectedWidth - Expected width of image for normalization
 * @param {number} expectedHeight - Expected height of image for normalization
 * @returns {Object|null} Keypoints object with normalized and pixel coordinates
 */
export async function detectPoseInImage(imageUri, expectedWidth = 1080, expectedHeight = 1440) {
  try {
    const detector = await initializePoseDetector();

    if (!detector.ready) {
      console.warn('Native pose detector is not available in this build');
      return null;
    }

    if (!detector.supportsStaticImageDetection) {
      console.warn(
        'Pose detection is not implemented in this build. ' +
        'Install and wire a real detector before expecting skeleton extraction.'
      );
      return null;
    }

    const detectionResult = await detector.detectPoseInImage(imageUri);
    if (!detectionResult?.landmarks) {
      return null;
    }

    return parseDetectedPose(detectionResult.landmarks, expectedWidth, expectedHeight);
  } catch (err) {
    console.error('Failed to detect pose in image:', err);
    return null;
  }
}

/**
 * Parse detected pose from ML Kit format to app format.
 */
function parseDetectedPose(nativeLandmarks, imgWidth, imgHeight) {
  const result = {};

  JOINTS.forEach((jointName) => {
    const kp = nativeLandmarks?.[jointName];
    if (!kp) {
      result[jointName] = {
        x: 0,
        y: 0,
        px: 0,
        py: 0,
        confidence: 0,
      };
      return;
    }

    const px = Number(kp.x ?? 0);
    const py = Number(kp.y ?? 0);
    const x = imgWidth > 0 ? px / imgWidth : 0;
    const y = imgHeight > 0 ? py / imgHeight : 0;

    result[jointName] = {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      px,
      py,
      confidence: Number(kp.confidence ?? 0),
    };
  });

  return result;
}

/**
 * Cleanup detector resources
 */
export async function cleanupPoseDetector() {
  if (detectorInstance) {
    detectorInstance.releaseDetector?.();
    detectorInstance = null;
  }
}

/**
 * Validate extracted keypoints
 * Checks if enough joints were detected with sufficient confidence
 */
export function validateExtractedKeypoints(keypoints, minConfidenceThreshold = 0.5) {
  if (!keypoints) return false;

  const keypointValues = Object.values(keypoints);
  const validKeypoints = keypointValues.filter((kp) => (kp.confidence ?? 0) > minConfidenceThreshold);
  const validRatio = validKeypoints.length / keypointValues.length;

  // Need at least 70% of joints detected with confidence
  return validRatio >= 0.7;
}
