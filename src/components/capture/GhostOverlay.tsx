/**
 * GhostOverlay — partial ghost anchor overlay.
 *
 * Reference rings (where you should be) + live dots (where you are now).
 * Rings only, never filled. White by default, green when locked.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import type { AnchorAlignment, AnchorKey, Anchors, Point } from '../../utils/anchorUtils';
import { toScreen } from '../../utils/anchorUtils';

const COLORS = {
  ringDefault: 'rgba(255,255,255,0.5)',
  ringClose: 'rgba(250,204,21,0.8)',
  ringLocked: 'rgba(34,197,94,0.9)',
  lineDefault: 'rgba(255,255,255,0.2)',
  lineLocked: 'rgba(34,197,94,0.4)',
  dotDefault: 'rgba(255,255,255,0.7)',
  dotLocked: 'rgba(34,197,94,0.9)',
};

// Ring diameters per anchor (px)
const RING_SIZE: Record<AnchorKey, number> = {
  left_shoulder: 28,
  right_shoulder: 28,
  hip_mid: 32,
  nose: 22,
  shoulder_mid: 16, // rendered as a cross, not a ring
};

const DOT_SIZE = 8;

function ringColor(state: AnchorAlignment): string {
  if (state === 'locked') return COLORS.ringLocked;
  if (state === 'close') return COLORS.ringClose;
  return COLORS.ringDefault;
}

/** Live position dot with a snap animation when it locks onto its ring. */
function LiveDot({ pos, locked }: { pos: Point; locked: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const wasLocked = useRef(false);

  useEffect(() => {
    if (locked && !wasLocked.current) {
      // Snap: 1.2 → 1.0 spring over ~150ms
      scale.setValue(1.2);
      Animated.spring(scale, {
        toValue: 1,
        speed: 40,
        bounciness: 8,
        useNativeDriver: true,
      }).start();
    }
    wasLocked.current = locked;
  }, [locked, scale]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.liveDot,
        {
          left: pos.x - DOT_SIZE / 2,
          top: pos.y - DOT_SIZE / 2,
          backgroundColor: locked ? COLORS.dotLocked : COLORS.dotDefault,
          transform: [{ scale }],
        },
      ]}
    />
  );
}

type Props = {
  referenceAnchors: Anchors;
  liveAnchors: Anchors | null;
  alignment: Record<AnchorKey, AnchorAlignment>;
  isGloballyLocked: boolean;
  width: number;
  height: number;
};

export default function GhostOverlay({
  referenceAnchors,
  liveAnchors,
  alignment,
  isGloballyLocked,
  width,
  height,
}: Props) {
  if (width === 0 || height === 0) return null;

  const ref: Record<AnchorKey, Point> = {
    nose: toScreen(referenceAnchors.nose, width, height),
    left_shoulder: toScreen(referenceAnchors.left_shoulder, width, height),
    right_shoulder: toScreen(referenceAnchors.right_shoulder, width, height),
    shoulder_mid: toScreen(referenceAnchors.shoulder_mid, width, height),
    hip_mid: toScreen(referenceAnchors.hip_mid, width, height),
  };

  const lineColor = isGloballyLocked ? COLORS.lineLocked : COLORS.lineDefault;
  const crossColor = ringColor(alignment.shoulder_mid);
  const crossHalf = RING_SIZE.shoulder_mid / 2;

  const ringAnchors: AnchorKey[] = ['left_shoulder', 'right_shoulder', 'hip_mid', 'nose'];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        {/* Connecting lines */}
        <Line
          x1={ref.left_shoulder.x}
          y1={ref.left_shoulder.y}
          x2={ref.right_shoulder.x}
          y2={ref.right_shoulder.y}
          stroke={lineColor}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <Line
          x1={ref.shoulder_mid.x}
          y1={ref.shoulder_mid.y}
          x2={ref.hip_mid.x}
          y2={ref.hip_mid.y}
          stroke={lineColor}
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Reference rings (never filled) */}
        {ringAnchors.map((key) => (
          <Circle
            key={key}
            cx={ref[key].x}
            cy={ref[key].y}
            r={RING_SIZE[key] / 2 - 1}
            stroke={ringColor(alignment[key])}
            strokeWidth={2}
            fill="none"
          />
        ))}

        {/* Shoulder midpoint cross */}
        <Line
          x1={ref.shoulder_mid.x - crossHalf}
          y1={ref.shoulder_mid.y}
          x2={ref.shoulder_mid.x + crossHalf}
          y2={ref.shoulder_mid.y}
          stroke={crossColor}
          strokeWidth={2}
        />
        <Line
          x1={ref.shoulder_mid.x}
          y1={ref.shoulder_mid.y - crossHalf}
          x2={ref.shoulder_mid.x}
          y2={ref.shoulder_mid.y + crossHalf}
          stroke={crossColor}
          strokeWidth={2}
        />
      </Svg>

      {/* Live anchor dots — where the user actually is right now */}
      {liveAnchors &&
        (Object.keys(liveAnchors) as AnchorKey[]).map((key) => (
          <LiveDot
            key={key}
            pos={toScreen(liveAnchors[key], width, height)}
            locked={alignment[key] === 'locked'}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  liveDot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
});
