"""Pass 2: keyed spark bursts + fire retune. Re-renders all 5 heroes."""
import math
import os
import random
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# Satisfy studio argparse
if "--" not in sys.argv:
    sys.argv += ["--", "--gift", "all", "--res", "720", "1280", "--samples", "48"]

import importlib.util

spec = importlib.util.spec_from_file_location("studio", os.path.join(HERE, "render_studio_gifts.py"))
studio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)


def add_keyed_sparks(count, origin, start_f, end_f, color, speed=2.8, size=0.04, seed=1):
    rng = random.Random(seed)
    for i in range(count):
        mesh = bpy.data.meshes.new(f"SparkM{seed}_{i}")
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size * (0.6 + rng.random() * 0.8))
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(f"Spark{seed}_{i}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(studio.mat_emit(f"SparkMat{seed}_{i}", color, 14.0 + rng.random() * 8))
        obj.scale = (0.01, 0.01, 0.01)
        obj.location = origin
        obj.keyframe_insert("scale", frame=max(1, start_f - 1))
        obj.keyframe_insert("location", frame=max(1, start_f - 1))
        obj.scale = (1, 1, 1)
        obj.keyframe_insert("scale", frame=start_f)
        ang = rng.random() * math.pi * 2
        elev = (rng.random() - 0.25) * math.pi * 0.7
        dist = speed * (0.7 + rng.random())
        obj.location = (
            origin[0] + math.cos(ang) * math.cos(elev) * dist,
            origin[1] + math.sin(ang) * math.cos(elev) * dist,
            origin[2] + math.sin(elev) * dist + 0.25,
        )
        obj.keyframe_insert("location", frame=end_f)
        obj.scale = (0.01, 0.01, 0.01)
        obj.keyframe_insert("scale", frame=min(end_f + 6, end_f + 1))


def retune_fire_emission():
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        for slot in ob.material_slots:
            m = slot.material
            if not m or not getattr(m, "use_nodes", False):
                continue
            for n in m.node_tree.nodes:
                if n.type == "EMISSION":
                    n.inputs[1].default_value = min(float(n.inputs[1].default_value), 5.5)
                    c = list(n.inputs[0].default_value)
                    if c[0] > 0.85 and c[1] > 0.85 and c[2] > 0.85:
                        n.inputs[0].default_value = (1.0, 0.42, 0.08, 1.0)
                    elif c[1] > 0.7 and c[2] < 0.3:
                        # keep warm
                        n.inputs[0].default_value = (1.0, 0.55, 0.12, 1.0)


def render_one(gift_id):
    frames = studio.GIFT_FRAMES[gift_id]
    out_dir = os.path.join(studio.OUTDIR, gift_id)
    os.makedirs(out_dir, exist_ok=True)
    print(f"[pass2] Building {gift_id}")
    studio.BUILDERS[gift_id](frames)

    if gift_id == "fire":
        retune_fire_emission()
        add_keyed_sparks(100, (0, 0, 0.5), int(frames * 0.25), int(frames * 0.9), (1.0, 0.45, 0.08, 1), 2.0, 0.036, 11)
    elif gift_id == "cheer_burst":
        add_keyed_sparks(150, (0, 0, 0.1), int(frames * 0.28), frames - 4, studio.GOLD, 3.6, 0.045, 22)
        add_keyed_sparks(120, (0, 0, 0.1), int(frames * 0.28), frames - 4, studio.TEAL, 3.3, 0.04, 23)
        add_keyed_sparks(80, (0, 0, 0.1), int(frames * 0.3), frames - 4, (1, 0.35, 0.3, 1), 3.1, 0.038, 24)
    elif gift_id == "diamond":
        add_keyed_sparks(130, (0, 0, 0), int(frames * 0.32), int(frames * 0.8), studio.TEAL, 3.9, 0.034, 33)
        add_keyed_sparks(90, (0, 0, 0), int(frames * 0.34), int(frames * 0.85), studio.GOLD, 3.5, 0.03, 34)
    elif gift_id == "rocket":
        add_keyed_sparks(140, (0, 0, 0.55), int(frames * 0.26), int(frames * 0.72), studio.GOLD, 4.1, 0.038, 41)
        add_keyed_sparks(80, (0, 0, 0.55), int(frames * 0.26), int(frames * 0.68), (1.0, 0.55, 0.15, 1), 3.6, 0.032, 42)
    elif gift_id == "crown":
        add_keyed_sparks(160, (0, 0, 0.35), int(frames * 0.40), int(frames * 0.92), studio.GOLD, 2.9, 0.032, 51)

    studio.setup_render(frames, os.path.join(out_dir, "frame_"))
    bpy.context.scene.render.filepath = os.path.join(out_dir, "frame_")
    bpy.ops.render.render(animation=True)
    print(f"[pass2] Done {gift_id}")


def main():
    for g in ("rocket", "crown", "diamond", "cheer_burst", "fire"):
        render_one(g)


if __name__ == "__main__":
    main()
