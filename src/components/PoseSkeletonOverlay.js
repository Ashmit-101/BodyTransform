import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { colors } from '../theme/theme';
import { JOINT_STATUS } from '../utils/poseAlignment';
import { JOINTS, SKELETON_CONNECTIONS } from '../constants/poseAlignment';

function getJointColor(status, isReference = false) {
  if (isReference) return 'rgba(187, 201, 214, 0.34)';

  switch (status) {
    case JOINT_STATUS.locked:
      return colors.success;
    case JOINT_STATUS.close:
      return colors.warning;
    case JOINT_STATUS.off:
      return colors.danger;
    case JOINT_STATUS.idle:
    default:
      return 'rgba(255, 255, 255, 0.96)';
  }
}

function toPixels(point, layout) {
  if (!point || !layout.width || !layout.height) return null;
  return {
    x: point.x * layout.width,
    y: point.y * layout.height,
  };
}

function Line({ from, to, color, opacity = 1, thickness = 3, layout }) {
  const fromPx = toPixels(from, layout);
  const toPx = toPixels(to, layout);
  if (!fromPx || !toPx) return null;

  const dx = toPx.x - fromPx.x;
  const dy = toPx.y - fromPx.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = `${Math.atan2(dy, dx)}rad`;

  return (
    <View
      style={[
        styles.line,
        {
          left: (fromPx.x + toPx.x) / 2 - length / 2,
          top: (fromPx.y + toPx.y) / 2 - thickness / 2,
          width: length,
          backgroundColor: color,
          opacity,
          height: thickness,
          transform: [{ rotate: angle }],
        },
      ]}
    />
  );
}

function Joint({ point, color, size = 12, opacity = 1, layout }) {
  const pointPx = toPixels(point, layout);
  if (!pointPx) return null;

  return (
    <View
      style={[
        styles.joint,
        {
          left: pointPx.x,
          top: pointPx.y,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity,
          marginLeft: size / -2,
          marginTop: size / -2,
        },
      ]}
    />
  );
}

export default function PoseSkeletonOverlay({
  referenceKeypoints,
  liveKeypoints,
  jointStateMap = {},
  showReference = true,
  referenceDimmed = false,
}) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const referenceOpacity = referenceDimmed ? 0.46 : 0.78;

  const renderedConnections = useMemo(
    () =>
      SKELETON_CONNECTIONS.map(([fromJoint, toJoint]) => ({
        key: `${fromJoint}-${toJoint}`,
        fromJoint,
        toJoint,
      })),
    []
  );

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => setLayout(event.nativeEvent.layout)}
    >
      {showReference && renderedConnections.map(({ key, fromJoint, toJoint }) => (
        <Line
          key={`reference-${key}`}
          from={referenceKeypoints?.[fromJoint]}
          to={referenceKeypoints?.[toJoint]}
          color="rgba(166, 187, 204, 0.78)"
          opacity={referenceOpacity}
          thickness={2}
          layout={layout}
        />
      ))}

      {renderedConnections.map(({ key, fromJoint, toJoint }) => (
        <Line
          key={`live-${key}`}
          from={liveKeypoints?.[fromJoint]}
          to={liveKeypoints?.[toJoint]}
          color={getJointColor(jointStateMap[fromJoint]?.status)}
          opacity={liveKeypoints ? 0.94 : 0}
          thickness={3}
          layout={layout}
        />
      ))}

      {showReference && JOINTS.map((joint) => (
        <Joint
          key={`reference-joint-${joint}`}
          point={referenceKeypoints?.[joint]}
          color={getJointColor(null, true)}
          size={10}
          opacity={referenceOpacity}
          layout={layout}
        />
      ))}

      {JOINTS.map((joint) => (
        <Joint
          key={`live-joint-${joint}`}
          point={liveKeypoints?.[joint]}
          color={getJointColor(jointStateMap[joint]?.status)}
          size={13}
          opacity={liveKeypoints ? 1 : 0}
          layout={layout}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    position: 'absolute',
    borderRadius: 999,
  },
  joint: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
});
