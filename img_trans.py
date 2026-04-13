#!/usr/bin/env python3
"""
img_trans.py — Gym photo normalization pipeline.
Aligns body, normalizes scale, corrects lighting.

Scale modes (set SCALE_MODE below):
  'torso'     — anchors on shoulder-to-hip torso height (default, most stable)
  'full_body' — anchors on nose-to-ankle body height
  'shoulder'  — anchors on shoulder width (upper-body / mirror photos)

Usage:
  Comparison:  python3 img_trans.py <image1> <image2>
  Batch:       python3 img_trans.py <input_folder> [output_folder]
"""

import sys, os, subprocess, urllib.request, tempfile, shutil
from datetime import datetime
import cv2
import numpy as np

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
except ImportError:
    print("ERROR: mediapipe not installed. Run: pip install mediapipe")
    sys.exit(1)

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
CANVAS_W        = 1080
CANVAS_H        = 1920
BODY_RATIO      = 0.82      # full_body: body height as fraction of canvas height
HEAD_PAD        = 0.06      # full_body: gap from canvas top to head anchor
TORSO_RATIO     = 0.35      # torso: torso occupies 35% of canvas height
HIP_Y_FRAC      = 0.58      # torso: hip midpoint placed at 58% down canvas
TARGET_SHOULDER = 400       # shoulder: target shoulder width in pixels
SHOULDER_Y_FRAC = 0.35      # shoulder: shoulder vertical placement in canvas
SCALE_MODE      = 'torso'   # 'torso', 'full_body', or 'shoulder'
OUTPUT          = "comparison.jpg"

# MediaPipe landmark indices
NOSE        = 0
L_EYE_INNER = 1
R_EYE_INNER = 4
L_SHOULDER  = 11
R_SHOULDER  = 12
L_HIP       = 23
R_HIP       = 24
L_ANKLE     = 27
R_ANKLE     = 28

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG'}


# ─────────────────────────────────────────────
# EXIF helpers
# ─────────────────────────────────────────────
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


def read_image(path):
    """Read image and apply EXIF orientation so pixels are correctly rotated."""
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
# Lighting normalization (3 stages)
# ─────────────────────────────────────────────
def get_image_stats(bgr):
    """
    Compute mean L/A/B from LAB color space.
    Ignores black canvas border pixels (L < 8).
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
    Stage 2: Shift A/B channels to neutralize color cast (50% blend to preserve original color).
    Stage 3: CLAHE on L for local contrast — blended 65/35 to avoid over-processing.
    """
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    l, a, b = cv2.split(lab)
    mask = l > 8

    if mask.any():
        l = np.clip(l + (target_L - float(l[mask].mean())), 0, 255)

    if mask.any():
        a = np.clip(a + (target_A - float(a[mask].mean())) * 0.5, 0, 255)
        b = np.clip(b + (target_B - float(b[mask].mean())) * 0.5, 0, 255)

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
# Pose detection
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


def create_landmarker(model_path):
    """Create a PoseLandmarker instance to reuse across all images in a run."""
    opts = mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        output_segmentation_masks=False,
        min_pose_detection_confidence=0.4,
        min_pose_presence_confidence=0.4,
        min_tracking_confidence=0.4,
    )
    return mp_vision.PoseLandmarker.create_from_options(opts)


def detect_landmarks(img_bgr, landmarker):
    """
    Returns (px, lm) where:
      px(idx) → np.array([x_pixels, y_pixels])
      lm       → raw landmark list (for visibility checks)
    Returns (None, None) if no body detected.
    """
    h, w    = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    mp_img  = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)
    result  = landmarker.detect(mp_img)

    if not result.pose_landmarks:
        return None, None

    lm = result.pose_landmarks[0]
    def px(idx):
        return np.array([lm[idx].x * w, lm[idx].y * h])
    return px, lm


# ─────────────────────────────────────────────
# Landmark helpers
# ─────────────────────────────────────────────
def weighted_mid(lm, idx_l, idx_r, img_w, img_h):
    """
    Visibility-weighted midpoint of two landmarks.
    Returns (midpoint_xy, min_visibility).
    Falls back to equal weighting if both visibilities are 0.
    """
    vis_l = lm[idx_l].visibility or 0.0
    vis_r = lm[idx_r].visibility or 0.0
    total = vis_l + vis_r or 1.0
    pt_l  = np.array([lm[idx_l].x * img_w, lm[idx_l].y * img_h])
    pt_r  = np.array([lm[idx_r].x * img_w, lm[idx_r].y * img_h])
    return (pt_l * vis_l + pt_r * vis_r) / total, min(vis_l, vis_r)


def head_anchor(px_fn, lm, img_w, img_h):
    """
    Visibility-weighted centroid of nose + left/right eye inner corners.
    More stable than nose alone when the nose is partially occluded.
    """
    vis_n  = lm[NOSE].visibility        or 0.0
    vis_le = lm[L_EYE_INNER].visibility or 0.0
    vis_re = lm[R_EYE_INNER].visibility or 0.0
    total  = vis_n + vis_le + vis_re or 1.0
    return (
        px_fn(NOSE)        * vis_n  +
        px_fn(L_EYE_INNER) * vis_le +
        px_fn(R_EYE_INNER) * vis_re
    ) / total


def compute_pose_score(lm, img_w, img_h):
    """
    Compute a 0-100 pose quality score. Returns (score_int, details_dict).

    Components:
      Spine verticality  (40 pts): 0 pts at >=10° deviation from vertical
      Shoulder level     (30 pts): 0 pts at >=8° tilt
      Mean visibility    (30 pts): mean visibility of 7 anchor landmarks × 30
    """
    sh_mid, _ = weighted_mid(lm, L_SHOULDER, R_SHOULDER, img_w, img_h)
    hi_mid, _ = weighted_mid(lm, L_HIP,      R_HIP,      img_w, img_h)
    spine_vec  = hi_mid - sh_mid
    spine_deg  = abs(float(np.degrees(np.arctan2(spine_vec[0], spine_vec[1]))))
    spine_score = max(0.0, 40.0 * (1.0 - spine_deg / 10.0))

    ls = np.array([lm[L_SHOULDER].x * img_w, lm[L_SHOULDER].y * img_h])
    rs = np.array([lm[R_SHOULDER].x * img_w, lm[R_SHOULDER].y * img_h])
    sh_delta  = rs - ls
    sh_tilt   = abs(float(np.degrees(np.arctan2(sh_delta[1], sh_delta[0]))))
    sh_score  = max(0.0, 30.0 * (1.0 - sh_tilt / 8.0))

    anchor_ids = [NOSE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_ANKLE, R_ANKLE]
    mean_vis   = sum(lm[i].visibility or 0.0 for i in anchor_ids) / len(anchor_ids)
    vis_score  = 30.0 * mean_vis

    total = int(round(spine_score + sh_score + vis_score))
    return total, {
        'spine_deg': round(spine_deg, 1),
        'sh_tilt':   round(sh_tilt, 1),
        'mean_vis':  round(mean_vis, 2),
    }


# ─────────────────────────────────────────────
# Geometry normalization
# ─────────────────────────────────────────────
def normalize_geometry(img_path, landmarker):
    """
    Rotate → scale → place on canvas.
    Returns canvas array (lighting not yet applied).
    """
    print(f"  Loading:        {os.path.basename(img_path)}")
    img = read_image(img_path)
    if img is None:
        print(f"  ERROR: Cannot read file.")
        sys.exit(1)

    h, w = img.shape[:2]
    print(f"  Original size:  {w}x{h}px")

    print(f"  Detecting pose...")
    px, lm = detect_landmarks(img, landmarker)
    if px is None:
        print(f"  ERROR: No body detected. Make sure the full body is clearly visible.")
        sys.exit(1)

    ls = px(L_SHOULDER)
    rs = px(R_SHOULDER)

    # Rotation: spine vector (shoulder→hip) when hips reliably visible,
    # shoulder tilt fallback for upper-body / mirror shots.
    hip_vis = min(lm[L_HIP].visibility or 0.0, lm[R_HIP].visibility or 0.0)
    if hip_vis > 0.5:
        sh_mid,  _ = weighted_mid(lm, L_SHOULDER, R_SHOULDER, w, h)
        hip_mid, _ = weighted_mid(lm, L_HIP,      R_HIP,      w, h)
        spine   = hip_mid - sh_mid
        angle   = float(np.degrees(np.arctan2(spine[0], spine[1])))
        print(f"  Rotation:       spine vector  {angle:.1f}°")
    else:
        delta = rs - ls
        angle = float(np.degrees(np.arctan2(delta[1], delta[0])))
        print(f"  Rotation:       shoulder tilt {angle:.1f}°  [hips not visible]")

    M     = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    img_r = cv2.warpAffine(img, M, (w, h),
                           flags=cv2.INTER_LANCZOS4,
                           borderMode=cv2.BORDER_REFLECT101)

    # Re-detect on rotated image for accurate measurements
    px2, lm2 = detect_landmarks(img_r, landmarker)
    if px2 is None:
        px2, lm2 = px, lm

    # Visibility-weighted shoulder measurements
    ls2 = np.array([lm2[L_SHOULDER].x * w, lm2[L_SHOULDER].y * h])
    rs2 = np.array([lm2[R_SHOULDER].x * w, lm2[R_SHOULDER].y * h])
    shoulder_w2          = float(np.linalg.norm(ls2 - rs2))
    shoulder_mid2, _     = weighted_mid(lm2, L_SHOULDER, R_SHOULDER, w, h)
    shoulder_cx2         = shoulder_mid2[0]
    shoulder_cy2         = shoulder_mid2[1]

    # Visibility-weighted hip measurements (needed for torso mode and fallback)
    hip_mid2, hip_mid2_vis = weighted_mid(lm2, L_HIP, R_HIP, w, h)

    if shoulder_w2 < 20:
        print(f"  ERROR: Shoulders not detected clearly enough.")
        sys.exit(1)

    # Pose quality score
    pose_score, pose_detail = compute_pose_score(lm2, w, h)
    low_conf = "  [LOW CONFIDENCE]" if pose_score < 70 else ""
    print(f"  Pose score:     {pose_score}/100  "
          f"(spine {pose_detail['spine_deg']}°, "
          f"shoulder {pose_detail['sh_tilt']}°, "
          f"vis {pose_detail['mean_vis']:.2f})"
          f"{low_conf}")

    # Torso height — computed for both torso mode and as auto-fallback
    torso_vec = hip_mid2 - shoulder_mid2
    torso_h   = float(np.linalg.norm(torso_vec))

    # Scale + placement: torso → full_body → shoulder cascade
    scale_used = None

    if SCALE_MODE == 'torso' and torso_h > 10 and hip_mid2_vis > 0.3:
        scale      = (CANVAS_H * TORSO_RATIO) / torso_h
        target_x   = CANVAS_W // 2
        target_y   = int(CANVAS_H * HIP_Y_FRAC)
        paste_x    = int(hip_mid2[0] * scale)
        paste_y    = int(hip_mid2[1] * scale)
        scale_used = 'torso'
        print(f"  Scale:          torso  torso_h={int(torso_h)}px  {scale:.2f}x")

    if scale_used is None and SCALE_MODE in ('full_body', 'torso'):
        head_pt = head_anchor(px2, lm2, w, h)
        nose_y  = head_pt[1]

        vis_la  = lm2[L_ANKLE].visibility or 0.0
        vis_ra  = lm2[R_ANKLE].visibility or 0.0
        if max(vis_la, vis_ra) >= 0.4:
            # Use the more visible ankle rather than the geometrically lower one
            ankle_y = px2(L_ANKLE)[1] if vis_la >= vis_ra else px2(R_ANKLE)[1]
            body_h  = ankle_y - nose_y
            if body_h > 10:
                scale      = (CANVAS_H * BODY_RATIO) / body_h
                target_x   = CANVAS_W // 2
                target_y   = int(CANVAS_H * HEAD_PAD)
                paste_x    = int(shoulder_cx2 * scale)
                paste_y    = int(nose_y * scale)
                scale_used = 'full_body'
                print(f"  Scale:          full_body  body={int(body_h)}px  {scale:.2f}x")

        if scale_used is None and torso_h > 10 and hip_mid2_vis > 0.3:
            # Ankles unreliable — fall back to torso
            scale      = (CANVAS_H * TORSO_RATIO) / torso_h
            target_x   = CANVAS_W // 2
            target_y   = int(CANVAS_H * HIP_Y_FRAC)
            paste_x    = int(hip_mid2[0] * scale)
            paste_y    = int(hip_mid2[1] * scale)
            scale_used = 'torso (auto-fallback)'
            print(f"  Scale:          torso (auto-fallback)  torso_h={int(torso_h)}px  {scale:.2f}x")

    if scale_used is None:
        scale      = TARGET_SHOULDER / max(shoulder_w2, 1)
        target_x   = CANVAS_W // 2
        target_y   = int(CANVAS_H * SHOULDER_Y_FRAC)
        paste_x    = int(shoulder_cx2 * scale)
        paste_y    = int(shoulder_cy2 * scale)
        print(f"  Scale:          shoulder  width={int(shoulder_w2)}px  {scale:.2f}x")

    nw = int(w * scale)
    nh = int(h * scale)
    img_s = cv2.resize(img_r, (nw, nh), interpolation=cv2.INTER_LANCZOS4)

    ox = target_x - paste_x
    oy = target_y - paste_y

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
# Side-by-side comparison
# ─────────────────────────────────────────────
def make_comparison(img1_path, img2_path):
    model_path = get_model_path()
    landmarker = create_landmarker(model_path)

    try:
        print(f"\n{'─'*50}")
        print(f"Image 1 — geometry:")
        canvas1 = normalize_geometry(img1_path, landmarker)

        print(f"\nImage 2 — geometry:")
        canvas2 = normalize_geometry(img2_path, landmarker)
    finally:
        landmarker.close()

    print(f"\n  Computing shared lighting target...")
    stats1 = get_image_stats(canvas1)
    stats2 = get_image_stats(canvas2)

    target_L = (stats1['mean_L'] + stats2['mean_L']) / 2
    target_A = (stats1['mean_A'] + stats2['mean_A']) / 2
    target_B = (stats1['mean_B'] + stats2['mean_B']) / 2

    print(f"  Image 1 — L:{stats1['mean_L']:.1f}  A:{stats1['mean_A']:.1f}  B:{stats1['mean_B']:.1f}")
    print(f"  Image 2 — L:{stats2['mean_L']:.1f}  A:{stats2['mean_A']:.1f}  B:{stats2['mean_B']:.1f}")
    print(f"  Target  — L:{target_L:.1f}  A:{target_A:.1f}  B:{target_B:.1f}")

    print(f"\n  Applying lighting normalization...")
    lit1 = apply_lighting(canvas1, target_L, target_A, target_B)
    lit2 = apply_lighting(canvas2, target_L, target_A, target_B)
    print(f"  Lighting done ✓")

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
    subprocess.run(['open', OUTPUT])


# ─────────────────────────────────────────────
# Batch processing
# ─────────────────────────────────────────────
def batch_process(input_dir, output_dir):
    paths = [
        os.path.join(input_dir, f)
        for f in os.listdir(input_dir)
        if os.path.splitext(f)[1] in IMAGE_EXTS
    ]
    paths = [p for p in paths if os.path.isfile(p)]

    if not paths:
        print(f"ERROR: No images found in {input_dir}")
        sys.exit(1)

    # Sort by EXIF date
    print(f"Reading dates from {len(paths)} photos...")
    dated = sorted(
        [(get_exif_date(p), p) for p in paths],
        key=lambda x: x[0]
    )

    os.makedirs(output_dir, exist_ok=True)
    model_path = get_model_path()
    landmarker = create_landmarker(model_path)
    tmp_dir    = tempfile.mkdtemp(prefix='img_trans_')

    try:
        # Pass 1 — geometry → temp dir, collect stats (one image in RAM at a time)
        print(f"\n{'─'*50}")
        print(f"Pass 1 — Geometry normalization ({len(dated)} images)")
        stats_list = []
        tmp_paths  = []
        for date, orig_path in dated:
            print(f"\n  [{os.path.basename(orig_path)}]")
            canvas   = normalize_geometry(orig_path, landmarker)
            tmp_name = os.path.splitext(os.path.basename(orig_path))[0] + '_geom.jpg'
            tmp_path = os.path.join(tmp_dir, tmp_name)
            cv2.imwrite(tmp_path, canvas, [cv2.IMWRITE_JPEG_QUALITY, 97])
            stats_list.append(get_image_stats(canvas))
            tmp_paths.append((date, orig_path, tmp_path))

        # Pass 2 — shared lighting target across all images
        print(f"\n{'─'*50}")
        print(f"Pass 2 — Computing shared lighting target...")
        target_L = sum(s['mean_L'] for s in stats_list) / len(stats_list)
        target_A = sum(s['mean_A'] for s in stats_list) / len(stats_list)
        target_B = sum(s['mean_B'] for s in stats_list) / len(stats_list)
        print(f"  Target — L:{target_L:.1f}  A:{target_A:.1f}  B:{target_B:.1f}")
        for (_, orig, _), s in zip(tmp_paths, stats_list):
            print(f"  {os.path.basename(orig):30s}  L:{s['mean_L']:.1f}  A:{s['mean_A']:.1f}  B:{s['mean_B']:.1f}")

        # Pass 3 — apply lighting and save (load one temp image at a time)
        print(f"\n{'─'*50}")
        print(f"Pass 3 — Applying lighting and saving...")
        for i, (date, orig_path, tmp_path) in enumerate(tmp_paths, 1):
            date_str = date.strftime('%Y%m%d')
            out_name = f"{i:02d}_{date_str}_{os.path.splitext(os.path.basename(orig_path))[0]}.jpg"
            out_path = os.path.join(output_dir, out_name)
            canvas   = cv2.imread(tmp_path)
            lit      = apply_lighting(canvas, target_L, target_A, target_B)
            cv2.imwrite(out_path, lit, [cv2.IMWRITE_JPEG_QUALITY, 95])
            print(f"  [{i:02d}/{len(tmp_paths)}] {out_name}")

    finally:
        landmarker.close()
        shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"\n{'─'*50}")
    print(f"  Done. {len(tmp_paths)} images saved to {output_dir}")
    subprocess.run(['open', output_dir])


# ─────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) == 2 and os.path.isdir(sys.argv[1]):
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "edited_pics")
        batch_process(sys.argv[1], out)
    elif len(sys.argv) == 3 and os.path.isdir(sys.argv[1]):
        batch_process(sys.argv[1], sys.argv[2])
    elif len(sys.argv) == 3:
        for p in sys.argv[1:]:
            if not os.path.exists(p):
                print(f"ERROR: File not found: {p}")
                sys.exit(1)
        make_comparison(sys.argv[1], sys.argv[2])
    else:
        print("Usage:")
        print("  Comparison:  python3 img_trans.py <image1> <image2>")
        print("  Batch:       python3 img_trans.py <input_folder> [output_folder]")
        sys.exit(1)
