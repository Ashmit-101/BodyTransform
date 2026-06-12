/**
 * captureStore — Zustand state for the partial ghost overlay capture screen.
 */

import { create } from 'zustand';
import type { AnchorAlignment, AnchorKey, Anchors } from '../utils/anchorUtils';
import { ANCHOR_KEYS } from '../utils/anchorUtils';

export const STATUS = {
  MISALIGNED: 'Match the rings to shoot',
  ALMOST: 'Almost there...',
  HOLD: 'Hold still',
  MOVE_INTO_FRAME: 'Move into frame',
  OFFLINE: 'Processing offline — manual alignment only.',
} as const;

const initialAlignment = () => {
  const map = {} as Record<AnchorKey, AnchorAlignment>;
  for (const key of ANCHOR_KEYS) map[key] = 'misaligned';
  return map;
};

export type CaptureState = {
  // Reference
  referenceAnchors: Anchors | null;
  referenceImageUri: string | null;
  // Live
  liveAnchors: Anchors | null;
  anchorAlignment: Record<AnchorKey, AnchorAlignment>;
  isGloballyLocked: boolean;
  // Countdown
  countdownActive: boolean;
  countdownSecondsRemaining: number; // 3 → 2 → 1
  // UI
  isPolling: boolean;
  statusText: string;
  sidecarOffline: boolean;
  pollingStopped: boolean; // after 3 consecutive failures

  // Actions
  setReference: (anchors: Anchors, imageUri: string) => void;
  setLiveResult: (
    liveAnchors: Anchors | null,
    alignment: Record<AnchorKey, AnchorAlignment>,
    globallyLocked: boolean,
    statusText: string,
  ) => void;
  startCountdown: () => void;
  tickCountdown: (secondsRemaining: number) => void;
  cancelCountdown: () => void;
  setPolling: (isPolling: boolean) => void;
  setSidecarOffline: (offline: boolean) => void;
  setPollingStopped: (stopped: boolean) => void;
  reset: () => void;
};

export const useCaptureStore = create<CaptureState>((set) => ({
  referenceAnchors: null,
  referenceImageUri: null,
  liveAnchors: null,
  anchorAlignment: initialAlignment(),
  isGloballyLocked: false,
  countdownActive: false,
  countdownSecondsRemaining: 3,
  isPolling: false,
  statusText: STATUS.MISALIGNED,
  sidecarOffline: false,
  pollingStopped: false,

  setReference: (anchors, imageUri) =>
    set({
      referenceAnchors: anchors,
      referenceImageUri: imageUri,
      statusText: STATUS.MISALIGNED,
    }),

  setLiveResult: (liveAnchors, alignment, globallyLocked, statusText) =>
    set({
      liveAnchors,
      anchorAlignment: alignment,
      isGloballyLocked: globallyLocked,
      statusText,
    }),

  startCountdown: () =>
    set({
      countdownActive: true,
      countdownSecondsRemaining: 3,
      isPolling: false,
      statusText: STATUS.HOLD,
    }),

  tickCountdown: (secondsRemaining) =>
    set({ countdownSecondsRemaining: secondsRemaining }),

  cancelCountdown: () =>
    set({
      countdownActive: false,
      countdownSecondsRemaining: 3,
      isGloballyLocked: false,
      anchorAlignment: initialAlignment(),
      statusText: STATUS.MISALIGNED,
    }),

  setPolling: (isPolling) => set({ isPolling }),
  setSidecarOffline: (offline) => set({ sidecarOffline: offline }),
  setPollingStopped: (stopped) => set({ pollingStopped: stopped }),

  reset: () =>
    set({
      referenceAnchors: null,
      referenceImageUri: null,
      liveAnchors: null,
      anchorAlignment: initialAlignment(),
      isGloballyLocked: false,
      countdownActive: false,
      countdownSecondsRemaining: 3,
      isPolling: false,
      statusText: STATUS.MISALIGNED,
      sidecarOffline: false,
      pollingStopped: false,
    }),
}));
