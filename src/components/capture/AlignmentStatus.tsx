/**
 * AlignmentStatus — single line of monospaced status text at screen bottom.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { STATUS } from '../../store/captureStore';

type Props = {
  statusText: string;
  countdownActive: boolean;
  pollingStopped: boolean;
  onResumePolling: () => void;
};

export default function AlignmentStatus({
  statusText,
  countdownActive,
  pollingStopped,
  onResumePolling,
}: Props) {
  let color = '#ffffff';
  let opacity = 0.4;

  if (countdownActive) {
    color = 'rgb(34,197,94)';
    opacity = 1;
  } else if (statusText === STATUS.ALMOST) {
    opacity = 0.7;
  }

  return (
    <View style={styles.container} pointerEvents="box-none">
      <Text style={[styles.status, { color, opacity }]}>{statusText}</Text>
      {pollingStopped && (
        <Pressable onPress={onResumePolling} hitSlop={12}>
          <Text style={styles.resume}>Tap to resume tracking</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  status: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  resume: {
    marginTop: 4,
    fontSize: 11,
    color: '#ffffff',
    opacity: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
