"""Pass 4: Filmic-safe densify for cheer_burst + fire (hue-preserving emit + dense small particles)."""
import math
import os
import random
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

if "--" not in sys.argv:
    sys.argv += ["--", "--gift", "all", "--res", "720", "1280", "--samples", "56"]

import importlib.util

spec = importlib.util.spec_from_file_location("studio", os.path.join(HERE, "render_studio_gifts.py"))
studio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)


def add_keyed_sparks(count, origin, start_f, end_f, color, speed=2.8, size=0.028, seed=1, emit=5.0):
    rng = random.Random(seed)
    for i in range(count):
        mesh = bpy.data.meshes.new(f"SparkM{seed}_{i}")
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size * (0.5 + rng.random() * 0.7))
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(f"Spark{seed}_{i}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(studio.mat_emit(f"SparkMat{seed}_{i}", color, emit + rng.random() * 1.5))
        obj.scale = (0.01, 0.01, 0.01)
        obj.location = origin
        obj.keyframe_insert("scale", frame=max(1, start_f - 1))
        obj.keyframe_insert("location", frame=max(1, start_f - 1))
        obj.scale = (1, 1, 1)
        obj.keyframe_insert("scale", frame=start_f + (i % 3))
        ang = rng.random() * math.pi * 2
        elev = (rng.random() - 0.12) * math.pi * 0.9
        dist = speed * (0.7 + rng.random() * 1.1)
        obj.location = (
            origin[0] + math.cos(ang) * math.cos(elev) * dist,
            origin[1] + math.sin(ang) * math.cos(elev) * dist,
            origin[2] + math.sin(elev) * dist + 0.15,
        )
        obj.keyframe_insert("location", frame=end_f)
        obj.scale = (0.01, 0.01, 0.01)
        obj.keyframe_insert("scale", frame=end_f + 8)


def render_one(gift_id):
    frames = studio.GIFT_FRAMES[gift_id]
    out_dir = os.path.join(studio.OUTDIR, gift_id)
    os.makedirs(out_dir, exist_ok=True)
    for fn in os.listdir(out_dir):
        if fn.startswith("frame_") and fn.endswith(".png"):
            try:
                os.remove(os.path.join(out_dir, fn))
            except OSError:
                pass

    print(f"[pass4] Building {gift_id}")
    studio.BUILDERS[gift_id](frames)

    if gift_id == "cheer_burst":
        add_keyed_sparks(280, (0, 0, 0.08), int(frames * 0.26), frames - 2, (1.0, 0.62, 0.1, 1), 4.2, 0.028, 501, 3.8)
        add_keyed_sparks(240, (0, 0, 0.08), int(frames * 0.27), frames - 2, (0.0, 0.88, 0.78, 1), 3.9, 0.024, 502, 3.6)
        add_keyed_sparks(200, (0, 0, 0.05), int(frames * 0.28), frames - 3, (1.0, 0.28, 0.22, 1), 3.6, 0.022, 503, 3.5)
        add_keyed_sparks(160, (0, 0, 0.2), int(frames * 0.29), frames - 4, (1.0, 0.72, 0.08, 1), 3.4, 0.02, 504, 3.4)
        add_keyed_sparks(140, (0, 0, -0.05), int(frames * 0.31), frames - 2, (0.95, 0.92, 0.85, 1), 3.2, 0.018, 505, 3.0)
        add_keyed_sparks(120, (0, 0, 0.35), int(frames * 0.33), frames - 3, (1.0, 0.18, 0.38, 1), 3.5, 0.02, 506, 3.4)
    elif gift_id == "fire":
        add_keyed_sparks(260, (0, 0, 0.25), int(frames * 0.12), int(frames * 0.95), (1.0, 0.22, 0.03, 1), 2.6, 0.024, 601, 3.2)
        add_keyed_sparks(200, (0, 0, 0.0), int(frames * 0.18), frames - 2, (1.0, 0.35, 0.04, 1), 3.0, 0.02, 602, 3.0)
        add_keyed_sparks(160, (0.1, 0, 0.55), int(frames * 0.25), int(frames * 0.92), (1.0, 0.48, 0.06, 1), 2.2, 0.016, 603, 2.8)
        add_keyed_sparks(120, (-0.1, 0, 0.8), int(frames * 0.3), int(frames * 0.9), (1.0, 0.18, 0.02, 1), 2.4, 0.018, 604, 2.9)

    studio.setup_render(frames, os.path.join(out_dir, "frame_"))
    # Standard keeps gold/teal/orange; Filmic pastels them out
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.scene.view_settings.exposure = 0.0 if gift_id == "cheer_burst" else -0.05
    try:
        bpy.context.scene.view_settings.look = "None"
    except Exception:
        pass

    bpy.context.scene.render.filepath = os.path.join(out_dir, "frame_")
    bpy.ops.render.render(animation=True)
    print(f"[pass4] Done {gift_id}")


def main():
    gift = "all"
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1 :]
        if "--gift" in argv:
            gift = argv[argv.index("--gift") + 1]
    gifts = ("cheer_burst", "fire") if gift == "all" else (gift,)
    for g in gifts:
        render_one(g)


if __name__ == "__main__":
    main()
