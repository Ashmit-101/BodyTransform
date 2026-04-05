#!/usr/bin/env python3
"""
normalize.py — Gym photo normalization pipeline
Aligns body, normalizes scale, corrects lighting via CLAHE.
Reads EXIF dates and names output files chronologically.

Usage:
  python normalize.py <input_folder> <output_folder>

Example:
  python normalize.py ~/poses/front_double_bicep ~/poses/normalized/front_double_bicep
"""

import os, sys, subprocess, argparse
from datetime import datetime
import cv2
import numpy as np

CANVAS_W = 1080
CANVAS_H = 1920
BODY_RATIO = 0.82     # body height as fraction of canvas height
HEAD_PAD   = 0.06     # head sits this far from top of canvas


def get_exif_date(filepath):
    """Read DateTimeOriginal from EXIF via exiftool, fall back to mtime."""
    try:
        r = subprocess.run(
            ['exiftool', '-DateTimeOriginal', '-s3', filepath],
            capture_output=True, text=True, timeout=5
        )
        s = r.stdout.strip()
        if s:
            return datetime.strptime(s, '%Y:%m:%d %H:%M:%S')
    except Exception:
        pass
    return datetime.fromtimestamp(os.path.getmtime(filepath))


def apply_clahe(bgr):
    """
    CLAHE on L-channel of LAB color space.
    Blended 65/35 with original to avoid over-processing.
    """
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_eq = clahe.apply(l)
    l_blend = cv2.addWeighted(l_eq, 0.65, l, 0.35, 0)
    return cv2.cvtColor(cv2.merge([l_blend, a, b]), cv2.COLOR_LAB2BGR)


def normalize_image(img_path, out_path):
    """
    Full pipeline: rotate → scale → crop → CLAHE → save.
    Returns (success: bool, message: str)
    """
    try:
        import mediapipe as mp
    except ImportError:
        print("ERROR: mediapipe not installed. Run: pip install mediapipe")
        sys.exit(1)

    img = cv2.imread(img_path)
    if img is None:
        return False, "could not read file"

    h, w = img.shape[:2]
    pose = mp.solutions.pose.Pose(
        static_image_mode=True,
        min_detection_confidence=0.5,
        model_complexity=2  # most accurate
    )

    def detect(image):
        return pose.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

    def lm_px(landmarks, idx, iw, ih):
        l = landmarks[idx]
        return np.array([l.x * iw, l.y * ih])

    # --- First detection: get spine angle ---
    r1 = detect(img)
    if not r1.pose_landmarks:
        pose.close()
        return False, "no body detected (try a clearer full-body photo)"

    lm = r1.pose_landmarks.landmark
    sh_mid  = (lm_px(lm, 11, w, h) + lm_px(lm, 12, w, h)) / 2
    hip_mid = (lm_px(lm, 23, w, h) + lm_px(lm, 24, w, h)) / 2

    spine = hip_mid - sh_mid
    angle = float(np.degrees(np.arctan2(spine[0], spine[1])))

    # --- Rotate to vertical ---
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    img_r = cv2.warpAffine(
        img, M, (w, h),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT101
    )

    # --- Re-detect on rotated image for accurate measurements ---
    r2 = detect(img_r)
    lm2 = r2.pose_landmarks.landmark if r2.pose_landmarks else lm

    def p2(idx):
        return lm_px(lm2, idx, w, h)

    nose_y  = p2(0)[1]
    ankle_y = max(p2(27)[1], p2(28)[1])
    cx      = (p2(11)[0] + p2(12)[0]) / 2
    body_h  = ankle_y - nose_y

    if body_h <= 10:
        pose.close()
        return False, "body height calculation failed"

    # --- Scale so body fills BODY_RATIO of canvas ---
    scale = (CANVAS_H * BODY_RATIO) / body_h
    nw = int(w * scale)
    nh = int(h * scale)
    img_s = cv2.resize(img_r, (nw, nh), interpolation=cv2.INTER_LANCZOS4)

    # --- Center body on canvas ---
    x0 = int(cx * scale) - CANVAS_W // 2
    y0 = int(nose_y * scale) - int(CANVAS_H * HEAD_PAD)

    canvas = np.zeros((CANVAS_H, CANVAS_W, 3), dtype=np.uint8)

    sx  = max(0, x0);          sy  = max(0, y0)
    sx2 = min(nw, x0 + CANVAS_W); sy2 = min(nh, y0 + CANVAS_H)
    dx  = sx - x0;             dy  = sy - y0

    if sx2 > sx and sy2 > sy:
        canvas[dy:dy+(sy2-sy), dx:dx+(sx2-sx)] = img_s[sy:sy2, sx:sx2]

    # --- CLAHE lighting normalization ---
    canvas = apply_clahe(canvas)

    pose.close()
    cv2.imwrite(out_path, canvas, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return True, f"scale={scale:.2f}x  rot={angle:.1f}°  body={int(body_h)}px"


def convert_heic(folder):
    """Convert any HEIC files to JPEG using macOS sips."""
    heic_files = [f for f in os.listdir(folder) if f.lower().endswith('.heic')]
    if not heic_files:
        return
    print(f"  Converting {len(heic_files)} HEIC files to JPEG...")
    for f in heic_files:
        path = os.path.join(folder, f)
        out  = os.path.splitext(path)[0] + '.jpg'
        subprocess.run(['sips', '-s', 'format', 'jpeg', path, '--out', out],
                       capture_output=True)
    print(f"  Done converting HEIC files.")


def main():
    parser = argparse.ArgumentParser(
        description='Normalize gym photos: align, scale, and correct lighting.'
    )
    parser.add_argument('input',  help='Folder containing sorted pose photos')
    parser.add_argument('output', help='Folder to save normalized photos')
    args = parser.parse_args()

    if not os.path.isdir(args.input):
        print(f"ERROR: Input folder not found: {args.input}")
        sys.exit(1)

    os.makedirs(args.output, exist_ok=True)

    # Convert HEIC first
    convert_heic(args.input)

    exts = {'.jpg', '.jpeg', '.png'}
    files = [
        f for f in os.listdir(args.input)
        if os.path.splitext(f)[1].lower() in exts
    ]

    if not files:
        print("No image files found in input folder.")
        sys.exit(1)

    # Sort by EXIF date
    dated = []
    print(f"Reading dates from {len(files)} photos...")
    for f in files:
        path = os.path.join(args.input, f)
        d = get_exif_date(path)
        dated.append((d, path, f))
    dated.sort(key=lambda x: x[0])

    print(f"\nProcessing {len(dated)} photos → {args.output}\n")
    success = 0

    for i, (date, path, fname) in enumerate(dated, 1):
        date_str = date.strftime('%Y%m%d')
        label    = date.strftime('%b %Y')
        out_name = f"{i:02d}_{date_str}_{os.path.splitext(fname)[0]}.jpg"
        out_path = os.path.join(args.output, out_name)

        ok, msg = normalize_image(path, out_path)
        icon = "✓" if ok else "✗"
        print(f"  {icon} [{i:02d}/{len(dated)}]  {label}  {fname}")
        if not ok:
            print(f"        → {msg}")
        else:
            print(f"        → {msg}")
            success += 1

    print(f"\n{'─'*50}")
    print(f"Done: {success}/{len(dated)} normalized successfully")
    if success < len(dated):
        failed = len(dated) - success
        print(f"      {failed} failed — check those photos manually")
    print(f"Output: {args.output}")


if __name__ == '__main__':
    main()
