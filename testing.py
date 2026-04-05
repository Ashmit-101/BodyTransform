#!/usr/bin/env python3
"""
testing.py — Gym photo normalization for upper body / mirror photos.
Uses shoulder width as scale anchor. Full lighting normalization:
  - Luminance matching across both images
  - CLAHE local contrast equalization
  - Color temperature balancing (neutralizes warm/cool casts)

Usage:
  python3 testing.py <image1> <image2>
"""

import sys, os, urllib.request
import cv2
import numpy as np

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
CANVAS_W        = 1080
CANVAS_H        = 1920
TARGET_SHOULDER = 400
SHOULDER_Y_FRAC = 0.35
OUTPUT          = "test_comparison.jpg"

L_SHOULDER = 11
R_SHOULDER = 12


# ─────────────────────────────────────────────
# Read image respecting EXIF orientation
# ─────────────────────────────────────────────
def read_image(path):
    import subprocess
    img = cv2.imread(path)
    if img is None:
        return None
    try:
        r = subprocess.run(
            ['exiftool', '-Orientation', '-s3', '-n', path],
            capture_output=True, text=True, timeout=5
        )
        orientation = int(r.stdout.strip()) if r.stdout.strip().isdigit() else 1
    except Exception:
        orientation = 1

    if orientation == 3:
        img = cv2.rotate(img, cv2.ROTATE_180)
    elif orientation == 6:
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    elif orientation == 8:
        img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return img


# ─────────────────────────────────────────────
# Download pose model once
# ─────────────────────────────────────────────
def get_model_path():
    model_dir  = os.path.expanduser("~/.cache/mediapipe_models")
    model_path = os.path.join(model_dir, "pose_landmarker_heavy.task")
    os.makedirs(model_dir, exist_ok=True)
    if not os.path.exists(model_path):
        url = (
            "https://storage.googleapis.com/mediapipe-models/"
            "pose_landmarker/pose_landmarker_heavy/float16/latest/"
            "pose_landmarker_heavy.task"
        )
        print(f"  Downloading pose model (~25MB, once only)...")
        urllib.request.urlretrieve(url, model_path)
        print(f"  Saved.")
    return model_path


# ─────────────────────────────────────────────
# Lighting normalization (3 stages)
# ─────────────────────────────────────────────
def get_image_stats(bgr):
    """
    Compute mean L (luminance) and mean A/B (color channels) from LAB.
    Ignores black canvas border pixels (L < 8).
    Returns dict with mean_L, mean_A, mean_B.
    """
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    l, a, b = cv2.split(lab)
    mask = l > 8
    if not mask.any():
        return {'mean_L': 128.0, 'mean_A': 128.0, 'mean_B': 128.0}
    return {
        'mean_L': float(l[mask].mean()),
        'mean_A': float(a[mask].mean()),
        'mean_B': float(b[mask].mean()),
    }


def apply_lighting(bgr, target_L, target_A, target_B):
    """
    Stage 1: Shift L to match target luminance.
    Stage 2: Shift A/B channels to neutralize color cast (match target white balance).
    Stage 3: CLAHE on L for local contrast — blended 65/35 to avoid over-processing.
    """
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    l, a, b = cv2.split(lab)
    mask = l > 8

    # Stage 1 — luminance shift
    if mask.any():
        current_L = float(l[mask].mean())
        l = np.clip(l + (target_L - current_L), 0, 255)

    # Stage 2 — color temperature / cast correction
    # A channel: green (low) ↔ red (high). B channel: blue (low) ↔ yellow (high).
    if mask.any():
        current_A = float(a[mask].mean())
        current_B = float(b[mask].mean())
        # Gentle shift — blend 50/50 so we don't destroy the original color
        a = np.clip(a + (target_A - current_A) * 0.5, 0, 255)
        b = np.clip(b + (target_B - current_B) * 0.5, 0, 255)

    # Stage 3 — CLAHE on L channel
    l_uint8 = np.clip(l, 0, 255).astype(np.uint8)
    clahe   = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_eq    = clahe.apply(l_uint8).astype(np.float32)
    l_final = cv2.addWeighted(l_eq, 0.65, l_uint8.astype(np.float32), 0.35, 0)

    result = cv2.merge([
        np.clip(l_final, 0, 255).astype(np.uint8),
        np.clip(a, 0, 255).astype(np.uint8),
        np.clip(b, 0, 255).astype(np.uint8),
    ])
    return cv2.cvtColor(result, cv2.COLOR_LAB2BGR)


# ─────────────────────────────────────────────
# Pose detection — mediapipe 0.10.x API
# ─────────────────────────────────────────────
def detect_landmarks(img_bgr, model_path):
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    h, w    = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    mp_img  = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)

    opts = mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        output_segmentation_masks=False,
        min_pose_detection_confidence=0.4,
        min_pose_presence_confidence=0.4,
        min_tracking_confidence=0.4,
    )
    with mp_vision.PoseLandmarker.create_from_options(opts) as det:
        result = det.detect(mp_img)

    if not result.pose_landmarks:
        return None

    lm = result.pose_landmarks[0]
    def px(idx):
        return np.array([lm[idx].x * w, lm[idx].y * h])
    return px


# ─────────────────────────────────────────────
# Geometry normalization (alignment + scale)
# Returns canvas BEFORE lighting is applied
# ─────────────────────────────────────────────
def normalize_geometry(img_path, model_path):
    print(f"  Loading:        {os.path.basename(img_path)}")
    img = read_image(img_path)
    if img is None:
        print(f"  ERROR: Cannot read file.")
        sys.exit(1)

    h, w = img.shape[:2]
    print(f"  Original size:  {w}x{h}px")

    print(f"  Detecting pose...")
    px = detect_landmarks(img, model_path)
    if px is None:
        print(f"  ERROR: No body detected. Make sure both shoulders are clearly visible.")
        sys.exit(1)

    ls = px(L_SHOULDER)
    rs = px(R_SHOULDER)
    shoulder_w  = float(np.linalg.norm(ls - rs))
    shoulder_cx = (ls[0] + rs[0]) / 2
    shoulder_cy = (ls[1] + rs[1]) / 2
    print(f"  Shoulder width: {int(shoulder_w)}px")

    if shoulder_w < 20:
        print(f"  ERROR: Shoulders not detected clearly enough.")
        sys.exit(1)

    # Rotation from shoulder tilt
    delta = rs - ls
    angle = float(np.degrees(np.arctan2(delta[1], delta[0])))
    print(f"  Shoulder tilt:  {angle:.1f} degrees")

    M     = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    img_r = cv2.warpAffine(img, M, (w, h),
                           flags=cv2.INTER_LANCZOS4,
                           borderMode=cv2.BORDER_REFLECT101)

    # Re-detect on rotated image
    px2 = detect_landmarks(img_r, model_path) or px
    ls2 = px2(L_SHOULDER)
    rs2 = px2(R_SHOULDER)
    shoulder_w2  = float(np.linalg.norm(ls2 - rs2))
    shoulder_cx2 = (ls2[0] + rs2[0]) / 2
    shoulder_cy2 = (ls2[1] + rs2[1]) / 2

    # Scale to target shoulder width
    scale = TARGET_SHOULDER / max(shoulder_w2, 1)
    nw    = int(w * scale)
    nh    = int(h * scale)
    img_s = cv2.resize(img_r, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    print(f"  Scale factor:   {scale:.2f}x")

    # Place on canvas
    target_cx = CANVAS_W // 2
    target_cy = int(CANVAS_H * SHOULDER_Y_FRAC)
    paste_x   = int(shoulder_cx2 * scale)
    paste_y   = int(shoulder_cy2 * scale)
    ox = target_cx - paste_x
    oy = target_cy - paste_y

    canvas = np.zeros((CANVAS_H, CANVAS_W, 3), dtype=np.uint8)
    sx1 = max(0, -ox);             sy1 = max(0, -oy)
    sx2 = min(nw, CANVAS_W - ox);  sy2 = min(nh, CANVAS_H - oy)
    dx1 = max(0, ox);              dy1 = max(0, oy)
    dx2 = dx1 + (sx2 - sx1);      dy2 = dy1 + (sy2 - sy1)

    if sx2 > sx1 and sy2 > sy1:
        canvas[dy1:dy2, dx1:dx2] = img_s[sy1:sy2, sx1:sx2]

    print(f"  Geometry done ✓")
    return canvas


# ─────────────────────────────────────────────
# Side-by-side comparison with shared lighting
# ─────────────────────────────────────────────
def make_comparison(img1_path, img2_path):
    model_path = get_model_path()

    # Step 1 — geometry normalization (no lighting yet)
    print(f"\n{'─'*50}")
    print(f"Image 1 — geometry:")
    canvas1 = normalize_geometry(img1_path, model_path)

    print(f"\nImage 2 — geometry:")
    canvas2 = normalize_geometry(img2_path, model_path)

    # Step 2 — compute shared lighting target (average of both images)
    print(f"\n  Computing shared lighting target...")
    stats1 = get_image_stats(canvas1)
    stats2 = get_image_stats(canvas2)

    target_L = (stats1['mean_L'] + stats2['mean_L']) / 2
    target_A = (stats1['mean_A'] + stats2['mean_A']) / 2
    target_B = (stats1['mean_B'] + stats2['mean_B']) / 2

    print(f"  Image 1 — L:{stats1['mean_L']:.1f}  A:{stats1['mean_A']:.1f}  B:{stats1['mean_B']:.1f}")
    print(f"  Image 2 — L:{stats2['mean_L']:.1f}  A:{stats2['mean_A']:.1f}  B:{stats2['mean_B']:.1f}")
    print(f"  Target  — L:{target_L:.1f}  A:{target_A:.1f}  B:{target_B:.1f}")

    # Step 3 — apply lighting normalization to both images using shared target
    print(f"\n  Applying lighting normalization...")
    lit1 = apply_lighting(canvas1, target_L, target_A, target_B)
    lit2 = apply_lighting(canvas2, target_L, target_A, target_B)
    print(f"  Lighting done ✓")

    # Step 4 — build side-by-side output
    tw = CANVAS_W // 2
    th = int(tw * CANVAS_H / CANVAS_W)

    t1 = cv2.resize(lit1, (tw, th), interpolation=cv2.INTER_AREA)
    t2 = cv2.resize(lit2, (tw, th), interpolation=cv2.INTER_AREA)

    divider    = np.full((th, 2, 3), 60, dtype=np.uint8)
    comparison = np.hstack([t1, divider, t2])

    bar = np.full((48, comparison.shape[1], 3), 18, dtype=np.uint8)
    def put_label(text, x):
        cv2.putText(bar, text, (x, 32),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                    (200, 200, 200), 1, cv2.LINE_AA)

    put_label(os.path.splitext(os.path.basename(img1_path))[0][:26], 12)
    put_label(os.path.splitext(os.path.basename(img2_path))[0][:26], tw + 12)

    final = np.vstack([comparison, bar])
    cv2.imwrite(OUTPUT, final, [cv2.IMWRITE_JPEG_QUALITY, 95])

    print(f"\n{'─'*50}")
    print(f"  Saved: {OUTPUT}  ({final.shape[1]}x{final.shape[0]}px)")
    print(f"  Opening preview...")
    os.system(f'open "{OUTPUT}"')


# ─────────────────────────────────────────────
# Batch processing
# ─────────────────────────────────────────────
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG'}

def batch_process(input_dir, output_dir):
    paths = [
        os.path.join(input_dir, f)
        for f in os.listdir(input_dir)
        if os.path.splitext(f)[1] in IMAGE_EXTS and f != '.'
    ]
    paths = [p for p in paths if os.path.isfile(p)]

    if not paths:
        print(f"ERROR: No images found in {input_dir}")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    model_path = get_model_path()

    # Pass 1 — geometry normalization
    print(f"\n{'─'*50}")
    print(f"Pass 1 — Geometry normalization ({len(paths)} images)")
    canvases = {}
    for p in paths:
        print(f"\n  [{os.path.basename(p)}]")
        canvas = normalize_geometry(p, model_path)
        canvases[p] = canvas

    # Pass 2 — compute shared lighting target across all images
    print(f"\n{'─'*50}")
    print(f"Pass 2 — Computing shared lighting target...")
    all_stats = [get_image_stats(c) for c in canvases.values()]
    target_L = sum(s['mean_L'] for s in all_stats) / len(all_stats)
    target_A = sum(s['mean_A'] for s in all_stats) / len(all_stats)
    target_B = sum(s['mean_B'] for s in all_stats) / len(all_stats)
    print(f"  Target — L:{target_L:.1f}  A:{target_A:.1f}  B:{target_B:.1f}")
    for p, s in zip(canvases.keys(), all_stats):
        print(f"  {os.path.basename(p):30s}  L:{s['mean_L']:.1f}  A:{s['mean_A']:.1f}  B:{s['mean_B']:.1f}")

    # Pass 3 — apply lighting and save
    print(f"\n{'─'*50}")
    print(f"Pass 3 — Applying lighting and saving...")
    for p, canvas in canvases.items():
        name = os.path.splitext(os.path.basename(p))[0] + '.jpg'
        out_path = os.path.join(output_dir, name)
        lit = apply_lighting(canvas, target_L, target_A, target_B)
        cv2.imwrite(out_path, lit, [cv2.IMWRITE_JPEG_QUALITY, 95])
        print(f"  Saved: {out_path}")

    print(f"\n{'─'*50}")
    print(f"  Done. {len(canvases)} images saved to {output_dir}")
    os.system(f'open "{output_dir}"')


# ─────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) == 2 and os.path.isdir(sys.argv[1]):
        # Batch mode: python3 testing.py <input_folder>
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "edited_pics")
        batch_process(sys.argv[1], out)
    elif len(sys.argv) == 3 and os.path.isdir(sys.argv[1]):
        # Batch mode with custom output: python3 testing.py <input_folder> <output_folder>
        batch_process(sys.argv[1], sys.argv[2])
    elif len(sys.argv) == 3:
        # Comparison mode: python3 testing.py <image1> <image2>
        for p in sys.argv[1:]:
            if not os.path.exists(p):
                print(f"ERROR: File not found: {p}")
                sys.exit(1)
        make_comparison(sys.argv[1], sys.argv[2])
    else:
        print("Usage:")
        print("  Batch:      python3 testing.py <input_folder>")
        print("  Comparison: python3 testing.py <image1> <image2>")
        sys.exit(1)