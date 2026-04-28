# BodyTransform

A cross-platform mobile app (iOS & Android) built with **React Native** and **Expo**. It is designed as a gym progress camera with pose-reference setup, skeleton-based alignment guidance, and a timeline gallery.

## Features

- **📸 Camera with Pose Guidance** — Use a faint reference skeleton and live joint feedback to move into the same bodybuilding pose without blocking the camera feed.
- **🧍 Pose Categories** — Organize shots by pose (Front Relaxed, Side Chest, Back Lat Spread, etc.). Each category keeps its own reference photo and alignment profile.
- **📅 Timeline Gallery** — Scrollable grid of all your photos for a given pose, sorted by date. Tap to view full-screen.
- **🔄 Before/After Comparison** — Side-by-side or swipe-reveal slider to compare any two photos from the same pose.
- **🔒 100% Local & Private** — All photos are stored on-device. Nothing is ever uploaded to the cloud.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native via **Expo SDK 54** |
| Navigation | React Navigation (bottom tabs + native stack) |
| Camera | `expo-camera` (CameraView) |
| Storage | `expo-file-system` (photos) + `expo-sqlite` (metadata) |
| Animations | `react-native-reanimated` |
| Haptics | `expo-haptics` |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Expo Go](https://expo.dev/go) app on your phone (for testing)

### Install & Run

```bash
# Install dependencies
npm install

# Start the dev server
npx expo start
```

Scan the QR code with **Expo Go** on your phone to run the app.

> **Note:** Camera features require a physical device — they won't work on simulators.

## Project Structure

```
BodyTransform/
├── App.js                    # Root: DB init + navigation
├── src/
│   ├── navigation/
│   │   └── TabNavigator.js   # Bottom tabs + nested stacks
│   ├── screens/
│   │   ├── CameraScreen.js   # Live camera + pose alignment UI
│   │   ├── PosesScreen.js    # Pose category list
│   │   ├── TimelineScreen.js # Photo grid for a pose
│   │   ├── CompareScreen.js  # Side-by-side comparison
│   │   └── SettingsScreen.js # Preferences & stats
│   ├── components/
│   │   ├── PoseSkeletonOverlay.js # Reference/live skeleton renderer
│   │   ├── PoseReferencePreview.js # Reference photo + skeleton preview
│   │   ├── CaptureButton.js  # Animated shutter
│   │   ├── PhotoCard.js      # Timeline thumbnail
│   │   └── PoseCard.js       # Pose list card
│   ├── database/
│   │   └── db.js             # SQLite CRUD
│   ├── constants/
│   │   └── poseAlignment.js  # Pose templates + tolerances
│   ├── theme/
│   │   └── theme.js          # Dark mode design tokens
│   └── utils/
│       ├── poseAlignment.js  # Alignment math + smoothing
│       └── storage.js        # File system helpers
├── legacy/                   # Old Python batch-processing scripts
├── app.json                  # Expo config & permissions
└── babel.config.js
```

## License

No license file is included. Add one if you intend to distribute or accept contributions.
