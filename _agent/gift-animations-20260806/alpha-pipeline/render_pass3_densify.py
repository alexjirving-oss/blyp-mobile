"""Pass 3: densify cheer_burst + fire (keyed confetti / warm embers on top of denser builders)."""
import math
import os
import random
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

if "--" not in sys.argv:
    sys.argv += ["--", "--gift", "cheer_burst", "--res", "720", "1280", "--samples", "56"]

import importlib.util

spec = importlib.util.spec_from_file_location("studio", os.path.join(HERE, "render_studio_gifts.py"))
studio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)


def add_keyed_sparks(count, origin, start_f, end_f, color, speed=2.8, size=0.04, seed=1, emit_boost=16.0):
    rng = random.Random(seed)
    for i in range(count):
        mesh = bpy.data.meshes.new(f"SparkM{seed}_{i}")
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size * (0.55 + rng.random() * 0.9))
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(f"Spark{seed}_{i}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(studio.mat_emit(f"SparkMat{seed}_{i}", color, emit_boost + rng.random() * 10))
        obj.scale = (0.01, 0.01, 0.01)
        obj.location = origin
        obj.keyframe_insert("scale", frame=max(1, start_f - 1))
        obj.keyframe_insert("location", frame=max(1, start_f - 1))
        obj.scale = (1, 1, 1)
        obj.keyframe_insert("scale", frame=start_f + (i % 3))
        ang = rng.random() * math.pi * 2
        elev = (rng.random() - 0.15) * math.pi * 0.85
        dist = speed * (0.65 + rng.random() * 1.15)
        obj.location = (
            origin[0] + math.cos(ang) * math.cos(elev) * dist,
            origin[1] + math.sin(ang) * math.cos(elev) * dist,
            origin[2] + math.sin(elev) * dist + 0.2,
        )
        obj.keyframe_insert("location", frame=end_f)
        obj.scale = (0.01, 0.01, 0.01)
        obj.keyframe_insert("scale", frame=end_f + 8)


def warm_fire_emission():
    """Push flame materials warmer/saturated — never retune down to washed yellow."""
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        name = ob.name.lower()
        if not any(k in name for k in ("flame", "ember", "heat", "firespark", "firecore")):
            continue
        for slot in ob.material_slots:
            m = slot.material
            if not m or not getattr(m, "use_nodes", False):
                continue
            for n in m.node_tree.nodes:
                if n.type == "EMISSION":
                    c = list(n.inputs[0].default_value)
                    # Clamp green channel down for warmer orange/red
                    g = min(c[1], 0.62 if "core" not in name else 0.92)
                    b = min(c[2], 0.12)
                    n.inputs[0].default_value = (1.0, max(0.18, g), max(0.02, b), 1.0)
                    # Keep punchy but avoid total bloom washout
                    cur = float(n.inputs[1].default_value)
                    if "core" in name:
                        n.inputs[1].default_value = max(cur, 24.0)
                    elif "ember" in name:
                        n.inputs[1].default_value = min(max(cur, 10.0), 18.0)
                    else:
                        n.inputs[1].default_value = min(max(cur, 12.0), 26.0)


def render_one(gift_id):
    frames = studio.GIFT_FRAMES[gift_id]
    out_dir = os.path.join(studio.OUTDIR, gift_id)
    os.makedirs(out_dir, exist_ok=True)
    # Clear prior frames so encode doesn't mix old/new
    for fn in os.listdir(out_dir):
        if fn.startswith("frame_") and fn.endswith(".png"):
            try:
                os.remove(os.path.join(out_dir, fn))
            except OSError:
                pass

    print(f"[pass3] Building {gift_id}")
    studio.BUILDERS[gift_id](frames)

    if gift_id == "cheer_burst":
        # Layered stadium confetti — gold / teal / coral / white
        add_keyed_sparks(220, (0, 0, 0.1), int(frames * 0.26), frames - 2, studio.GOLD, 4.2, 0.048, 301, 18)
        add_keyed_sparks(180, (0, 0, 0.1), int(frames * 0.27), frames - 2, studio.TEAL, 3.9, 0.042, 302, 16)
        add_keyed_sparks(140, (0, 0, 0.05), int(frames * 0.28), frames - 3, (1.0, 0.32, 0.28, 1), 3.7, 0.04, 303, 17)
        add_keyed_sparks(100, (0, 0, 0.15), int(frames * 0.30), frames - 4, (0.98, 0.98, 1.0, 1), 3.4, 0.036, 304, 14)
        add_keyed_sparks(90, (0, 0, -0.05), int(frames * 0.32), frames - 2, (1.0, 0.85, 0.2, 1), 3.2, 0.038, 305, 15)
    elif gift_id == "fire":
        warm_fire_emission()
        add_keyed_sparks(160, (0, 0, 0.35), int(frames * 0.18), int(frames * 0.95), (1.0, 0.35, 0.05, 1), 2.4, 0.038, 401, 15)
        add_keyed_sparks(120, (0, 0, 0.1), int(frames * 0.22), frames - 2, (1.0, 0.55, 0.1, 1), 2.8, 0.032, 402, 14)
        add_keyed_sparks(80, (0.1, 0, 0.55), int(frames * 0.30), int(frames * 0.9), (1.0, 0.72, 0.18, 1), 2.0, 0.028, 403, 12)

    studio.setup_render(frames, os.path.join(out_dir, "frame_"))
    bpy.context.scene.render.filepath = os.path.join(out_dir, "frame_")
    bpy.ops.render.render(animation=True)
    print(f"[pass3] Done {gift_id}")


def main():
    # Parse --gift from argv after --
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
