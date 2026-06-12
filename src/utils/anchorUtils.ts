/**
 * anchorUtils — landmark extraction, alignment scoring, coordinate mapping.
 *
 * All anchor coordinates stay normalized (0–1) until render time.
 */

export type Point = { x: number; y: number };

export type AnchorKey =
  | 'nose'
  | 'left_shoulder'
  | 'right_shoulder'
  | 'shoulder_mid'
  | 'hip_mid';

export type Anchors = Record<AnchorKey, Point>;

export type AnchorAlignment = 'locked' | 'close' | 'misaligned';

export type Landmark = { x: number; y: number; z: number; visibility: number };

// MediaPipe pose landmark indices
export const LANDMARK_INDEX = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

// Alignment thresholds (normalized Euclidean distance)
export const ALIGNED_THRESHOLD = 0.04;
export const CLOSE_THRESHOLD = 0.08;

export const ANCHOR_KEYS: AnchorKey[] = [
  'nose',
  'left_shoulder',
  'right_shoulder',
  'shoulder_mid',
  'hip_mid',
];

/**
 * Extract the 5 anchor points from a 33-landmark MediaPipe array.
 * Returns null if the array is missing or too short (no body detected).
 */
export function extractAnchors(landmarks: Landmark[] | null | undefined): Anchors | null {
  if (!landmarks || landmarks.length < 25) return null;

  const nose = landmarks[LANDMARK_INDEX.NOSE];
  const ls = landmarks[LANDMARK_INDEX.LEFT_SHOULDER];
  const rs = landmarks[LANDMARK_INDEX.RIGHT_SHOULDER];
  const lh = landmarks[LANDMARK_INDEX.LEFT_HIP];
  const rh = landmarks[LANDMARK_INDEX.RIGHT_HIP];

  if (!nose || !ls || !rs || !lh || !rh) return null;

  return {
    nose: { x: nose.x, y: nose.y },
    left_shoulder: { x: ls.x, y: ls.y },
    right_shoulder: { x: rs.x, y: rs.y },
    shoulder_mid: { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 },
    hip_mid: { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 },
  };
}

/** Euclidean distance between two normalized points. */
export function anchorDistance(a: Point, b: Point): number {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

/** Classify a single anchor's alignment state. */
export function classifyAnchor(live: Point, ref: Point): AnchorAlignment {
  const dist = anchorDistance(live, ref);
  if (dist < ALIGNED_THRESHOLD) return 'locked';
  if (dist < CLOSE_THRESHOLD) return 'close';
  return 'misaligned';
}

/** Score all 5 anchors. Missing live anchors are misaligned. */
export function scoreAlignment(
  live: Anchors | null,
  ref: Anchors,
): Record<AnchorKey, AnchorAlignment> {
  const result = {} as Record<AnchorKey, AnchorAlignment>;
  for (const key of ANCHOR_KEYS) {
    result[key] = live ? classifyAnchor(live[key], ref[key]) : 'misaligned';
  }
  return result;
}

/** True when every anchor is individually locked. */
export function isGloballyLocked(
  alignment: Record<AnchorKey, AnchorAlignment>,
): boolean {
  return ANCHOR_KEYS.every((key) => alignment[key] === 'locked');
}

/** True when at least one anchor is locked/close but not all locked. */
export function isPartiallyAligned(
  alignment: Record<AnchorKey, AnchorAlignment>,
): boolean {
  return ANCHOR_KEYS.some(
    (key) => alignment[key] === 'locked' || alignment[key] === 'close',
  );
}

/** Convert normalized coords to screen pixels at render time. */
export function toScreen(norm: Point, screenW: number, screenH: number): Point {
  return { x: norm.x * screenW, y: norm.y * screenH };
}
