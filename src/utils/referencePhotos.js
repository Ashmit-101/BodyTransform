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
import { createReferenceKeypoints, getPoseTypeForPose } from './poseAlignment';
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

export async function saveReferencePhotoForPose(pose, savedPhoto) {
  const backgroundRemoval = await generateGhostAssetForPhoto(savedPhoto);
  const poseType = getPoseTypeForPose(pose);
  await setPoseReferencePhoto(pose.id, savedPhoto.id);
  await setPoseType(pose.id, poseType);

  // Extract skeleton keypoints from the reference photo
  let referenceKeypoints = null;
  let detectionWarning = null;
  let keypointSource = null;

  try {
    const detectorStatus = await getPoseDetectorStatus();
    if (detectorStatus.supportsStaticImageDetection) {
      const detectedKeypoints = await detectPoseInImage(
        savedPhoto.file_path,
        savedPhoto.width,
        savedPhoto.height
      );

      if (detectedKeypoints && validateExtractedKeypoints(detectedKeypoints)) {
        referenceKeypoints = detectedKeypoints;
        keypointSource = 'detected';
      } else {
        detectionWarning = 'Could not read the pose clearly. BodyTransform saved a fallback skeleton, but this reference should be replaced with a cleaner bodybuilding pose.';
      }
    } else {
      detectionWarning = 'Native pose detection is not installed in this build, so BodyTransform saved a fallback skeleton. Replace it with a clearer bodybuilding reference photo when you can.';
    }
  } catch (err) {
    console.warn('Pose detection failed:', err);
    detectionWarning = 'Pose detection hit an error, so BodyTransform saved a fallback skeleton. Replace it with a clearer bodybuilding reference photo when you can.';
  }

  if (!referenceKeypoints) {
    referenceKeypoints = createReferenceKeypoints({
      pose,
      width: savedPhoto.width,
      height: savedPhoto.height,
    });
    keypointSource = 'template';
  }

  if (referenceKeypoints) {
    await savePoseReferenceKeypoints(pose.id, referenceKeypoints, keypointSource);
  }

  const finalPhoto = await getPhotoById(savedPhoto.id);

  return {
    status: 'success',
    photo: finalPhoto || savedPhoto,
    warning: detectionWarning || backgroundRemoval.warning,
    poseType,
    referenceKeypoints,
    referenceSource: keypointSource,
  };
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

  return saveReferencePhotoForPose(pose, savedPhoto);
}
