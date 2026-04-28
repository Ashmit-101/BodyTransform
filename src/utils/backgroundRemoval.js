import { updatePhotoGhostFile } from '../database/db';

export async function generateGhostAssetForPhoto(photo) {
  try {
    await updatePhotoGhostFile(photo.id, null);
    return {
      ghostFilePath: null,
      warning: null,
    };
  } catch (err) {
    console.error('Failed to clear ghost photo reference:', err);
    await updatePhotoGhostFile(photo.id, null);
    return {
      ghostFilePath: null,
      warning: null,
    };
  }
}
