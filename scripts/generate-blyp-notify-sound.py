"""
Build Blyp notify sting from a real water-drip sample, pitched into
successive notes (plop · plink · plink · plink).

Requires stems in assets/sounds/_src/drops/ (drip_hit.wav).
"""
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DROPS = ROOT / "assets" / "sounds" / "_src" / "drops"
HIT = DROPS / "drip_hit.wav"
OUTS = [
    ROOT / "assets" / "sounds" / "blyp_notify.wav",
    ROOT / "android" / "app" / "src" / "main" / "res" / "raw" / "blyp_notify.wav",
    Path(r"C:\Users\Alex\Blyp26\_ui_post\blyp_notify.wav"),
]


def ffmpeg():
    import os
    from shutil import which

    env = os.environ.get("BLYP_FFMPEG")
    if env and Path(env).exists():
        return env
    w = which("ffmpeg")
    if w:
        return w
    winget = Path(
        r"C:\Users\Alex\AppData\Local\Microsoft\WinGet\Packages"
        r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
        r"\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe"
    )
    if winget.exists():
        return str(winget)
    raise SystemExit("ffmpeg not found")


def pitch(ff, src: Path, ratio: float, dest: Path):
    tempo = round(1.0 / ratio, 4)
    subprocess.check_call(
        [
            ff,
            "-y",
            "-i",
            str(src),
            "-af",
            f"asetrate=44100*{ratio},aresample=44100,atempo={tempo},afade=t=out:st=0.28:d=0.12,volume=1.0",
            "-t",
            "0.42",
            str(dest),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main():
    if not HIT.exists():
        raise SystemExit(f"missing {HIT}")
    ff = ffmpeg()
    ratios = [0.72, 1.00, 1.26, 1.50]
    notes = []
    for i, r in enumerate(ratios):
        dest = DROPS / f"n{i}.wav"
        pitch(ff, HIT, r, dest)
        notes.append(dest)

    tmp = DROPS / "_mix.wav"
    filt = (
        "[0:a]volume=1.35,adelay=0|0[a0];"
        "[1:a]volume=1.05,adelay=220|220[a1];"
        "[2:a]volume=1.00,adelay=360|360[a2];"
        "[3:a]volume=1.10,adelay=500|500[a3];"
        "[a0][a1][a2][a3]amix=inputs=4:duration=longest:dropout_transition=0:normalize=0,"
        "alimiter=limit=0.90,afade=t=in:st=0:d=0.003,afade=t=out:st=0.95:d=0.12"
    )
    cmd = [ff, "-y"]
    for n in notes:
        cmd += ["-i", str(n)]
    cmd += ["-filter_complex", filt, "-ac", "1", "-ar", "44100", "-t", "1.20", str(tmp)]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for dest in OUTS:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(tmp, dest)
        print("wrote", dest)


if __name__ == "__main__":
    main()
