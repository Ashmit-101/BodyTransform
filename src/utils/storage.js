/**
 * BodyTransform — File System Utilities
 *
 * Handles saving/loading/deleting photos on disk.
 * Photos are stored in the app's document directory under a /photos subfolder.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

const photosDirectory = new Directory(Paths.document, 'photos');

/**
 * Ensure the photos directory exists.
 */
export async function ensurePhotosDir() {
  if (!photosDirectory.exists) {
    photosDirectory.create({ idempotent: true, intermediates: true });
  }
}

/**
 * Save a captured photo to the app's document directory.
 * Resizes to max 1080px wide for storage efficiency while maintaining quality.
 * 
 * @param {string} uri - The temporary URI from the camera capture.
 * @param {number} poseId - The pose category ID (used in filename for organization).
 * @returns {{ filePath: string, width: number, height: number }}
 */
export async function saveImageToAppDir(uri, poseId) {
  await ensurePhotosDir();

  // Resize for storage efficiency — max 1080px wide, maintain aspect ratio
  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1080 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
  );

  const timestamp = Date.now();
  const filename = `pose_${poseId}_${timestamp}.jpg`;
  const sourceFile = new File(manipulated.uri);
  const destFile = new File(photosDirectory, filename);

  if (destFile.exists) {
    destFile.delete();
  }

  sourceFile.move(destFile);

  return {
    filePath: destFile.uri,
    width: manipulated.width,
    height: manipulated.height,
  };
}

export async function saveDerivedImageToAppDir(uri, poseId, suffix = 'ghost', extension = 'png') {
  await ensurePhotosDir();

  const timestamp = Date.now();
  const filename = `pose_${poseId}_${timestamp}_${suffix}.${extension}`;
  const sourceFile = new File(uri);
  const destFile = new File(photosDirectory, filename);

  if (destFile.exists) {
    destFile.delete();
  }

  sourceFile.copy(destFile);

  return {
    filePath: destFile.uri,
  };
}

/**
 * Delete a photo from disk.
 * @param {string} filePath - Full path to the photo file.
 */
export async function deleteImage(filePath) {
  const file = new File(filePath);
  if (file.exists) {
    file.delete();
  }
}

/**
 * Get the URI for displaying a stored photo.
 * @param {string} filePath - The stored file path.
 * @returns {string}
 */
export function getImageUri(filePath) {
  return filePath; // expo-file-system paths are usable as URIs directly
}

/**
 * Get total storage used by photos in bytes.
 */
export async function getStorageUsed() {
  await ensurePhotosDir();
  let total = 0;
  for (const entry of photosDirectory.list()) {
    if (entry instanceof File && entry.exists && entry.size) {
      total += entry.size;
    }
  }
  return total;
}

/**
 * Format bytes into human-readable string.
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
