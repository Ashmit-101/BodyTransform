import * as ImagePicker from 'expo-image-picker';

import { saveImageToAppDir } from './storage';
import {
  savePoseReferenceKeypoints,
  getPhotoById,
  savePhoto,
  setPoseReferencePhoto,
  setPoseType,
} from '../database/db';
import { generateGhostAssetForPhoto } from './backgroundRemoval';
import { getPoseTypeForPose } from './poseAlignment';
import {
  detectPoseInImage,
  getPoseDetectorStatus,
  validateExtractedKeypoints,
} from './poseDetection';

function parseExifDate(exifDate) {
  if (!exifDate || typeof exifDate !== 'string') return null;
  const parts = exifDate.split(' ');
  if (parts.length < 2) return null;
  return `${parts[0].replace(/:/g, '-')} ${parts[1]}`;
}

export async function importReferencePhotoForPose(pose) {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    return { status: 'permission_denied' };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
    exif: true,
  });

  if (result.canceled || result.assets.length === 0) {
    return { status: 'cancelled' };
  }

  const asset = result.assets[0];
  const saved = await saveImageToAppDir(asset.uri, pose.id);
  const capturedAt = parseExifDate(asset.exif?.DateTimeOriginal) || null;
  const photoId = await savePhoto(
    pose.id,
    saved.filePath,
    saved.width,
    saved.height,
    capturedAt
  );

  const savedPhoto = {
    id: photoId,
    pose_id: pose.id,
    file_path: saved.filePath,
    captured_at: capturedAt || new Date().toISOString(),
    width: saved.width,
    height: saved.height,
  };

  const backgroundRemoval = await generateGhostAssetForPhoto(savedPhoto);

  const poseType = getPoseTypeForPose(pose);
  await setPoseReferencePhoto(pose.id, photoId);
  await setPoseType(pose.id, poseType);

  // Extract skeleton keypoints from the reference photo
  let referenceKeypoints = null;
  let detectionWarning = null;
  let detectionUnavailable = false;

  try {
    const detectorStatus = await getPoseDetectorStatus();
    if (!detectorStatus.supportsStaticImageDetection) {
      detectionUnavailable = true;
      detectionWarning = 'Reference pose extraction is not installed in this build yet.';
    }

    if (!detectionUnavailable) {
      const detectedKeypoints = await detectPoseInImage(
        saved.filePath,
        saved.width,
        saved.height
      );

      if (detectedKeypoints && validateExtractedKeypoints(detectedKeypoints)) {
        await savePoseReferenceKeypoints(pose.id, detectedKeypoints, 'detected');
        referenceKeypoints = detectedKeypoints;
      } else {
        detectionWarning = 'Could not detect pose clearly. Please upload a clearer reference photo.';
      }
    }
  } catch (err) {
    console.warn('Pose detection failed:', err);
    detectionWarning = 'Pose detection encountered an error while reading the reference photo.';
  }

  const finalPhoto = await getPhotoById(photoId);

  return {
    status: 'success',
    photo: finalPhoto || savedPhoto,
    warning: detectionWarning || backgroundRemoval.warning,
    poseType,
    referenceKeypoints,
  };
}
