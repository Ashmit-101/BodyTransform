/**
 * CountdownRing — 3-second auto-capture countdown.
 *
 * 80px circular progress ring filling clockwise over 3s, remaining seconds
 * in the center, and a faint Cancel escape hatch beneath.
 */

import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 80;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Props = {
  /** Animated value 0 → 1 over the 3s countdown */
  progress: Animated.Value;
  secondsRemaining: number;
  onCancel: () => void;
};

export default function CountdownRing({ progress, secondsRemaining, onCancel }: Props) {
  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [CIRCUMFERENCE, 0],
  });

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.ringWrap}>
        <Svg width={SIZE} height={SIZE}>
          {/* Track */}
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={STROKE}
            fill="none"
          />
          {/* Progress arc, clockwise from 12 o'clock */}
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke="rgba(34,197,94,0.9)"
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={strokeDashoffset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <Text style={styles.seconds}>{secondsRemaining}</Text>
      </View>

      <Pressable onPress={onCancel} hitSlop={12}>
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 56,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  ringWrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seconds: {
    position: 'absolute',
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  cancel: {
    marginTop: 8,
    fontSize: 13,
    color: '#ffffff',
    opacity: 0.5,
  },
});
