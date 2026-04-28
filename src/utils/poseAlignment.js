import { getPoseConfig, inferPoseTypeFromName, JOINTS } from '../constants/poseAlignment';

export const JOINT_STATUS = {
  hidden: 'hidden',
  idle: 'idle',
  close: 'close',
  locked: 'locked',
  off: 'off',
};

export function getPoseTypeForPose(pose) {
  return pose?.pose_type || inferPoseTypeFromName(pose?.name);
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

function distance(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

export function evaluateAlignment({
  poseType,
  referenceKeypoints,
  liveKeypoints,
  previousState = {},
  now = Date.now(),
  confidenceThreshold = 0.7,
}) {
  const config = getPoseConfig(poseType);
  const nextState = {};
  let alignedCount = 0;
  let visibleCount = 0;

  JOINTS.forEach((joint) => {
    const reference = referenceKeypoints?.[joint];
    const live = liveKeypoints?.[joint];
    const previous = previousState[joint] || {};
    const tolerance = config.tolerances[joint] ?? 0.06;

    if (!reference || !live || (live.confidence ?? 0) < confidenceThreshold) {
      nextState[joint] = {
        status: JOINT_STATUS.idle,
        enteredAt: null,
        distance: null,
      };
      return;
    }

    visibleCount += 1;

    const currentDistance = distance(reference, live);
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
  const lockedKeyJointCount = config.keyJoints.filter(
    (joint) => nextState[joint]?.status === JOINT_STATUS.locked
  ).length;

  const symmetry = getSymmetryScore({
    symmetryPairs: config.symmetryPairs,
    liveKeypoints,
  });

  return {
    joints: nextState,
    alignedCount,
    visibleCount,
    lockedKeyJointCount,
    requiredKeyJointCount,
    isPoseAligned: lockedKeyJointCount >= requiredKeyJointCount,
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

