"""
PhysiqueTrack pose sidecar — FastAPI + MediaPipe.

POST /landmarks-only
    multipart `file` (JPEG/PNG) → 33 normalized pose landmarks.

Run:
    cd sidecar
    python -m venv venv && source venv/bin/activate
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

import cv2
import mediapipe as mp
import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="PhysiqueTrack Pose Sidecar")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# static_image_mode: each request is an independent frame
_pose = mp.solutions.pose.Pose(
    static_image_mode=True,
    model_complexity=1,
    min_detection_confidence=0.5,
)


def _classify_pose(landmarks) -> dict:
    """Crude front/back heuristic for the MVP. Nose visibility ≈ facing camera."""
    nose_visibility = landmarks[0].visibility
    category = "front_relaxed" if nose_visibility > 0.5 else "back_relaxed"
    return {"category": category, "confidence": round(float(nose_visibility), 2)}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/landmarks-only")
async def landmarks_only(file: UploadFile = File(...)):
    data = await file.read()
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)

    if image is None:
        return {"pose": None, "landmarks": []}

    results = _pose.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

    if not results.pose_landmarks:
        return {"pose": None, "landmarks": []}

    lms = results.pose_landmarks.landmark
    return {
        "pose": _classify_pose(lms),
        "landmarks": [
            {
                "x": round(lm.x, 5),
                "y": round(lm.y, 5),
                "z": round(lm.z, 5),
                "visibility": round(lm.visibility, 5),
            }
            for lm in lms
        ],
    }
