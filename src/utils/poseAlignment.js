import { getPoseConfig, inferPoseTypeFromName, JOINTS } from '../constants/poseAlignment';

export const JOINT_STATUS = {
  hidden: 'hidden',
  idle: 'idle',
  close: 'close',
  locked: 'locked',
  off: 'off',
};

export function getPoseTypeForPose(pose) {
  return inferPoseTypeFromName(pose?.name) || pose?.pose_type || 'front_relaxed';
}

export function createReferenceKeypoints({ pose, width = 1080, height = 1440, existingKeypoints = null }) {
  if (existingKeypoints) return existingKeypoints;

  const poseType = getPoseTypeForPose(pose);
  const config = getPoseConfig(poseType);

  return JOINTS.reduce((acc, joint) => {
    const point = config.template[joint];
    if (!point) return acc;
    acc[joint] = {
      x: point.x,
      y: point.y,
      px: point.x * width,
      py: point.y * height,
      confidence: 1,
    };
    return acc;
  }, {});
}

function getPoint(point, mirrorX = false) {
  if (!point) return null;

  return {
    x: mirrorX ? 1 - (point.x ?? 0) : (point.x ?? 0),
    y: point.y ?? 0,
    confidence: point.confidence ?? 0,
  };
}

function midpoint(a, b) {
  if (!a || !b) return null;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function distance2d(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

function rotatePoint(point, angle) {
  if (!point || !Number.isFinite(angle) || angle === 0) return point;

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function getBodyFrame(keypoints) {
  const leftShoulder = keypoints?.leftShoulder;
  const rightShoulder = keypoints?.rightShoulder;
  const leftHip = keypoints?.leftHip;
  const rightHip = keypoints?.rightHip;

  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const visiblePoints = JOINTS
    .map((joint) => keypoints?.[joint])
    .filter((point) => point && (point.confidence ?? 0) >= 0.2);

  const anchor = shoulderCenter && hipCenter
    ? midpoint(shoulderCenter, hipCenter)
    : shoulderCenter || hipCenter || midpoint(visiblePoints[0], visiblePoints[visiblePoints.length - 1]) || { x: 0.5, y: 0.5 };

  const scaleCandidates = [
    shoulderCenter && hipCenter ? distance2d(shoulderCenter, hipCenter) : null,
    leftShoulder && rightShoulder ? distance2d(leftShoulder, rightShoulder) : null,
    leftHip && rightHip ? distance2d(leftHip, rightHip) : null,
  ].filter((value) => Number.isFinite(value) && value > 0.0001);

  const scale = scaleCandidates.length > 0
    ? Math.max(...scaleCandidates)
    : 1;

  let rotation = 0;
  if (shoulderCenter && hipCenter) {
    const torsoAngle = Math.atan2(shoulderCenter.y - hipCenter.y, shoulderCenter.x - hipCenter.x);
    rotation = (-Math.PI / 2) - torsoAngle;
  } else if (leftShoulder && rightShoulder) {
    rotation = -Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x);
  } else if (leftHip && rightHip) {
    rotation = -Math.atan2(rightHip.y - leftHip.y, rightHip.x - leftHip.x);
  }

  return { anchor, scale: scale || 1, rotation };
}

export function normalizeKeypoints(keypoints, { mirrorX = false, rotateToUpright = true } = {}) {
  if (!keypoints) return null;

  const prepared = JOINTS.reduce((acc, joint) => {
    const point = getPoint(keypoints[joint], mirrorX);
    if (point) {
      acc[joint] = point;
    }
    return acc;
  }, {});

  const frame = getBodyFrame(prepared);

  return JOINTS.reduce((acc, joint) => {
    const point = prepared[joint];
    if (!point) return acc;

    const relative = {
      x: point.x - frame.anchor.x,
      y: point.y - frame.anchor.y,
    };
    const rotated = rotateToUpright ? rotatePoint(relative, frame.rotation) : relative;

    acc[joint] = {
      ...point,
      x: rotated.x / frame.scale,
      y: rotated.y / frame.scale,
    };
    return acc;
  }, {});
}

export function smoothSkeleton(nextSkeleton, previousSkeleton, alpha = 0.32) {
  if (!nextSkeleton) return previousSkeleton;
  if (!previousSkeleton) return nextSkeleton;

  return Object.keys(nextSkeleton).reduce((acc, joint) => {
    const nextPoint = nextSkeleton[joint];
    const previousPoint = previousSkeleton[joint];

    if (!previousPoint) {
      acc[joint] = nextPoint;
      return acc;
    }

    acc[joint] = {
      ...nextPoint,
      x: previousPoint.x + ((nextPoint.x ?? previousPoint.x) - previousPoint.x) * alpha,
      y: previousPoint.y + ((nextPoint.y ?? previousPoint.y) - previousPoint.y) * alpha,
      px: previousPoint.px + ((nextPoint.px ?? previousPoint.px) - previousPoint.px) * alpha,
      py: previousPoint.py + ((nextPoint.py ?? previousPoint.py) - previousPoint.py) * alpha,
      confidence: Math.max(nextPoint.confidence ?? 0, previousPoint.confidence ?? 0),
    };
    return acc;
  }, {});
}

export function evaluateAlignment({
  poseType,
  referenceKeypoints,
  liveKeypoints,
  previousState = {},
  now = Date.now(),
  confidenceThreshold = 0.6,
  mirrorLiveX = false,
  rotateToUpright = true,
}) {
  const config = getPoseConfig(poseType);
  const normalizedReference = normalizeKeypoints(referenceKeypoints, { mirrorX: false, rotateToUpright });
  const normalizedLive = normalizeKeypoints(liveKeypoints, { mirrorX: mirrorLiveX, rotateToUpright });
  const nextState = {};
  let alignedCount = 0;
  let visibleCount = 0;

  JOINTS.forEach((joint) => {
    const reference = normalizedReference?.[joint];
    const live = normalizedLive?.[joint];
    const previous = previousState[joint] || {};
    const tolerance = (config.tolerances[joint] ?? 0.06) * 1.35;

    if (!reference || !live || (live.confidence ?? 0) < confidenceThreshold) {
      nextState[joint] = {
        status: JOINT_STATUS.idle,
        enteredAt: null,
        distance: null,
      };
      return;
    }

    visibleCount += 1;

    const currentDistance = distance2d(reference, live);
    const isClose = currentDistance <= tolerance;

    if (!isClose) {
      nextState[joint] = {
        status: currentDistance > tolerance * 1.6 ? JOINT_STATUS.off : JOINT_STATUS.idle,
        enteredAt: null,
        distance: currentDistance,
      };
      return;
    }

    const enteredAt = previous.enteredAt ?? now;
    const heldForMs = now - enteredAt;
    const status = heldForMs >= config.holdTimeMs ? JOINT_STATUS.locked : JOINT_STATUS.close;

    if (status === JOINT_STATUS.locked) {
      alignedCount += 1;
    }

    nextState[joint] = {
      status,
      enteredAt,
      distance: currentDistance,
      heldForMs,
    };
  });

  const requiredKeyJointCount = Math.max(1, Math.ceil(config.keyJoints.length * config.requiredJointsAligned));
  const requiredVisibleKeyJointCount = Math.max(4, Math.ceil(config.keyJoints.length * 0.6));
  const lockedKeyJointCount = config.keyJoints.filter(
    (joint) => nextState[joint]?.status === JOINT_STATUS.locked
  ).length;

  const symmetry = getSymmetryScore({
    symmetryPairs: config.symmetryPairs,
    liveKeypoints: normalizedLive,
  });

  return {
    joints: nextState,
    alignedCount,
    visibleCount,
    lockedKeyJointCount,
    requiredKeyJointCount,
    requiredVisibleKeyJointCount,
    hasEnoughVisibleJoints: visibleCount >= requiredVisibleKeyJointCount,
    isPoseAligned: visibleCount >= requiredVisibleKeyJointCount && lockedKeyJointCount >= requiredKeyJointCount,
    trackingState: visibleCount < requiredVisibleKeyJointCount ? 'move_into_frame' : lockedKeyJointCount >= requiredKeyJointCount ? 'aligned' : 'not_aligned',
    progress: config.keyJoints.length === 0 ? 0 : lockedKeyJointCount / config.keyJoints.length,
    symmetry,
  };
}

export function getSymmetryScore({ symmetryPairs = [], liveKeypoints }) {
  if (!symmetryPairs.length || !liveKeypoints) {
    return { score: null, insights: [] };
  }

  const deviations = [];
  const insights = [];

  symmetryPairs.forEach(([leftJoint, rightJoint]) => {
    const left = liveKeypoints[leftJoint];
    const right = liveKeypoints[rightJoint];
    if (!left || !right) return;

    const verticalDelta = Math.abs((left.y ?? 0) - (right.y ?? 0));
    deviations.push(verticalDelta);

    if (verticalDelta > 0.04) {
      const raisedJoint = left.y < right.y ? 'Left' : 'Right';
      const jointName = leftJoint.replace('left', '').replace('right', '');
      insights.push(`${raisedJoint} ${jointName.toLowerCase()} is higher than the other side`);
    }
  });

  if (!deviations.length) {
    return { score: null, insights: [] };
  }

  const averageDeviation = deviations.reduce((sum, value) => sum + value, 0) / deviations.length;
  const score = Math.max(0, 1 - averageDeviation / 0.08);

  return {
    score,
    insights: insights.slice(0, 2),
  };
}

export function createSimulatedLiveSkeleton(referenceKeypoints, timeMs) {
  if (!referenceKeypoints) return null;

  const phase = timeMs / 800;

  return Object.entries(referenceKeypoints).reduce((acc, [joint, point]) => {
    const sideDirection = joint.startsWith('left') ? -1 : joint.startsWith('right') ? 1 : 0;
    const verticalBias = joint.includes('Wrist') || joint.includes('Elbow') ? 1 : 0.4;
    const offsetX = Math.sin(phase + sideDirection) * 0.02 * (sideDirection || 1);
    const offsetY = Math.cos(phase * 0.8 + verticalBias) * 0.014 * verticalBias;
    const settle = 0.016 * Math.sin(phase * 0.35);

    acc[joint] = {
      ...point,
      x: point.x + offsetX - settle * sideDirection,
      y: point.y + offsetY,
      px: point.px,
      py: point.py,
      confidence: 0.96,
    };
    return acc;
  }, {});
}
