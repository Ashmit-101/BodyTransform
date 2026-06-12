/**
 * sidecarClient — wrapper around the local FastAPI pose sidecar.
 *
 * POST /landmarks-only  (multipart `file`) → 33 MediaPipe landmarks.
 */

import type { Landmark } from './anchorUtils';

// NOTE: `localhost` only works in the iOS simulator. On a physical device,
// replace with your Mac's LAN IP (e.g. 'http://192.168.1.x:8000').
const SIDECAR_BASE_URL = 'http://localhost:8000';
const REQUEST_TIMEOUT_MS = 3000;

export type SidecarResponse = {
  pose?: { category: string; confidence: number };
  landmarks?: Landmark[];
};

export type LandmarkResult =
  | { ok: true; landmarks: Landmark[] }
  | { ok: false; reason: 'no_body' | 'unreachable' };

/**
 * Send an image to the sidecar and get back raw landmarks.
 * - `no_body`: sidecar responded but found no landmarks
 * - `unreachable`: network error, timeout, or non-2xx response
 */
export async function fetchLandmarks(imageUri: string): Promise<LandmarkResult> {
  const formData = new FormData();
  // React Native FormData file part
  formData.append('file', {
    uri: imageUri,
    name: 'frame.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SIDECAR_BASE_URL}/landmarks-only`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: 'unreachable' };
    }

    const json = (await response.json()) as SidecarResponse;

    if (!json.landmarks || json.landmarks.length === 0) {
      return { ok: false, reason: 'no_body' };
    }

    return { ok: true, landmarks: json.landmarks };
  } catch {
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}
