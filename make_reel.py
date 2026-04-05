#!/usr/bin/env python3
"""
make_reel.py — Instagram Reel generator
Creates a 9:16 (1080x1920) crossfade video from normalized gym photos.
Date labels are read from EXIF or parsed from filename.

Usage:
  python make_reel.py <normalized_folder> <output.mp4>
  python make_reel.py <normalized_folder> <output.mp4> --music track.mp3
  python make_reel.py <normalized_folder> <output.mp4> --hold 3 --fade 1.2 --no-labels

Examples:
  python make_reel.py normalized/front_double_bicep reel_front.mp4
  python make_reel.py normalized/front_double_bicep reel_front.mp4 --music song.mp3
"""

import os, sys, subprocess, argparse
from datetime import datetime


W, H = 1080, 1920  # Instagram Reel dimensions


def get_date_label(filepath):
    """
    Read date from EXIF, or parse from filename pattern: 01_20200115_original.jpg
    Returns formatted string like 'JAN 2020', or '' if not found.
    """
    try:
        r = subprocess.run(
            ['exiftool', '-DateTimeOriginal', '-s3', filepath],
            capture_output=True, text=True, timeout=5
        )
        s = r.stdout.strip()
        if s:
            d = datetime.strptime(s, '%Y:%m:%d %H:%M:%S')
            return d.strftime('%b %Y').upper()
    except Exception:
        pass

    # Fallback: parse from filename (e.g. 01_20200115_...)
    name = os.path.basename(filepath)
    parts = name.split('_')
    if len(parts) >= 2 and len(parts[1]) == 8 and parts[1].isdigit():
        try:
            d = datetime.strptime(parts[1], '%Y%m%d')
            return d.strftime('%b %Y').upper()
        except Exception:
            pass
    return ''


def add_label_to_clip(clip, label, duration, clip_w=W, clip_h=H):
    """Add a semi-transparent bottom bar with the date label."""
    from moviepy.editor import ColorClip, TextClip, CompositeVideoClip
    bar_h = 100
    bar = (ColorClip((clip_w, bar_h), color=(0, 0, 0))
           .set_opacity(0.5)
           .set_duration(duration)
           .set_position((0, clip_h - bar_h)))

    txt = (TextClip(label, fontsize=46, font='Helvetica-Bold',
                    color='white', method='label')
           .set_duration(duration)
           .set_position(('center', clip_h - bar_h // 2 - 20)))

    return CompositeVideoClip([clip, bar, txt], size=(clip_w, clip_h)).set_duration(duration)


def make_reel(input_folder, output_path, music_path=None,
              hold=2.5, fade=1.0, show_labels=True):
    """
    Build the reel.
    hold = seconds each photo is fully visible
    fade = seconds for crossfade between photos
    """
    try:
        from moviepy.editor import (ImageClip, CompositeVideoClip, AudioFileClip)
    except ImportError:
        print("ERROR: moviepy not installed. Run: pip install moviepy")
        sys.exit(1)

    exts = {'.jpg', '.jpeg', '.png'}
    files = sorted([
        os.path.join(input_folder, f)
        for f in os.listdir(input_folder)
        if os.path.splitext(f)[1].lower() in exts
    ])

    if not files:
        print(f"No images found in {input_folder}")
        sys.exit(1)

    print(f"Building reel from {len(files)} photos...")
    print(f"  Hold: {hold}s per photo  |  Fade: {fade}s  |  Labels: {show_labels}")

    clips = []
    for fpath in files:
        duration = hold + fade
        label = get_date_label(fpath) if show_labels else ''

        base = ImageClip(fpath).set_duration(duration)

        if label:
            clip = add_label_to_clip(base, label, duration)
        else:
            clip = base

        clips.append(clip)

    # Layer clips with crossfade overlap
    final_clips = []
    t = 0.0
    for i, clip in enumerate(clips):
        c = clip.set_start(t)
        if i > 0:
            c = c.crossfadein(fade)
        final_clips.append(c)
        t += hold  # each clip starts `hold` seconds after the last

    total_duration = t + fade
    video = CompositeVideoClip(final_clips, size=(W, H)).subclip(0, total_duration)

    # Add music
    if music_path:
        if not os.path.exists(music_path):
            print(f"WARNING: music file not found: {music_path}")
        else:
            try:
                audio = (AudioFileClip(music_path)
                         .subclip(0, min(total_duration, AudioFileClip(music_path).duration))
                         .audio_fadeout(1.5))
                video = video.set_audio(audio)
                print(f"  Music: {os.path.basename(music_path)}")
            except Exception as e:
                print(f"  WARNING: could not load music: {e}")

    print(f"\nRendering {total_duration:.1f}s video at {W}x{H} 30fps...")
    print(f"Output: {output_path}\n")

    video.write_videofile(
        output_path,
        fps=30,
        codec='libx264',
        audio_codec='aac',
        bitrate='8000k',
        threads=4,
        preset='slow',          # better quality; use 'fast' if speed is priority
        ffmpeg_params=['-crf', '18'],
        logger='bar'
    )

    print(f"\n✓ Done! Saved to: {output_path}")
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  File size: {size_mb:.1f} MB")
    print(f"  Duration:  {total_duration:.1f}s")
    print(f"  Photos:    {len(files)}")


def main():
    parser = argparse.ArgumentParser(
        description='Create an Instagram Reel from normalized gym photos.'
    )
    parser.add_argument('input',         help='Folder of normalized photos')
    parser.add_argument('output',        help='Output MP4 path (e.g. reel.mp4)')
    parser.add_argument('--music',       help='Background music file (.mp3, .m4a, .wav)')
    parser.add_argument('--hold',        type=float, default=2.5,
                        help='Seconds each photo is shown (default: 2.5)')
    parser.add_argument('--fade',        type=float, default=1.0,
                        help='Crossfade duration in seconds (default: 1.0)')
    parser.add_argument('--no-labels',   action='store_true',
                        help='Disable date labels on photos')
    args = parser.parse_args()

    if not os.path.isdir(args.input):
        print(f"ERROR: Input folder not found: {args.input}")
        sys.exit(1)

    make_reel(
        input_folder=args.input,
        output_path=args.output,
        music_path=args.music,
        hold=args.hold,
        fade=args.fade,
        show_labels=not args.no_labels
    )


if __name__ == '__main__':
    main()
