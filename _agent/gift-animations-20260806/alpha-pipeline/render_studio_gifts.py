"""
Blyp studio gift masters — proper modeled heroes, HDRI lit, EEVEE bloom, particles.
Transparent film PNG sequences for alpha encode.

Usage:
  blender -b -P render_studio_gifts.py -- --gift rocket --res 720 1280 --fps 30
  blender -b -P render_studio_gifts.py -- --gift all
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector, noise

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--gift", default="all")
ap.add_argument("--res", nargs=2, type=int, default=[720, 1280])
ap.add_argument("--fps", type=int, default=30)
ap.add_argument("--samples", type=int, default=64)
ap.add_argument("--hdri", default="")
args = ap.parse_args(ARGV)

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, "_frames_studio")
W, H = args.res
FPS = args.fps
HDRI = args.hdri or os.path.join(HERE, "hdri", "studio_small_09_2k.hdr")
if not os.path.isfile(HDRI):
    HDRI = os.path.join(HERE, "hdri", "studio_small_09_1k.hdr")

GIFT_FRAMES = {
    "rocket": 102,
    "crown": 96,
    "diamond": 99,
    "cheer_burst": 96,
    "fire": 99,
}

TEAL = (0.0, 0.82, 0.745, 1.0)
GOLD = (1.0, 0.76, 0.22, 1.0)
CHROME = (0.9, 0.92, 0.95, 1.0)


# ---------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------

def wipe():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.lights,
        bpy.data.cameras,
        bpy.data.particles,
        bpy.data.curves,
        bpy.data.worlds,
        bpy.data.images,
    ):
        for b in list(coll):
            try:
                coll.remove(b)
            except Exception:
                pass


def link(obj):
    if obj.name not in bpy.context.collection.objects:
        bpy.context.collection.objects.link(obj)
    return obj


def new_mesh_obj(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    return link(obj)


def apply_subsurf(obj, levels=2, render=3):
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = render
    return mod


def apply_bevel(obj, width=0.012, segments=3):
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    return mod


def shade_smooth(obj):
    for poly in obj.data.polygons:
        poly.use_smooth = True


def set_origin_geometry(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    obj.select_set(False)


def mat_pbr(
    name,
    base,
    metallic=0.0,
    roughness=0.3,
    clearcoat=0.0,
    transmission=0.0,
    ior=1.45,
    emission=None,
    emit_str=0.0,
    alpha=1.0,
):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    if alpha < 1.0:
        m.blend_method = "HASHED"
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf is None:
        nt.nodes.clear()
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = clearcoat
    elif "Clearcoat" in bsdf.inputs:
        bsdf.inputs["Clearcoat"].default_value = clearcoat
    if transmission > 0:
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = transmission
        elif "Transmission" in bsdf.inputs:
            bsdf.inputs["Transmission"].default_value = transmission
        if "IOR" in bsdf.inputs:
            bsdf.inputs["IOR"].default_value = ior
    if emission is not None:
        key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
        bsdf.inputs[key].default_value = emission
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emit_str
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = alpha
    return m


def mat_emit(name, color, strength=8.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = color
    em.inputs[1].default_value = strength
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def setup_world_hdri(path, strength=1.15):
    world = bpy.data.worlds.new("StudioHDRI")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    mapn = nt.nodes.new("ShaderNodeMapping")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    if os.path.isfile(path):
        env.image = bpy.data.images.load(path)
    bg.inputs["Strength"].default_value = strength
    nt.links.new(coord.outputs["Generated"], mapn.inputs["Vector"])
    nt.links.new(mapn.outputs["Vector"], env.inputs["Vector"])
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    # Keep HDRI for lighting/reflections; film_transparent kills BG plate
    mapn.inputs["Rotation"].default_value[2] = math.radians(35)


def setup_compositor_glare():
    """Blender 5.x compositing API changed — soft-fail; use emissive glow meshes."""
    scene = bpy.context.scene
    nt = getattr(scene, "node_tree", None)
    if nt is None:
        try:
            scene.use_nodes = True
            nt = getattr(scene, "node_tree", None)
        except Exception:
            nt = None
    if nt is None:
        print("[studio] compositor unavailable — emissive glow only")
        return
    try:
        scene.render.use_compositing = True
        nt.nodes.clear()
        rl = nt.nodes.new("CompositorNodeRLayers")
        glare = nt.nodes.new("CompositorNodeGlare")
        if hasattr(glare, "glare_type"):
            for gt in ("BLOOM", "FOG_GLOW"):
                try:
                    glare.glare_type = gt
                    break
                except Exception:
                    continue
        for attr, val in (("threshold", 0.5), ("size", 7), ("mix", 0.4)):
            if hasattr(glare, attr):
                try:
                    setattr(glare, attr, val)
                except Exception:
                    pass
        comp = nt.nodes.new("CompositorNodeComposite")
        nt.links.new(rl.outputs[0], glare.inputs[0])
        nt.links.new(glare.outputs[0], comp.inputs[0])
    except Exception as e:
        print("[studio] compositor setup skipped:", e)



def setup_render(frames, out_pattern):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = W
    scene.render.resolution_y = H
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = frames
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = out_pattern
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.45

    ee = scene.eevee
    if hasattr(ee, "taa_render_samples"):
        ee.taa_render_samples = args.samples
    # Legacy bloom (Blender ≤4)
    if hasattr(ee, "use_bloom"):
        ee.use_bloom = True
        ee.bloom_threshold = 0.45
        ee.bloom_intensity = 0.42
        ee.bloom_radius = 6.5
    if hasattr(ee, "use_gtao"):
        ee.use_gtao = True
    if hasattr(ee, "use_raytracing"):
        ee.use_raytracing = True
    if hasattr(ee, "use_ssr"):
        ee.use_ssr = True
        if hasattr(ee, "use_ssr_refraction"):
            ee.use_ssr_refraction = True
    if hasattr(ee, "use_soft_shadows"):
        ee.use_soft_shadows = True
    scene.view_settings.view_transform = "Filmic"
    try:
        scene.view_settings.look = "High Contrast"
    except Exception:
        pass
    scene.view_settings.exposure = 0.45
    setup_compositor_glare()

def add_camera(loc=(0, -4.2, 0.35), lens=28, track_to=None):
    """Closer / wider so hero fills ~60–80% of frame (TikTok gift scale)."""
    cam_data = bpy.data.cameras.new("GiftCam")
    cam_data.lens = lens
    cam = bpy.data.objects.new("GiftCam", cam_data)
    link(cam)
    cam.location = loc
    cam.rotation_euler = Euler((math.radians(86), 0, 0), "XYZ")
    bpy.context.scene.camera = cam
    if track_to is not None:
        c = cam.constraints.new(type="TRACK_TO")
        c.target = track_to
        c.track_axis = "TRACK_NEGATIVE_Z"
        c.up_axis = "UP_Y"
    return cam


def add_lights():
    # Key
    kd = bpy.data.lights.new("Key", "AREA")
    kd.energy = 280
    kd.color = (1.0, 0.96, 0.88)
    kd.size = 2.4
    ko = bpy.data.objects.new("Key", kd)
    link(ko)
    ko.location = (2.8, -2.2, 3.4)
    ko.rotation_euler = Euler((math.radians(-40), math.radians(20), math.radians(30)), "XYZ")
    # Rim teal
    rd = bpy.data.lights.new("Rim", "AREA")
    rd.energy = 180
    rd.color = (0.2, 0.95, 0.9)
    rd.size = 1.6
    ro = bpy.data.objects.new("Rim", rd)
    link(ro)
    ro.location = (-3.0, 1.5, 1.8)
    # Gold kick
    gd = bpy.data.lights.new("GoldKick", "POINT")
    gd.energy = 120
    gd.color = (1.0, 0.75, 0.25)
    go = bpy.data.objects.new("GoldKick", gd)
    link(go)
    go.location = (1.2, 0.4, -0.6)
    # Fill
    fd = bpy.data.lights.new("Fill", "AREA")
    fd.energy = 60
    fd.color = (0.7, 0.8, 1.0)
    fd.size = 3.0
    fo = bpy.data.objects.new("Fill", fd)
    link(fo)
    fo.location = (0, -3.5, 0.2)


def kf_loc(obj, f, loc):
    obj.location = loc
    obj.keyframe_insert("location", frame=f)


def kf_rot(obj, f, deg):
    obj.rotation_euler = Euler(tuple(math.radians(a) for a in deg), "XYZ")
    obj.keyframe_insert("rotation_euler", frame=f)


def kf_scale(obj, f, s):
    if isinstance(s, (int, float)):
        s = (s, s, s)
    obj.scale = s
    obj.keyframe_insert("scale", frame=f)


def ease_keys(obj, data_path="location"):
    """Best-effort bezier easing; Blender 5.x action layers differ — skip if unavailable."""
    try:
        ad = obj.animation_data
        if not ad or not ad.action:
            return
        action = ad.action
        fcurves = getattr(action, "fcurves", None)
        if fcurves is None and hasattr(action, "layers"):
            # Blender 5 layered actions — leave defaults
            return
        if not fcurves:
            return
        for fc in fcurves:
            if data_path in fc.data_path:
                for kp in fc.keyframe_points:
                    kp.interpolation = "BEZIER"
                    kp.handle_left_type = "AUTO_CLAMPED"
                    kp.handle_right_type = "AUTO_CLAMPED"
    except Exception:
        pass


def make_torus_obj(name, major=0.5, minor=0.05, major_seg=48, minor_seg=12):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=major_seg,
        minor_segments=minor_seg,
        location=(0, 0, 0),
    )
    obj = bpy.context.object
    obj.name = name
    return obj


def make_uvsphere_obj(name, radius=0.2, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius, segments=segments, ring_count=rings, location=(0, 0, 0)
    )
    obj = bpy.context.object
    obj.name = name
    return obj


def make_icosphere_mesh(name, radius=0.2, subdivisions=2):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    return new_mesh_obj(name, mesh)


def make_spark_instance(name, color=GOLD, size=0.035):
    obj = make_icosphere_mesh(name, radius=size, subdivisions=1)
    obj.data.materials.append(mat_emit(name + "Mat", color, 14.0))
    # Must remain renderable for particle OBJECT instances — park off-camera
    obj.location = (0, 0, -50)
    obj.hide_viewport = True
    obj.hide_render = False
    return obj


def add_burst_particles(emitter, spark, count=400, life=34, vel=4.2, start=1, end=12, gravity=0.25):
    mod = emitter.modifiers.new("Burst", "PARTICLE_SYSTEM")
    ps = emitter.particle_systems[-1]
    st = ps.settings
    st.count = count
    st.frame_start = start
    st.frame_end = end
    st.lifetime = life
    st.emit_from = "FACE"
    st.physics_type = "NEWTON"
    st.normal_factor = vel
    st.factor_random = 0.65
    st.tangent_factor = 0.4
    st.particle_size = 1.0
    st.size_random = 0.55
    st.render_type = "OBJECT"
    st.instance_object = spark
    st.use_rotations = True
    st.angular_velocity_mode = "VELOCITY"
    if hasattr(st, "effector_weights"):
        st.effector_weights.gravity = gravity
    return st


# ---------------------------------------------------------------------------
# Geometry builders (real modeling)
# ---------------------------------------------------------------------------

def build_rocket_mesh():
    """Streamlined metallic rocket with nose, body, fins, nozzle."""
    mesh = bpy.data.meshes.new("RocketMesh")
    bm = bmesh.new()

    # Body: tapered cylinder via cone frustum approximation
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=48,
        radius1=0.42,
        radius2=0.28,
        depth=1.85,
    )
    # Move body
    for v in bm.verts:
        v.co.z += 0.15

    # Nose cone
    geom = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=32,
        radius1=0.28,
        radius2=0.02,
        depth=0.7,
    )
    for v in geom["verts"]:
        v.co.z += 1.42

    # Nozzle
    nozzle = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=32,
        radius1=0.22,
        radius2=0.36,
        depth=0.35,
    )
    for v in nozzle["verts"]:
        v.co.z -= 1.05

    bm.to_mesh(mesh)
    bm.free()
    body = new_mesh_obj("RocketBody", mesh)
    shade_smooth(body)
    apply_bevel(body, 0.008, 3)
    apply_subsurf(body, 1, 2)

    chrome = mat_pbr("RocketChrome", CHROME, metallic=1.0, roughness=0.18, clearcoat=0.65)
    gold = mat_pbr("RocketGold", GOLD, metallic=1.0, roughness=0.22, clearcoat=0.4, emission=GOLD, emit_str=0.25)
    teal = mat_pbr("RocketTeal", TEAL, metallic=0.85, roughness=0.28, clearcoat=0.3, emission=TEAL, emit_str=0.35)
    body.data.materials.append(chrome)

    # Nose tip accent (separate for gold)
    tip_mesh = bpy.data.meshes.new("NoseTip")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.12, radius2=0.01, depth=0.28)
    bm.to_mesh(tip_mesh)
    bm.free()
    tip = new_mesh_obj("NoseTip", tip_mesh)
    tip.location = (0, 0, 1.72)
    tip.data.materials.append(gold)
    shade_smooth(tip)
    apply_subsurf(tip, 1, 2)

    # Fins — thick swept blades (solid cubes shaped)
    fins = []
    for i in range(4):
        ang = i * 90
        fm = bpy.data.meshes.new(f"Fin{i}")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        # Taper into a fin silhouette
        for v in bm.verts:
            # squash
            v.co.y *= 0.07
            v.co.x = (v.co.x + 0.5) * 0.55  # 0..1 along X
            v.co.z = (v.co.z + 0.5) * 0.75 - 0.55
            # taper tip
            if v.co.x > 0.35:
                v.co.z *= 0.55
                v.co.y *= 0.5
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(fm)
        bm.free()
        fin = new_mesh_obj(f"Fin{i}", fm)
        fin.rotation_euler.z = math.radians(ang)
        fin.location = (
            math.cos(math.radians(ang)) * 0.38,
            math.sin(math.radians(ang)) * 0.38,
            -0.55,
        )
        fin.data.materials.append(teal)
        shade_smooth(fin)
        apply_bevel(fin, 0.012, 3)
        apply_subsurf(fin, 1, 2)
        fins.append(fin)

    # Exhaust glow — layered colored plume
    for ei, (depth, r1, r2, col, stren, zoff) in enumerate(
        (
            (1.4, 0.2, 0.04, (1.0, 0.75, 0.25, 1), 28.0, -1.65),
            (1.1, 0.28, 0.06, (1.0, 0.4, 0.08, 1), 18.0, -1.55),
            (0.7, 0.34, 0.1, (0.4, 0.7, 1.0, 1), 10.0, -1.4),
        )
    ):
        ex_mesh = bpy.data.meshes.new(f"Exhaust{ei}")
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=r1, radius2=r2, depth=depth)
        bm.to_mesh(ex_mesh)
        bm.free()
        plume = new_mesh_obj(f"Exhaust{ei}", ex_mesh)
        plume.location = (0, 0, zoff)
        plume.data.materials.append(mat_emit(f"ExhaustMat{ei}", col, stren))
        shade_smooth(plume)
        apply_subsurf(plume, 1, 2)
        if ei == 0:
            exhaust = plume

    # Window band
    ring_mesh = bpy.data.meshes.new("Window")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=0.405, radius2=0.38, depth=0.18)
    bm.to_mesh(ring_mesh)
    bm.free()
    window = new_mesh_obj("Window", ring_mesh)
    window.location = (0, 0, 0.55)
    window.data.materials.append(
        mat_pbr("WindowMat", TEAL, metallic=0.3, roughness=0.1, transmission=0.55, emission=TEAL, emit_str=2.4)
    )
    shade_smooth(window)

    empty = bpy.data.objects.new("RocketRoot", None)
    link(empty)
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and o.name.startswith(("Rocket", "Nose", "Fin", "Exhaust", "Window")):
            o.parent = empty
    return empty, exhaust


def build_crown_mesh():
    """Jeweled royal crown — band + fleur spikes + gems."""
    gold = mat_pbr("CrownGold", GOLD, metallic=1.0, roughness=0.16, clearcoat=0.85, emission=GOLD, emit_str=0.2)
    jewel_teal = mat_pbr(
        "JewelTeal", TEAL, metallic=0.05, roughness=0.05, transmission=0.85, ior=2.2, emission=TEAL, emit_str=0.9
    )
    jewel_ruby = mat_pbr(
        "JewelRuby", (0.95, 0.15, 0.25, 1), metallic=0.05, roughness=0.05, transmission=0.8, ior=2.0, emission=(1, 0.2, 0.3, 1), emit_str=0.7
    )

    # Band
    band_mesh = bpy.data.meshes.new("Band")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=0.95, radius2=0.92, depth=0.32)
    bm.to_mesh(band_mesh)
    bm.free()
    band = new_mesh_obj("Band", band_mesh)
    band.data.materials.append(gold)
    shade_smooth(band)
    apply_bevel(band, 0.01, 3)
    apply_subsurf(band, 1, 2)

    # Inner velvet hint
    velvet = make_uvsphere_obj("Velvet", radius=0.78, segments=32, rings=16)
    velvet.scale = (1, 1, 0.45)
    velvet.location.z = 0.05
    velvet.data.materials.append(mat_pbr("VelvetMat", (0.08, 0.18, 0.2, 1), metallic=0.0, roughness=0.85, emission=TEAL, emit_str=0.15))
    shade_smooth(velvet)

    spikes = []
    gems = []
    for i in range(8):
        ang = i * 45
        rad = 0.82
        x = math.cos(math.radians(ang)) * rad
        y = math.sin(math.radians(ang)) * rad
        # Spike
        sm = bpy.data.meshes.new(f"Spike{i}")
        bm = bmesh.new()
        # Cross-section fleur-ish: tall diamond prism
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.14 if i % 2 == 0 else 0.1, radius2=0.015, depth=0.7 if i % 2 == 0 else 0.48)
        bm.to_mesh(sm)
        bm.free()
        spike = new_mesh_obj(f"Spike{i}", sm)
        spike.location = (x, y, 0.45 if i % 2 == 0 else 0.35)
        spike.rotation_euler.z = math.radians(ang)
        spike.data.materials.append(gold)
        shade_smooth(spike)
        apply_bevel(spike, 0.008, 2)
        apply_subsurf(spike, 1, 2)
        spikes.append(spike)
        # Gem on tip
        gm = bpy.data.meshes.new(f"Gem{i}")
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.09 if i % 2 == 0 else 0.07)
        bm.to_mesh(gm)
        bm.free()
        gem = new_mesh_obj(f"Gem{i}", gm)
        gem.location = (x, y, 0.85 if i % 2 == 0 else 0.62)
        gem.data.materials.append(jewel_teal if i % 2 == 0 else jewel_ruby)
        shade_smooth(gem)
        apply_subsurf(gem, 1, 2)
        gems.append(gem)

    # Cross on top (regal)
    for axis in ("x", "y"):
        cm = bpy.data.meshes.new(f"Cross{axis}")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(cm)
        bm.free()
        cross = new_mesh_obj(f"Cross{axis}", cm)
        if axis == "x":
            cross.scale = (0.35, 0.06, 0.06)
        else:
            cross.scale = (0.06, 0.06, 0.4)
        cross.location = (0, 0, 1.05)
        cross.data.materials.append(gold)
        shade_smooth(cross)
        apply_bevel(cross, 0.01, 2)
        spikes.append(cross)

    orb_m = bpy.data.meshes.new("Orb")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.1)
    bm.to_mesh(orb_m)
    bm.free()
    orb = new_mesh_obj("Orb", orb_m)
    orb.location = (0, 0, 1.28)
    orb.data.materials.append(jewel_teal)
    shade_smooth(orb)

    root = bpy.data.objects.new("CrownRoot", None)
    link(root)
    for o in [band, velvet, orb] + spikes + gems:
        o.parent = root
    return root


def build_brilliant_diamond():
    """Approximate brilliant-cut diamond with pavilion + crown facets."""
    mesh = bpy.data.meshes.new("Diamond")
    bm = bmesh.new()

    # Crown (top) — flat table + bezel
    table_r = 0.45
    girdle_r = 0.95
    crown_h = 0.35
    pavilion_h = 0.85

    # Table ring
    table_verts = []
    girdle_verts = []
    n = 16
    for i in range(n):
        a = (i / n) * math.pi * 2
        table_verts.append(bm.verts.new((math.cos(a) * table_r, math.sin(a) * table_r, crown_h)))
        girdle_verts.append(bm.verts.new((math.cos(a) * girdle_r, math.sin(a) * girdle_r, 0.0)))
    # Table face
    bm.faces.new(table_verts)
    # Crown facets
    for i in range(n):
        bm.faces.new((table_verts[i], table_verts[(i + 1) % n], girdle_verts[(i + 1) % n], girdle_verts[i]))

    # Culet
    culet = bm.verts.new((0, 0, -pavilion_h))
    for i in range(n):
        bm.faces.new((girdle_verts[i], girdle_verts[(i + 1) % n], culet))

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # Slight irregularity for caustics interest
    for v in bm.verts:
        if abs(v.co.z) > 0.01 and abs(v.co.z + pavilion_h) > 0.01:
            v.co += Vector((noise.noise(v.co * 3.0) * 0.01, noise.noise(v.co * 3.1) * 0.01, 0))

    bm.to_mesh(mesh)
    bm.free()
    dia = new_mesh_obj("Diamond", mesh)
    shade_smooth(dia)
    apply_bevel(dia, 0.004, 2)
    crystal = mat_pbr(
        "Crystal",
        (0.85, 0.95, 1.0, 1),
        metallic=0.0,
        roughness=0.02,
        clearcoat=1.0,
        transmission=0.95,
        ior=2.42,
        emission=TEAL,
        emit_str=0.45,
    )
    dia.data.materials.append(crystal)
    return dia


def build_cheer_props():
    """Stadium confetti cannon — many small chips + wash streaks (Filmic-safe emit)."""
    root = bpy.data.objects.new("CheerRoot", None)
    link(root)

    core_m = bpy.data.meshes.new("Core")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.32)
    bm.to_mesh(core_m)
    bm.free()
    core = new_mesh_obj("Core", core_m)
    # Keep emit moderate so Filmic preserves gold hue
    core.data.materials.append(mat_emit("CoreMat", (1.0, 0.62, 0.12, 1), 3.2))
    shade_smooth(core)
    apply_subsurf(core, 1, 2)
    core.parent = root

    colors = [
        (1.0, 0.62, 0.1, 1),   # saturated gold
        (0.0, 0.88, 0.78, 1),  # teal
        (1.0, 0.28, 0.22, 1),  # coral
        (0.95, 0.92, 0.85, 1), # soft white
        (0.15, 0.95, 0.45, 1), # green
        (1.0, 0.72, 0.08, 1),  # amber
        (1.0, 0.42, 0.08, 1),  # orange
        (0.35, 0.75, 1.0, 1),  # sky
        (1.0, 0.18, 0.38, 1),  # pink
    ]
    ribbons = []
    rng = random.Random(42)
    for i in range(160):
        rm = bpy.data.meshes.new(f"Rib{i}")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(rm)
        bm.free()
        rib = new_mesh_obj(f"Rib{i}", rm)
        # Mostly small chips; occasional longer streamer
        if i % 7 == 0:
            rib.scale = (0.028, 0.16 + rng.random() * 0.1, 0.006)
        else:
            rib.scale = (0.018 + rng.random() * 0.012, 0.05 + rng.random() * 0.06, 0.005)
        col = colors[i % len(colors)]
        rib.data.materials.append(mat_emit(f"RibMat{i}", col, 2.4 + rng.random() * 1.6))
        shade_smooth(rib)
        rib.parent = root
        ribbons.append(rib)

    # Stadium light streaks — thin rods, modest emit
    streaks = []
    for i in range(18):
        ang = i * 20
        sm = bpy.data.meshes.new(f"Streak{i}")
        bm = bmesh.new()
        depth = 3.2 if i % 2 == 0 else 2.5
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.022, radius2=0.004, depth=depth)
        bm.to_mesh(sm)
        bm.free()
        st = new_mesh_obj(f"Streak{i}", sm)
        st.rotation_euler = Euler((math.radians(88 + (i % 3)), 0, math.radians(ang)), "XYZ")
        st.data.materials.append(mat_emit(f"StreakMat{i}", TEAL if i % 2 == 0 else GOLD, 3.8))
        st.parent = root
        streaks.append(st)

    return root, core, ribbons, streaks


def build_fire_column():
    """Warm orange flame column — Filmic-safe strengths so hue survives."""
    root = bpy.data.objects.new("FireRoot", None)
    link(root)

    layers = []
    for i in range(12):
        t = i / 11
        rad = 0.58 * (1.0 - t * 0.76)
        z = -1.0 + i * 0.3
        fm = bpy.data.meshes.new(f"Flame{i}")
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=rad)
        for v in bm.verts:
            if v.co.z > 0:
                v.co.z *= 1.65
                v.co.x *= 0.82
                v.co.y *= 0.82
            n = noise.noise(v.co * 2.8 + Vector((i * 0.4, 0.2, 0)))
            v.co += Vector((n * 0.05, n * 0.035, abs(n) * 0.06))
        bm.to_mesh(fm)
        bm.free()
        flame = new_mesh_obj(f"Flame{i}", fm)
        flame.location.z = z
        heat = 1.0 - t * 0.7
        # Red-orange base → amber tip (darker so Standard doesn't clip white)
        col = (1.0, 0.08 + 0.22 * heat, 0.01 + 0.02 * heat, 1.0)
        strength = 1.15 + (1.0 - t) * 1.6
        flame.data.materials.append(mat_emit(f"FlameMat{i}", col, strength))
        shade_smooth(flame)
        apply_subsurf(flame, 1, 2)
        flame.parent = root
        layers.append(flame)

    # Inner hot core — amber, not white
    core_m = bpy.data.meshes.new("FireCore")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.18)
    for v in bm.verts:
        if v.co.z > 0:
            v.co.z *= 1.9
    bm.to_mesh(core_m)
    bm.free()
    fcore = new_mesh_obj("FireCore", core_m)
    fcore.location.z = -0.4
    fcore.data.materials.append(mat_emit("FireCoreMat", (1.0, 0.32, 0.04, 1), 2.8))
    shade_smooth(fcore)
    fcore.parent = root
    layers.append(fcore)

    # Outer red wrap layers for warmth
    for wi, (rad, z) in enumerate(((0.72, -0.85), (0.55, -0.35), (0.4, 0.25))):
        wm = bpy.data.meshes.new(f"Wrap{wi}")
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=rad)
        for v in bm.verts:
            if v.co.z > 0:
                v.co.z *= 1.4
        bm.to_mesh(wm)
        bm.free()
        wrap = new_mesh_obj(f"FireWrap{wi}", wm)
        wrap.location.z = z
        wrap.data.materials.append(mat_emit(f"WrapMat{wi}", (1.0, 0.12, 0.02, 1), 1.4))
        shade_smooth(wrap)
        wrap.parent = root
        layers.append(wrap)

    # Dense ember field
    embers = []
    rng = random.Random(7)
    for i in range(200):
        ang = rng.random() * math.pi * 2
        r = 0.08 + rng.random() * 1.5
        em = bpy.data.meshes.new(f"Ember{i}")
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.012 + rng.random() * 0.022)
        bm.to_mesh(em)
        bm.free()
        e = new_mesh_obj(f"Ember{i}", em)
        e.location = (math.cos(ang) * r, math.sin(ang) * r, -1.2 + rng.random() * 2.0)
        warm = (1.0, 0.14 + rng.random() * 0.2, 0.015 + rng.random() * 0.03, 1)
        e.data.materials.append(mat_emit(f"EmberMat{i}", warm, 2.0 + rng.random() * 1.8))
        e.parent = root
        embers.append(e)

    # Soft ground glow — tiny torus, not opaque plates
    ring = make_torus_obj("HeatRing", major=0.85, minor=0.04, major_seg=48, minor_seg=10)
    ring.location.z = -0.95
    ring.data.materials.append(mat_emit("HeatRingMat", (1.0, 0.2, 0.02, 1), 1.8))
    shade_smooth(ring)
    ring.parent = root

    return root, layers, embers


# ---------------------------------------------------------------------------
# Per-gift scenes + animation
# ---------------------------------------------------------------------------

def scene_base():
    wipe()
    setup_world_hdri(HDRI, strength=1.25)
    add_lights()


def animate_rocket(frames):
    scene_base()
    root, exhaust = build_rocket_mesh()
    add_camera(loc=(0.1, -4.4, 0.55), lens=28, track_to=root)

    spark = make_spark_instance("RocketSpark", GOLD, 0.03)
    spark2 = make_spark_instance("RocketSpark2", (1.0, 0.6, 0.2, 1), 0.025)

    # Exhaust plume scale pulse
    kf_scale(exhaust, 1, (0.6, 0.6, 0.5))
    kf_scale(exhaust, int(frames * 0.25), (1.1, 1.1, 1.4))
    kf_scale(exhaust, int(frames * 0.28), (1.6, 1.6, 1.8))
    kf_scale(exhaust, frames, (0.3, 0.3, 0.8))

    kf_loc(root, 1, (0, 0, -2.4))
    kf_rot(root, 1, (-12, 8, -15))
    kf_scale(root, 1, 0.7)
    kf_loc(root, int(frames * 0.28), (0, 0, 0.55))
    kf_rot(root, int(frames * 0.28), (5, -4, 25))
    kf_scale(root, int(frames * 0.28), 1.12)
    kf_loc(root, int(frames * 0.55), (0.1, 0, 1.5))
    kf_scale(root, int(frames * 0.55), 0.45)
    kf_loc(root, frames, (0.2, 0, 2.6))
    kf_rot(root, frames, (0, 0, 90))
    kf_scale(root, frames, 0.08)
    ease_keys(root)

    # Shockwave torus
    shock = make_torus_obj("Shock", major=0.35, minor=0.035, major_seg=48, minor_seg=12)
    shock.location = (0, 0, 0.55)
    shock.data.materials.append(mat_emit("ShockMat", GOLD, 16.0))
    shade_smooth(shock)
    kf_scale(shock, int(frames * 0.26), 0.15)
    kf_scale(shock, int(frames * 0.30), 0.4)
    kf_scale(shock, int(frames * 0.55), 4.2)
    kf_scale(shock, frames, 5.5)

    # Burst emitter
    emitter = make_uvsphere_obj("BurstEmit", radius=0.2, segments=16, rings=8)
    emitter.location = (0, 0, 0.55)
    emitter.hide_render = True
    add_burst_particles(emitter, spark, count=480, life=36, vel=5.0, start=int(frames * 0.26), end=int(frames * 0.32), gravity=0.2)
    # second system
    mod2 = emitter.modifiers.new("Burst2", "PARTICLE_SYSTEM")
    st = emitter.particle_systems[-1].settings
    st.count = 220
    st.frame_start = int(frames * 0.26)
    st.frame_end = int(frames * 0.34)
    st.lifetime = 40
    st.normal_factor = 3.2
    st.render_type = "OBJECT"
    st.instance_object = spark2

    setup_render(frames, os.path.join(OUTDIR, "rocket", "frame_"))


def animate_crown(frames):
    scene_base()
    root = build_crown_mesh()
    add_camera(loc=(0.15, -3.8, 0.7), lens=30, track_to=root)

    kf_loc(root, 1, (0, 0, 2.6))
    kf_rot(root, 1, (18, 0, -35))
    kf_scale(root, 1, 0.55)
    kf_loc(root, int(frames * 0.42), (0, 0, 0.05))
    kf_rot(root, int(frames * 0.42), (0, 0, 15))
    kf_scale(root, int(frames * 0.42), 1.15)
    kf_loc(root, frames, (0, 0, 0.0))
    kf_rot(root, frames, (0, 0, 40))
    kf_scale(root, frames, 1.0)
    ease_keys(root)

    # Halo
    halo = make_torus_obj("Halo", major=1.15, minor=0.025, major_seg=64, minor_seg=12)
    halo.location.z = -0.05
    halo.data.materials.append(mat_emit("HaloMat", GOLD, 8.0))
    shade_smooth(halo)
    kf_scale(halo, int(frames * 0.38), 0.2)
    kf_scale(halo, int(frames * 0.45), 1.05)
    kf_scale(halo, frames, 1.2)

    spark = make_spark_instance("CrownSpark", GOLD, 0.028)
    emitter = make_uvsphere_obj("CEmit", radius=0.25, segments=12, rings=8)
    emitter.location.z = 0.3
    emitter.hide_render = True
    add_burst_particles(emitter, spark, count=520, life=40, vel=3.6, start=int(frames * 0.40), end=int(frames * 0.48), gravity=0.35)

    # Light shaft
    sm = bpy.data.meshes.new("Shaft")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=0.55, radius2=0.08, depth=4.0)
    bm.to_mesh(sm)
    bm.free()
    shaft = new_mesh_obj("Shaft", sm)
    shaft.location.z = 1.5
    shaft.data.materials.append(mat_emit("ShaftMat", (1.0, 0.92, 0.65, 1), 3.5))
    kf_scale(shaft, 1, (0.4, 0.4, 1))
    kf_scale(shaft, int(frames * 0.42), (1, 1, 1))
    kf_scale(shaft, frames, (0.7, 0.7, 1))

    setup_render(frames, os.path.join(OUTDIR, "crown", "frame_"))


def animate_diamond(frames):
    scene_base()
    dia = build_brilliant_diamond()
    add_camera(loc=(0.2, -3.5, 0.4), lens=28, track_to=dia)

    # Prism beams
    beams = []
    for i in range(10):
        ang = i * 36
        bm_mesh = bpy.data.meshes.new(f"Beam{i}")
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.03, radius2=0.008, depth=3.4)
        bm.to_mesh(bm_mesh)
        bm.free()
        beam = new_mesh_obj(f"Beam{i}", bm_mesh)
        beam.rotation_euler = Euler((math.radians(90), 0, math.radians(ang)), "XYZ")
        beam.data.materials.append(mat_emit(f"BeamMat{i}", TEAL if i % 2 == 0 else GOLD, 11.0))
        beams.append(beam)

    kf_rot(dia, 1, (25, 10, 0))
    kf_scale(dia, 1, 0.35)
    kf_rot(dia, int(frames * 0.34), (15, 35, 200))
    kf_scale(dia, int(frames * 0.34), 1.2)
    kf_rot(dia, int(frames * 0.55), (5, 20, 340))
    kf_scale(dia, int(frames * 0.55), 0.25)
    kf_rot(dia, frames, (0, 0, 480))
    kf_scale(dia, frames, 0.05)
    ease_keys(dia)

    for i, beam in enumerate(beams):
        kf_scale(beam, 1, 0.05)
        kf_scale(beam, int(frames * 0.28), 0.2)
        kf_scale(beam, int(frames * 0.36), 1.05)
        kf_scale(beam, int(frames * 0.7), 0.15)

    spark = make_spark_instance("DiaSpark", TEAL, 0.026)
    emitter = make_uvsphere_obj("DEmit", radius=0.2, segments=12, rings=8)
    emitter.hide_render = True
    add_burst_particles(emitter, spark, count=560, life=32, vel=5.2, start=int(frames * 0.32), end=int(frames * 0.40), gravity=0.15)

    setup_render(frames, os.path.join(OUTDIR, "diamond", "frame_"))


def animate_cheer(frames):
    scene_base()
    root, core, ribbons, streaks = build_cheer_props()
    add_camera(loc=(0, -4.0, 0.55), lens=24, track_to=root)

    kf_scale(core, 1, 0.15)
    kf_scale(core, int(frames * 0.28), 1.35)
    kf_scale(core, int(frames * 0.5), 0.35)
    kf_scale(core, frames, 0.12)

    rng = random.Random(99)
    for i, rib in enumerate(ribbons):
        ring = i % 3
        ang = (i / max(1, len(ribbons))) * math.pi * 2 + ring * 0.4
        elev = (rng.random() - 0.15) * 0.95
        kf_loc(rib, 1, (0, 0, -0.2))
        kf_rot(rib, 1, (0, 0, i * 7))
        kf_scale(rib, 1, 0.15)
        impact = int(frames * 0.28) + (i % 4)
        dist = (1.35 + ring * 0.9) + rng.random() * 1.5
        ox = math.cos(ang) * math.cos(elev) * dist
        oy = math.sin(ang) * math.cos(elev) * dist
        oz = 0.15 + math.sin(elev) * dist * 0.9 + rng.random() * 1.3
        kf_loc(rib, impact, (ox * 0.2, oy * 0.2, 0.1))
        kf_scale(rib, impact, 1.0)
        kf_loc(rib, frames, (ox * 1.2, oy * 1.2, oz))
        kf_rot(rib, frames, (rng.random() * 420, rng.random() * 420, rng.random() * 420))
        kf_scale(rib, frames, 0.45 + rng.random() * 0.35)

    for i, st in enumerate(streaks):
        kf_scale(st, 1, 0.04)
        kf_scale(st, int(frames * 0.26), 0.3)
        kf_scale(st, int(frames * 0.38), 1.15 if i % 2 == 0 else 0.95)
        kf_scale(st, frames, 0.3)

    spark = make_spark_instance("CheerSpark", GOLD, 0.022)
    # Tone down spark emit for Filmic
    for slot in spark.material_slots:
        for n in slot.material.node_tree.nodes:
            if n.type == "EMISSION":
                n.inputs[1].default_value = 5.5
    spark2 = make_spark_instance("CheerSpark2", TEAL, 0.018)
    for slot in spark2.material_slots:
        for n in slot.material.node_tree.nodes:
            if n.type == "EMISSION":
                n.inputs[1].default_value = 5.0
    spark3 = make_spark_instance("CheerSpark3", (1.0, 0.35, 0.28, 1), 0.02)
    for slot in spark3.material_slots:
        for n in slot.material.node_tree.nodes:
            if n.type == "EMISSION":
                n.inputs[1].default_value = 5.0
    emitter = make_uvsphere_obj("ChEmit", radius=0.35, segments=16, rings=10)
    emitter.hide_render = True
    add_burst_particles(emitter, spark, count=1100, life=48, vel=6.0, start=int(frames * 0.24), end=int(frames * 0.38), gravity=0.35)
    mod2 = emitter.modifiers.new("Burst2", "PARTICLE_SYSTEM")
    st2 = emitter.particle_systems[-1].settings
    st2.count = 650
    st2.frame_start = int(frames * 0.26)
    st2.frame_end = int(frames * 0.42)
    st2.lifetime = 52
    st2.normal_factor = 4.6
    st2.factor_random = 0.8
    st2.render_type = "OBJECT"
    st2.instance_object = spark2
    if hasattr(st2, "effector_weights"):
        st2.effector_weights.gravity = 0.3
    mod3 = emitter.modifiers.new("Burst3", "PARTICLE_SYSTEM")
    st3 = emitter.particle_systems[-1].settings
    st3.count = 480
    st3.frame_start = int(frames * 0.28)
    st3.frame_end = int(frames * 0.44)
    st3.lifetime = 46
    st3.normal_factor = 5.2
    st3.render_type = "OBJECT"
    st3.instance_object = spark3

    setup_render(frames, os.path.join(OUTDIR, "cheer_burst", "frame_"))
    # Standard preserves confetti hue; Filmic crushes gold/teal to pastel
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.scene.view_settings.exposure = 0.0
    try:
        bpy.context.scene.view_settings.look = "None"
    except Exception:
        pass


def animate_fire(frames):
    scene_base()
    fd = bpy.data.lights.new("FireKick", "POINT")
    fd.energy = 90
    fd.color = (1.0, 0.4, 0.08)
    fo = bpy.data.objects.new("FireKick", fd)
    link(fo)
    fo.location = (0.4, -1.2, 0.2)

    root, layers, embers = build_fire_column()
    add_camera(loc=(0.12, -3.7, 0.4), lens=26, track_to=root)

    kf_scale(root, 1, 0.18)
    kf_scale(root, int(frames * 0.28), 1.2)
    kf_scale(root, frames, 1.05)
    ease_keys(root)

    for i, flame in enumerate(layers):
        z = flame.location.z
        side = ((i % 2) * 2 - 1)
        kf_loc(flame, 1, (0.03 * side, -0.03, z))
        kf_loc(flame, int(frames * 0.33), (-0.07 * side, 0.05, z + 0.12))
        kf_loc(flame, int(frames * 0.66), (0.06 * side, -0.04, z + 0.05))
        kf_loc(flame, frames, (0.025 * side, -0.02, z + 0.08))
        kf_scale(flame, 1, 0.88)
        kf_scale(flame, int(frames * 0.4), 1.08)
        kf_scale(flame, frames, 1.0)

    for i, e in enumerate(embers):
        base = e.location.copy()
        rise = 1.2 + (i % 7) * 0.2 + (i % 3) * 0.06
        kf_loc(e, 1, base)
        kf_loc(e, int(frames * 0.45), (base.x * 1.05, base.y * 1.05, base.z + rise * 0.45))
        kf_loc(e, frames, (base.x * 1.18, base.y * 1.14, base.z + rise))
        kf_scale(e, 1, 0.7)
        kf_scale(e, int(frames * 0.5), 1.1)
        kf_scale(e, frames, 0.3)

    spark = make_spark_instance("FireSpark", (1.0, 0.32, 0.05, 1), 0.02)
    for slot in spark.material_slots:
        for n in slot.material.node_tree.nodes:
            if n.type == "EMISSION":
                n.inputs[1].default_value = 4.5
    spark2 = make_spark_instance("FireSpark2", (1.0, 0.5, 0.08, 1), 0.015)
    for slot in spark2.material_slots:
        for n in slot.material.node_tree.nodes:
            if n.type == "EMISSION":
                n.inputs[1].default_value = 4.0
    emitter = make_uvsphere_obj("FEmit", radius=0.4, segments=16, rings=10)
    emitter.location.z = 0.15
    emitter.hide_render = True
    add_burst_particles(emitter, spark, count=900, life=54, vel=2.6, start=int(frames * 0.06), end=frames - 2, gravity=-0.75)
    mod2 = emitter.modifiers.new("Burst2", "PARTICLE_SYSTEM")
    st2 = emitter.particle_systems[-1].settings
    st2.count = 520
    st2.frame_start = int(frames * 0.12)
    st2.frame_end = frames - 4
    st2.lifetime = 42
    st2.normal_factor = 3.2
    st2.factor_random = 0.85
    st2.render_type = "OBJECT"
    st2.instance_object = spark2
    if hasattr(st2, "effector_weights"):
        st2.effector_weights.gravity = -0.95

    setup_render(frames, os.path.join(OUTDIR, "fire", "frame_"))
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.scene.view_settings.exposure = -0.05
    try:
        bpy.context.scene.view_settings.look = "None"
    except Exception:
        pass


BUILDERS = {
    "rocket": animate_rocket,
    "crown": animate_crown,
    "diamond": animate_diamond,
    "cheer_burst": animate_cheer,
    "fire": animate_fire,
}


def render_gift(gift_id: str):
    frames = GIFT_FRAMES[gift_id]
    out_dir = os.path.join(OUTDIR, gift_id)
    os.makedirs(out_dir, exist_ok=True)
    print(f"[studio] Building {gift_id} ({frames}f @ {W}x{H}, HDRI={os.path.basename(HDRI)})")
    BUILDERS[gift_id](frames)
    bpy.context.scene.render.filepath = os.path.join(out_dir, "frame_")
    bpy.ops.render.render(animation=True)
    print(f"[studio] Done {gift_id}")


def main():
    gifts = list(GIFT_FRAMES) if args.gift == "all" else [args.gift]
    for g in gifts:
        if g not in BUILDERS:
            raise SystemExit(f"Unknown gift {g}")
        render_gift(g)


if __name__ == "__main__":
    main()
