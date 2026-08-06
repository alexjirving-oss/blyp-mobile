"""
Encode RGBA PNG sequences into:
  1) AlphaPlayer-style side-by-side H.264 MP4 (RGB | Alpha) for Android
  2) Dark-key preview MP4 (RGB on black) for Desktop reel / fallback
  3) Optional VP9 WebM with true alpha for desktop QC

Usage:
  python encode_alpha_mp4.py --gift all
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
FRAMES = HERE / "_frames_studio"
ALPHA_OUT = REPO / "assets" / "gifts" / "cinema" / "alpha"
CLIPS_OUT = REPO / "assets" / "gifts" / "cinema" / "clips"
WORK = HERE / "_encode_work"

GIFTS = {
    "rocket": {"durationMs": 3400, "impactAt": 0.28, "gloryMs": 1000},
    "crown": {"durationMs": 3200, "impactAt": 0.42, "gloryMs": 1100},
    "diamond": {"durationMs": 3300, "impactAt": 0.34, "gloryMs": 1100},
    "cheer_burst": {"durationMs": 3200, "impactAt": 0.30, "gloryMs": 1100},
    "fire": {"durationMs": 3300, "impactAt": 0.30, "gloryMs": 1100},
}

FPS = 30


def find_ffmpeg() -> str:
    w = shutil.which("ffmpeg")
    if w:
        return w
    raise SystemExit("ffmpeg not found on PATH")


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.check_call(cmd)


def encode_gift(gift_id: str, ffmpeg: str) -> dict:
    src = FRAMES / gift_id
    pattern = src / "frame_%04d.png"
    # Blender writes frame_0001.png with 4 digits by default when filepath ends with frame_
    # Actually Blender uses #### replacement - typically frame_0001.png
    samples = sorted(src.glob("frame_*.png"))
    if not samples:
        raise FileNotFoundError(f"No frames in {src}")

    # Detect padding from first file
    first = samples[0].name
    # frame_0001.png
    work = WORK / gift_id
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    ALPHA_OUT.mkdir(parents=True, exist_ok=True)
    CLIPS_OUT.mkdir(parents=True, exist_ok=True)

    # Normalize to sequential frame_%04d.png starting at 1
    for i, p in enumerate(samples, start=1):
        dest = work / f"rgba_{i:04d}.png"
        if not dest.exists():
            # hardlink or copy
            try:
                os.link(p, dest)
            except OSError:
                shutil.copy2(p, dest)

    rgba_pat = str(work / "rgba_%04d.png")
    rgb_mp4 = work / "rgb.mp4"
    a_mp4 = work / "alpha.mp4"
    split_mp4 = ALPHA_OUT / f"{gift_id}.mp4"
    dark_mp4 = CLIPS_OUT / f"{gift_id}.mp4"
    webm = ALPHA_OUT / f"{gift_id}.webm"

    # RGB plate (black bg for dark-key fallback)
    run([
        ffmpeg, "-y", "-framerate", str(FPS), "-i", rgba_pat,
        "-vf", "format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-an",
        "-movflags", "+faststart",
        str(rgb_mp4),
    ])

    # Alpha as grayscale (from alphaextract)
    run([
        ffmpeg, "-y", "-framerate", str(FPS), "-i", rgba_pat,
        "-vf", "alphaextract,format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-an",
        str(a_mp4),
    ])

    # Side-by-side RGB | Alpha (YYEVA / AlphaPlayer layout)
    run([
        ffmpeg, "-y",
        "-i", str(rgb_mp4),
        "-i", str(a_mp4),
        "-filter_complex", "[0:v][1:v]hstack=inputs=2,format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-an",
        "-movflags", "+faststart",
        str(split_mp4),
    ])

    # Dark-key cinema clip (RGB on black) — keep for Desktop / fallback
    run([
        ffmpeg, "-y", "-framerate", str(FPS), "-i", rgba_pat,
        "-vf", "format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "17",
        "-pix_fmt", "yuv420p", "-an",
        "-movflags", "+faststart",
        str(dark_mp4),
    ])

    # True alpha WebM for Desktop QC (if libvpx-vp9 available)
    try:
        run([
            ffmpeg, "-y", "-framerate", str(FPS), "-i", rgba_pat,
            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28",
            "-an", str(webm),
        ])
    except subprocess.CalledProcessError:
        print(f"[warn] VP9 alpha webm failed for {gift_id}; skipping")
        webm = None

    meta = {
        "id": gift_id,
        "layout": "splitHorizontalRgbLeftAlphaRight",
        "fps": FPS,
        "frameCount": len(samples),
        "alphaMp4": str(split_mp4.relative_to(REPO)).replace("\\", "/"),
        "darkKeyMp4": str(dark_mp4.relative_to(REPO)).replace("\\", "/"),
        "webm": str(webm.relative_to(REPO)).replace("\\", "/") if webm and webm.exists() else None,
        **GIFTS[gift_id],
    }
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gift", default="all")
    args = ap.parse_args()
    ffmpeg = find_ffmpeg()
    gifts = list(GIFTS.keys()) if args.gift == "all" else [args.gift]
    manifest = {"version": 1, "layout": "rgb|alpha side-by-side", "gifts": {}}
    for g in gifts:
        manifest["gifts"][g] = encode_gift(g, ffmpeg)
    out = ALPHA_OUT / "manifest.json"
    ALPHA_OUT.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Wrote", out)


if __name__ == "__main__":
    main()
