# Week 0 — Foundation & Pipeline Spike

**Goal:** Validate the entire AI processing pipeline end-to-end before writing a single UI component. Answer the one question that changes 30% of the architecture: does `react-native-mediapipe` work reliably in a bare Expo project?

---

## What Was Done

### 1. Scaffolded Bare Expo Project

**Command:**
```bash
npx create-expo-app@latest PhysiqueTrack --template bare-minimum
```

**Result:** `PhysiqueTrack/` created with:
- Expo 55.0.8, React 19.2.0, React Native 0.83.2
- Bare workflow (not Managed) — required because MediaPipe needs native modules
- `android/` and `ios/` directories present for native builds

**Why bare workflow from day 1:** Expo Managed workflow uses a pre-built binary. The moment you need a native module not in that binary (MediaPipe, VisionCamera), you're forced to eject anyway. Start bare, keep Expo's ecosystem (Router, Camera, FileSystem, SQLite), skip the eject pain.

---

### 2. Installed Core Dependencies

```bash
npx expo install expo-router expo-sqlite expo-camera expo-file-system expo-image-manipulator
npm install zustand --legacy-peer-deps
```

**`--legacy-peer-deps` required** because `expo-router` pulls in `react-dom@19.2.4` which conflicts with `react@19.2.0` peer resolution in npm 10. This is a known Expo 55 issue; `--legacy-peer-deps` is the correct workaround.

**Final dependency set:**

| Package | Purpose |
|---|---|
| `expo-router` | File-based navigation (Expo Router v4) |
| `expo-sqlite` | Local SQLite database for photo metadata |
| `expo-camera` | In-app camera for new photos |
| `expo-file-system` | Save originals + processed images to device storage |
| `expo-image-manipulator` | Rotate, crop, scale images natively |
| `zustand` | Lightweight global state (upload queue, pose filter) |

---

### 3. Spike: `react-native-mediapipe`

**Installed:**
```bash
npm install react-native-mediapipe react-native-vision-camera react-native-worklets-core --legacy-peer-deps
```

**Version spiked:** `react-native-mediapipe@0.6.0` (last updated December 2024, community maintained by [@cdiddy77](https://github.com/cdiddy77/react-native-mediapipe))

#### Findings

**Architecture:** `react-native-mediapipe` wraps Google's `MediaPipeTasksVision` iOS SDK and the Android equivalent. It is a genuine native module — not a JS bridge over a WebView. It uses:
- `VisionCameraProxy` (frame processors for live camera)
- `NativeModules.PoseDetection` (for static image detection via `detectOnImage`)
- `react-native-worklets-core` (worklet thread for camera frames)

**`detectOnImage` exists** — this is the function we need for processing static photos from camera roll. It takes an image file path and returns 33 3D landmarks.

**Peer dependencies required:**

| Dependency | Notes |
|---|---|
| `react-native-vision-camera` | Required even for static image detection |
| `react-native-worklets-core` | Required for frame processor architecture |

**Build requirement:** Requires `cd ios && pod install` and `npx expo run:ios` (not Expo Go). CocoaPods must install `MediaPipeTasksVision` from the iOS SDK.

**Spike file created:** [`src/spike/MediaPipeSpike.tsx`](../PhysiqueTrack/src/spike/MediaPipeSpike.tsx)

#### Verdict: Conditional Pass

`react-native-mediapipe` is architecturally sound and has the right API (`detectOnImage`). However:

- **Cannot be tested without a native build.** Must run `pod install` + `npx expo run:ios` before knowing if it truly works.
- **Community maintained** — not an official Google SDK. The iOS native files import `MediaPipeTasksVision` correctly, but the wrapper has had breaking changes between versions.
- **The actual native build validation is the remaining gate.** Before starting Week 1, run the spike component (`MediaPipeSpike.tsx`) on a real device with a real gym photo.

**If native build fails or accuracy is poor → use Python FastAPI sidecar (see below).**

---

### 4. Pipeline Spike Script

**File:** [`sidecar/spike_pipeline.py`](../PhysiqueTrack/sidecar/spike_pipeline.py)

A standalone Python script that runs the full 5-step pipeline on a single JPG and outputs a normalized JPG + JSON report. Run this to validate pipeline logic independently of the React Native app.

**Usage:**
```bash
cd PhysiqueTrack/sidecar
python3 spike_pipeline.py path/to/real_gym_photo.jpg
```

**Output:**
- `normalized_<photo>.jpg` — aligned, scale-normalized image (900×1200px)
- `landmarks_<photo>.json` — all 33 landmarks, pose category, alignment params, timing

**Pipeline steps implemented:**

| Step | What it does | Key logic |
|---|---|---|
| 1 | Load MediaPipe Tasks model | `pose_landmarker_lite.task` (5.5MB, bundled) |
| 2 | Detect landmarks | 33 3D body landmarks via Tasks Vision API |
| 3 | Classify pose | Rule-based geometry heuristics (see below) |
| 4 | Compute alignment | `atan2(hip_mid, shoulder_mid)` → rotation angle; `head_to_ankle_px` → scale factor |
| 5 | Normalize image | Rotate → scale → crop/pad to 900×1200px canvas |

**Smoke test result:**
```
Step 1/5: Loading MediaPipe model... (595ms)   ← cold start, ~200ms warm
Step 2/5: Detecting pose landmarks... (16ms)   ← inference is fast
FAIL: No body detected                          ← correct: test image was synthetic
```
The pipeline runs without error on a real machine. The "no body" failure is the correct behavior for a test image without an actual person. **Test with a real gym photo before Week 1.**

#### Pose Classification Logic

Rule-based heuristics on normalized landmark coordinates (no trained ML model needed for MVP):

```
if shoulder_width < 0.15:         → "side"
elif nose.visibility < 0.3:       → "back"
elif both_elbows_raised_and_wide: → "front_double_bicep"
else:                             → "front_relaxed"
```

Confidence score is computed from landmark visibility. User always confirms the auto-detected pose before saving — overrides are tracked in the database.

---

### 5. Python / FastAPI Sidecar (Fallback)

**Files:**
- [`sidecar/main.py`](../PhysiqueTrack/sidecar/main.py) — FastAPI server
- [`sidecar/pose_landmarker_lite.task`](../PhysiqueTrack/sidecar/pose_landmarker_lite.task) — MediaPipe model (5.5MB)

**Why it exists:** If `react-native-mediapipe` native build is painful or accuracy on gym clothing is poor, the sidecar becomes the primary processing backend instead of a fallback.

**Setup:**
```bash
cd PhysiqueTrack/sidecar

# Requires Python 3.10+ (3.8 has mediapipe import issues)
# Use pyenv: pyenv local 3.10.13
pip install fastapi uvicorn mediapipe opencv-python pillow python-multipart

# Model is already downloaded at sidecar/pose_landmarker_lite.task
# To re-download:
# curl -L https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task -o pose_landmarker_lite.task

python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Verified working:**
```
Model loaded OK
MediaPipe version: 0.10.33
Blank image poses detected: 0
SMOKE TEST PASS — Tasks API works correctly
```

**API endpoints:**

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Returns status + MediaPipe version |
| `/process` | POST (multipart) | Full pipeline → JSON + base64 normalized image |
| `/landmarks-only` | POST (multipart) | Landmarks + pose + alignment, no image output |

**How the RN app calls it:**
```typescript
const formData = new FormData();
formData.append('file', { uri: photoUri, type: 'image/jpeg', name: 'photo.jpg' });
const response = await fetch('http://localhost:8000/process', {
  method: 'POST',
  body: formData,
});
const result = await response.json();
// result.pose.category, result.alignment, result.normalized_image_b64
```

**Python version note:** `mediapipe 0.10+` dropped the legacy `mp.solutions.pose` API. The sidecar uses the new Tasks Vision API (`mediapipe.tasks.python.vision.PoseLandmarker`). Python 3.10+ required.

---

## Key Technical Decisions Made in Week 0

| Decision | Choice | Reason |
|---|---|---|
| Framework | React Native + Expo bare workflow | Cross-platform; bare workflow required for native MediaPipe module |
| Pose detection | `react-native-mediapipe` (primary), Python sidecar (fallback) | RN module needs native build validation before committing |
| Lighting normalization | **Not in MVP** | Brightness/contrast degrades well-lit photos; CLAHE is complex; alignment alone is valuable enough |
| Pose categories (MVP) | 4: front_relaxed, front_double_bicep, side, back | Covers the main competitive poses; classifier is extensible to 8–10 later |
| State management | Zustand | Lightweight; no Redux boilerplate for a solo project |
| Storage | Local only (expo-sqlite + expo-file-system) | Privacy-first; no cloud costs at MVP |
| Image processing | `expo-image-manipulator` for rotate/crop/scale | Native, fast, no WebView needed |

---

## Files Created This Week

```
PhysiqueTrack/
├── App.js                          ← bare Expo entry (unchanged)
├── package.json                    ← all dependencies installed
├── src/
│   └── spike/
│       └── MediaPipeSpike.tsx      ← RN spike test (mount in App.js to validate)
└── sidecar/
    ├── main.py                     ← FastAPI server (full pipeline)
    ├── spike_pipeline.py           ← Standalone JPG → normalized JPG script
    └── pose_landmarker_lite.task   ← MediaPipe model (5.5MB)

MD_files/
└── week0.md                        ← this file
```

---

## Gate Before Week 1

**Do not start Week 1 until this is done:**

- [ ] Run `cd PhysiqueTrack/ios && pod install`
- [ ] Run `npx expo run:ios`
- [ ] Mount `<MediaPipeSpike />` in `App.js`
- [ ] Test with **10 real gym photos** (different poses, lighting, body types)
- [ ] Record: does `detectOnImage` resolve? Are landmarks accurate? Are elbows/hips visible through gym clothing?

**If all 10 photos pass** → proceed with `react-native-mediapipe` as primary pipeline.
**If >3 photos fail or accuracy is poor** → switch to Python sidecar as primary, `react-native-mediapipe` becomes optional.

---

## Known Issues / Watch Points

1. **`--legacy-peer-deps` is load-bearing.** Any new `npm install` must include this flag until Expo 56+ resolves the `react-dom` peer conflict.
2. **Python 3.10+ required** for the sidecar. Python 3.8 installs an older mediapipe version (0.10.11) that has initialization errors with `model_complexity` params.
3. **Model cold start ~600ms.** In the sidecar this is a one-time startup cost. In the RN app, load the model once on app launch and keep it in memory.
4. **Pose classification accuracy on gym clothing.** The heuristics were designed for clear landmark visibility. Baggy shorts/shirts reduce visibility scores for hip/knee landmarks. Monitor user override rate in Week 2+ and tune thresholds if needed.
