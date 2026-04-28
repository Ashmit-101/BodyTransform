/**
 * BodyTransform — SQLite Database Layer
 * 
 * Uses expo-sqlite (synchronous API) for metadata storage.
 * Photos are stored on the file system; this DB tracks metadata.
 */

import * as SQLite from 'expo-sqlite';

let db = null;

/**
 * Open (or create) the database and run migrations.
 */
export async function initDatabase() {
  db = await SQLite.openDatabaseAsync('bodytransform.db');

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS poses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      icon TEXT DEFAULT '💪',
      reference_photo_id INTEGER,
      pose_type TEXT,
      reference_keypoints_json TEXT,
      reference_keypoints_source TEXT,
      reference_keypoints_updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pose_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      ghost_file_path TEXT,
      background_removed_at TEXT,
      captured_at TEXT DEFAULT (datetime('now')),
      notes TEXT DEFAULT '',
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      FOREIGN KEY (pose_id) REFERENCES poses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_photos_pose ON photos(pose_id, captured_at DESC);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );
  `);

  const poseColumns = await db.getAllAsync(`PRAGMA table_info(poses)`);
  const hasReferenceColumn = poseColumns.some((column) => column.name === 'reference_photo_id');
  const hasPoseTypeColumn = poseColumns.some((column) => column.name === 'pose_type');
  const hasReferenceKeypointsColumn = poseColumns.some((column) => column.name === 'reference_keypoints_json');
  const hasReferenceKeypointsSourceColumn = poseColumns.some((column) => column.name === 'reference_keypoints_source');
  const hasReferenceKeypointsUpdatedAtColumn = poseColumns.some((column) => column.name === 'reference_keypoints_updated_at');
  if (!hasReferenceColumn) {
    await db.execAsync('ALTER TABLE poses ADD COLUMN reference_photo_id INTEGER');
  }
  if (!hasPoseTypeColumn) {
    await db.execAsync('ALTER TABLE poses ADD COLUMN pose_type TEXT');
  }
  if (!hasReferenceKeypointsColumn) {
    await db.execAsync('ALTER TABLE poses ADD COLUMN reference_keypoints_json TEXT');
  }
  if (!hasReferenceKeypointsSourceColumn) {
    await db.execAsync('ALTER TABLE poses ADD COLUMN reference_keypoints_source TEXT');
  }
  if (!hasReferenceKeypointsUpdatedAtColumn) {
    await db.execAsync('ALTER TABLE poses ADD COLUMN reference_keypoints_updated_at TEXT');
  }

  const photoColumns = await db.getAllAsync(`PRAGMA table_info(photos)`);
  const hasGhostFileColumn = photoColumns.some((column) => column.name === 'ghost_file_path');
  const hasBackgroundRemovedAtColumn = photoColumns.some((column) => column.name === 'background_removed_at');

  if (!hasGhostFileColumn) {
    await db.execAsync('ALTER TABLE photos ADD COLUMN ghost_file_path TEXT');
  }
  if (!hasBackgroundRemovedAtColumn) {
    await db.execAsync('ALTER TABLE photos ADD COLUMN background_removed_at TEXT');
  }

  // Seed default poses if table is empty
  const count = await db.getFirstAsync('SELECT COUNT(*) as count FROM poses');
  if (count.count === 0) {
    const defaultPoses = [
      { name: 'Front Relaxed', icon: '🧍' },
      { name: 'Front Double Bicep', icon: '💪' },
      { name: 'Side Chest', icon: '🫁' },
      { name: 'Back Lat Spread', icon: '🦅' },
      { name: 'Back Double Bicep', icon: '💪' },
      { name: 'Most Muscular', icon: '🔥' },
    ];
    for (const pose of defaultPoses) {
      await db.runAsync(
        'INSERT INTO poses (name, icon) VALUES (?, ?)',
        [pose.name, pose.icon]
      );
    }
  }

  return db;
}

/**
 * Get the database instance (must call initDatabase first).
 */
export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ─── App Settings ────────────────────────────────────────

export async function getAppSetting(key, defaultValue = null) {
  const d = getDb();
  const result = await d.getFirstAsync(
    'SELECT value FROM app_settings WHERE key = ?',
    [key]
  );
  return result?.value ?? defaultValue;
}

export async function setAppSetting(key, value) {
  const d = getDb();
  await d.runAsync(
    `
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    [key, String(value)]
  );
}

export async function getBooleanAppSetting(key, defaultValue = false) {
  const value = await getAppSetting(key, null);
  if (value === null || value === undefined) return defaultValue;
  return value === 'true';
}

// ─── Poses CRUD ───────────────────────────────────────────

export async function getAllPoses() {
  const d = getDb();
  return await d.getAllAsync(`
    SELECT p.*, 
      COUNT(ph.id) as photo_count,
      MAX(ph.captured_at) as last_capture
    FROM poses p
    LEFT JOIN photos ph ON ph.pose_id = p.id
    GROUP BY p.id
    ORDER BY p.name ASC
  `);
}

export async function createPose(name, icon = '💪') {
  const d = getDb();
  const result = await d.runAsync(
    'INSERT INTO poses (name, icon) VALUES (?, ?)',
    [name, icon]
  );
  return result.lastInsertRowId;
}

export async function deletePose(id) {
  const d = getDb();
  await d.runAsync('DELETE FROM photos WHERE pose_id = ?', [id]);
  await d.runAsync('DELETE FROM poses WHERE id = ?', [id]);
}

export async function renamePose(id, newName) {
  const d = getDb();
  await d.runAsync('UPDATE poses SET name = ? WHERE id = ?', [newName, id]);
}

// ─── Photos CRUD ──────────────────────────────────────────

export async function savePhoto(
  poseId,
  filePath,
  width = 0,
  height = 0,
  capturedAt = null,
  ghostFilePath = null
) {
  const d = getDb();
  if (capturedAt) {
    const result = await d.runAsync(
      `
        INSERT INTO photos (pose_id, file_path, ghost_file_path, width, height, captured_at, background_removed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        poseId,
        filePath,
        ghostFilePath,
        width,
        height,
        capturedAt,
        ghostFilePath ? new Date().toISOString() : null,
      ]
    );
    return result.lastInsertRowId;
  }
  const result = await d.runAsync(
    `
      INSERT INTO photos (pose_id, file_path, ghost_file_path, width, height, background_removed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      poseId,
      filePath,
      ghostFilePath,
      width,
      height,
      ghostFilePath ? new Date().toISOString() : null,
    ]
  );
  return result.lastInsertRowId;
}

export async function updatePhotoGhostFile(photoId, ghostFilePath) {
  const d = getDb();
  await d.runAsync(
    'UPDATE photos SET ghost_file_path = ?, background_removed_at = ? WHERE id = ?',
    [ghostFilePath, ghostFilePath ? new Date().toISOString() : null, photoId]
  );
}

export async function getPhotosForPose(poseId) {
  const d = getDb();
  return await d.getAllAsync(
    'SELECT * FROM photos WHERE pose_id = ? ORDER BY captured_at DESC',
    [poseId]
  );
}

export async function getLatestPhotoForPose(poseId) {
  const d = getDb();
  return await d.getFirstAsync(
    'SELECT * FROM photos WHERE pose_id = ? ORDER BY captured_at DESC LIMIT 1',
    [poseId]
  );
}

export async function getPhotoById(photoId) {
  const d = getDb();
  return await d.getFirstAsync('SELECT * FROM photos WHERE id = ?', [photoId]);
}

export async function setPoseReferencePhoto(poseId, photoId) {
  const d = getDb();
  await d.runAsync(
    'UPDATE poses SET reference_photo_id = ? WHERE id = ?',
    [photoId, poseId]
  );
}

export async function clearPoseReferencePhoto(poseId) {
  const d = getDb();
  await d.runAsync('UPDATE poses SET reference_photo_id = NULL WHERE id = ?', [poseId]);
}

export async function setPoseType(poseId, poseType) {
  const d = getDb();
  await d.runAsync('UPDATE poses SET pose_type = ? WHERE id = ?', [poseType, poseId]);
}

export async function savePoseReferenceKeypoints(poseId, keypoints, source = 'detected') {
  const d = getDb();
  await d.runAsync(
    `
      UPDATE poses
      SET reference_keypoints_json = ?, reference_keypoints_source = ?, reference_keypoints_updated_at = ?
      WHERE id = ?
    `,
    [JSON.stringify(keypoints), source, new Date().toISOString(), poseId]
  );
}

export async function clearPoseReferenceKeypoints(poseId) {
  const d = getDb();
  await d.runAsync(
    `
      UPDATE poses
      SET reference_keypoints_json = NULL,
          reference_keypoints_source = NULL,
          reference_keypoints_updated_at = NULL
      WHERE id = ?
    `,
    [poseId]
  );
}

export async function getPoseReferenceData(poseId) {
  const d = getDb();
  const pose = await d.getFirstAsync(
    `
      SELECT reference_photo_id, pose_type, reference_keypoints_json, reference_keypoints_updated_at
           , reference_keypoints_source
      FROM poses
      WHERE id = ?
    `,
    [poseId]
  );

  if (!pose) return null;

  let keypoints = null;
  if (pose.reference_keypoints_json) {
    try {
      keypoints = JSON.parse(pose.reference_keypoints_json);
    } catch (err) {
      console.warn('Failed to parse reference keypoints JSON:', err);
    }
  }

  return {
    referencePhotoId: pose.reference_photo_id ?? null,
    poseType: pose.pose_type ?? null,
    keypoints,
    source: pose.reference_keypoints_source ?? null,
    updatedAt: pose.reference_keypoints_updated_at ?? null,
  };
}

export async function getPoseReferencePhotoId(poseId) {
  const d = getDb();
  const pose = await d.getFirstAsync(
    'SELECT reference_photo_id FROM poses WHERE id = ?',
    [poseId]
  );
  return pose?.reference_photo_id ?? null;
}

export async function getGhostPhotoForPose(poseId) {
  const poseReferencePhotoId = await getPoseReferencePhotoId(poseId);

  if (poseReferencePhotoId) {
    const referencePhoto = await getPhotoById(poseReferencePhotoId);
    if (referencePhoto) return referencePhoto;
  }

  return getLatestPhotoForPose(poseId);
}

export async function deletePhoto(id) {
  const d = getDb();
  const photo = await d.getFirstAsync(
    'SELECT file_path, ghost_file_path FROM photos WHERE id = ?',
    [id]
  );
  await d.runAsync(
    'UPDATE poses SET reference_photo_id = NULL WHERE reference_photo_id = ?',
    [id]
  );
  await d.runAsync('DELETE FROM photos WHERE id = ?', [id]);
  return photo || null;
}

export async function getPhotoCount() {
  const d = getDb();
  const result = await d.getFirstAsync('SELECT COUNT(*) as count FROM photos');
  return result.count;
}

/**
 * Get all dates that have photos, with counts.
 * Returns [{ date: 'YYYY-MM-DD', count: N }, ...]
 */
export async function getAllPhotoDates() {
  const d = getDb();
  return await d.getAllAsync(`
    SELECT date(captured_at) as date, COUNT(*) as count
    FROM photos
    GROUP BY date(captured_at)
    ORDER BY date DESC
  `);
}

/**
 * Get all photos for a specific date, joined with pose info.
 * @param {string} dateStr - Format: 'YYYY-MM-DD'
 */
export async function getPhotosForDate(dateStr) {
  const d = getDb();
  return await d.getAllAsync(`
    SELECT ph.*, p.name as pose_name, p.icon as pose_icon
    FROM photos ph
    JOIN poses p ON p.id = ph.pose_id
    WHERE date(ph.captured_at) = ?
    ORDER BY ph.captured_at DESC
  `, [dateStr]);
}
