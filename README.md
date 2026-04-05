# ProgressTracker

Local, scriptable tooling to turn gym progress photos into **consistent 9:16 assets** and **Instagram-style reels**—pose alignment, lighting normalization, dated labels, and crossfades—without uploading images to the cloud.

## What’s in this repo

| Piece | Role |
|--------|------|
| [`normalize.py`](normalize.py) | Reads a folder of photos, sorts by capture date (EXIF or file time), runs **MediaPipe** body pose to straighten and scale each shot to **1080×1920**, applies **CLAHE** lighting normalization, writes numbered JPEGs. Converts **HEIC** to JPEG on macOS via `sips`. |
| [`make_reel.py`](make_reel.py) | Builds an **MP4** (1080×1920, 30 fps) with crossfades, optional **date labels** (from EXIF or filenames like `01_20200115_...`), and optional background **music** via [MoviePy](https://zulko.github.io/moviepy/). |
| [`testing.py`](testing.py) | Experimental **two-image** pipeline for upper-body / mirror-style shots: shoulder-based scale, luminance matching, CLAHE, and color balance. Outputs `test_comparison.jpg` by default. |
| [`gym-reel-guide.html`](gym-reel-guide.html) | Step-by-step **visual guide** (open in a browser) covering setup, folder layout, normalize/reel commands, and optional `ffmpeg` tips. |

Supporting folders such as `edited_pics/` may hold processed assets; use a virtual environment (`venv/`) for Python dependencies if you like.

## Requirements

- **macOS** is assumed for HEIC conversion (`sips`) and matches the guide’s tooling notes.
- **Python 3.9–3.11** is recommended; MediaPipe support for **3.12+** can be spotty ([`python3.11`](https://formulae.brew.sh/formula/python@3.11) via Homebrew if needed).
- System / CLI tools:
  - [ExifTool](https://exiftool.org/) — date metadata for sorting and labels.
  - [FFmpeg](https://ffmpeg.org/) — used by MoviePy for encoding.
- Optional: [ImageMagick](https://imagemagick.org/) — referenced in the HTML guide for some workflows.

Install the CLI tools (example with [Homebrew](https://brew.sh/)):

```bash
brew install exiftool ffmpeg
```

Python packages:

```bash
pip3 install mediapipe opencv-python moviepy pillow
```

Quick check:

```bash
exiftool -ver
python3 -c "import mediapipe, cv2, moviepy; print('all good')"
```

## Workflow

### 1. Organize photos

Group shots by pose (e.g. `poses/front_double_bicep`, `poses/side`). Full-body, clear poses work best; baggy clothing can confuse pose detection—see notes in [`gym-reel-guide.html`](gym-reel-guide.html).

### 2. Normalize (`normalize.py`)

```bash
python3 normalize.py <input_folder> <output_folder>
```

Example:

```bash
python3 normalize.py ~/Photos/front_double_bicep ~/Photos/normalized/front_double_bicep
```

Outputs chronological JPEGs named like `01_YYYYMMDD_originalstem.jpg`, each **1080×1920**, aligned and exposure-aware.

### 3. Make a reel (`make_reel.py`)

```bash
python3 make_reel.py <normalized_folder> <output.mp4>
```

Examples:

```bash
python3 make_reel.py normalized/front_double_bicep reel.mp4
python3 make_reel.py normalized/front_double_bicep reel.mp4 --music track.mp3
python3 make_reel.py normalized/front_double_bicep reel.mp4 --hold 3 --fade 1.2 --no-labels
```

- **`--hold`** — seconds each photo is fully visible (default `2.5`).
- **`--fade`** — crossfade length in seconds (default `1.0`).
- **`--no-labels`** — disable the bottom date bar.

### 4. Optional: two-image comparison (`testing.py`)

```bash
python3 testing.py <image1> <image2>
```

Useful for before/after or mirror shots with a different scale anchor than the full-body pipeline.

## Documentation

For narrated setup, troubleshooting (pose detection, Python versions), and optional `ffmpeg` snippets, open **`gym-reel-guide.html`** in your browser.

## License

No license file is included in this repository. Add one if you intend to distribute or accept contributions.
