# Pose Detection Implementation Guide

## Current Status
The app framework is ready for pose detection, but the actual ML model integration is a **TODO**. The skeleton overlay UI will display once keypoints are detected.

## How It Works
1. User uploads a reference photo → `importReferencePhotoForPose()` is called
2. `detectPoseInImage()` is called to extract skeleton keypoints
3. Keypoints are saved to database and displayed in reference preview
4. Live camera feed compares against these reference keypoints

## Implementation Options

### Option 1: Google ML Kit (Recommended for Expo)
**Best for:** React Native + Expo, easiest to integrate

#### Setup
```bash
npm install react-native-ml-kit
```

#### Implementation
Update `src/utils/poseDetection.js`:

```javascript
import MLKit from 'react-native-ml-kit';
import { Image as RNImage } from 'react-native';

async function initializePoseDetector() {
  // ML Kit doesn't need explicit initialization
  detectorInstance = { ready: true, type: 'ml-kit' };
  return detectorInstance;
}

export async function detectPoseInImage(imageUri, expectedWidth, expectedHeight) {
  try {
    // Detect poses from image
    const result = await MLKit.poseDetectionOnImage(imageUri);
    
    if (!result || !result.poses || result.poses.length === 0) {
      return null;
    }

    return parseDetectedPose(result.poses[0], expectedWidth, expectedHeight);
  } catch (err) {
    console.error('ML Kit pose detection failed:', err);
    return null;
  }
}
```

---

### Option 2: MediaPipe (Most Accurate)
**Best for:** Highest accuracy, but requires native module setup

#### Setup (Native Module)
```bash
# For Android
npm install @react-native-camera-ml-kit/camera-pose-detection

# Then link native modules
cd ios && pod install && cd ..
```

#### Implementation
```javascript
import { PoseDetection } from '@react-native-camera-ml-kit/camera-pose-detection';

async function initializePoseDetector() {
  detectorInstance = { ready: true, type: 'mediapipe' };
  return detectorInstance;
}

export async function detectPoseInImage(imageUri, expectedWidth, expectedHeight) {
  try {
    const poses = await PoseDetection.detectPoses(imageUri);
    
    if (!poses || poses.length === 0) {
      return null;
    }

    return parseDetectedPose(poses[0], expectedWidth, expectedHeight);
  } catch (err) {
    console.error('MediaPipe pose detection failed:', err);
    return null;
  }
}
```

---

### Option 3: Cloud API (No Native Setup Required)
**Best for:** Simplicity, no native compilation needed

#### Setup (Google Cloud Vision)
```bash
npm install @google-cloud/vision
```

#### Implementation
```javascript
import vision from '@google-cloud/vision';

const client = new vision.ImageAnnotatorClient({
  keyFilename: 'YOUR_GOOGLE_CLOUD_KEYFILE.json',
});

export async function detectPoseInImage(imageUri, expectedWidth, expectedHeight) {
  try {
    const request = {
      image: { source: { imageUri } },
    };

    const [result] = await client.detectPoseLandmarks(request);
    const annotations = result.poseAnnotations;

    if (!annotations || annotations.length === 0) {
      return null;
    }

    const landmarks = annotations[0];
    return parseCloudPose(landmarks, expectedWidth, expectedHeight);
  } catch (err) {
    console.error('Cloud pose detection failed:', err);
    return null;
  }
}
```

---

## Implementation Checklist

### Phase 1: Basic Integration (Choose ONE option above)
- [ ] Install pose detection package
- [ ] Update `detectPoseInImage()` function
- [ ] Test pose extraction on sample photos
- [ ] Verify keypoints are stored in database

### Phase 2: UI Feedback
- [ ] Remove skeleton-less reference photos warning
- [ ] Show skeleton outline in reference preview
- [ ] Display confidence score per joint
- [ ] Show alignment quality feedback

### Phase 3: Real-time Camera Integration
- [ ] Implement pose detection on live camera frames
- [ ] Replace simulator with real detection
- [ ] Add smoothing/filtering for stable output
- [ ] Test alignment accuracy

### Phase 4: Optimization
- [ ] Add loading state while detecting
- [ ] Implement caching for detected keypoints
- [ ] Performance profiling
- [ ] Battery/memory optimization

---

## Testing Checklist

Test with these scenarios:
- ✅ Clear gym photo with good lighting
- ✅ Dark gym photo with shadows
- ✅ Partial body in frame
- ✅ Multiple people in background
- ✅ Back pose (lower detection confidence)
- ✅ Side pose at angles

---

## Quick Start: Using ML Kit (Recommended)

1. Install package:
   ```bash
   npm install react-native-ml-kit
   cd ios && pod install && cd ..
   ```

2. Replace `src/utils/poseDetection.js` with the ML Kit implementation above

3. Test by uploading a gym photo → skeleton should appear

4. If skeleton doesn't appear, check:
   - Pose detection console logs for errors
   - Image clarity (good lighting, full body visible)
   - Database keypoints were saved (`reference_keypoints_json` in poses table)

---

## Troubleshooting

### Skeleton not appearing on reference photo
1. Check database: `SELECT reference_keypoints_json FROM poses WHERE id = 1`
2. If NULL → pose detection returned no results
3. Check console logs during upload: search for "pose detection" errors
4. Try a clearer reference photo

### Low confidence joints
- Some joints naturally have lower confidence (ankles, wrists)
- Validator requires 70% valid joints minimum
- Check `validateExtractedKeypoints()` threshold

### Performance issues
- Pose detection can be slow first time (model loading)
- Cache keypoints after first detection
- Consider lower resolution images for detection
- Use lightweight model variant if available

---

## Key Code Locations

- **Main detection:** `src/utils/poseDetection.js`
- **Photo import:** `src/utils/referencePhotos.js`
- **Database saving:** `src/database/db.js` → `savePoseReferenceKeypoints()`
- **Reference preview:** `src/components/PoseReferencePreview.js`
- **Pose alignment UI:** `src/components/PoseSkeletonOverlay.js`

---

## Next Steps

1. Choose your pose detection approach (ML Kit recommended)
2. Install the required package
3. Update `detectPoseInImage()` function
4. Test with actual gym photos
5. Iterate on accuracy vs. performance
