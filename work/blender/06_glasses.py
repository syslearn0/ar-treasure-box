"""
Phase 5-4: 眼鏡を足す。

本人が眼鏡をかけているので、キャラクターにも掛けさせる。
ただし顔立ちは似せない。2.4頭身のデフォルメなので、
「眼鏡をかけている」という記号だけあれば十分。作り込まない。

構成: レンズ枠2つ + ブリッジ + テンプル2本。すべて低ポリ。
頭のボーンにペアレントするので、首を振ると一緒に動く。
"""

import math

import bpy
import bmesh
from mathutils import Vector

PREFIX = "Chr_"
ARM_NAME = "Chr_Armature"

# 02_character_proxy.py の値
HEAD_R = 0.016
HEAD_Z = 0.0605
EYE_X = 0.0058
EYE_Z = HEAD_Z + HEAD_R * 0.10

RIM_R = 0.0052          # レンズ枠の半径
RIM_THICK = 0.0007      # 枠の太さ
FRONT_Y = -HEAD_R * 0.94   # 顔の前面よりわずかに手前


def socket(node, ident):
    for s in node.inputs:
        if s.identifier == ident:
            return s
    return None


def make_material(name, color, roughness=0.35):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        for ident, val in (("Base Color", (*color, 1.0)), ("Roughness", roughness),
                           ("Metallic", 0.0)):
            s = socket(bsdf, ident)
            if s is not None:
                s.default_value = val
    mat.diffuse_color = (*color, 1.0)
    return mat


def add_ring(name, major_r, minor_r, location, mat, major_seg=18, minor_seg=6):
    """トーラス。レンズ枠に使う。"""
    mesh = bpy.data.meshes.new(name)
    verts, faces = [], []
    for i in range(major_seg):
        a = 2 * math.pi * i / major_seg
        cx, cz = major_r * math.cos(a), major_r * math.sin(a)
        nx, nz = math.cos(a), math.sin(a)
        for j in range(minor_seg):
            b = 2 * math.pi * j / minor_seg
            r = minor_r * math.cos(b)
            verts.append((cx + nx * r, minor_r * math.sin(b), cz + nz * r))
    for i in range(major_seg):
        for j in range(minor_seg):
            a0 = i * minor_seg + j
            a1 = i * minor_seg + (j + 1) % minor_seg
            b0 = ((i + 1) % major_seg) * minor_seg + j
            b1 = ((i + 1) % major_seg) * minor_seg + (j + 1) % minor_seg
            faces.append((a0, a1, b1, b0))
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    for p in mesh.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat)
    return obj


def add_bar(name, a, b, radius, mat, segs=8):
    """点 a→b の細い棒。ブリッジとテンプルに使う。"""
    a, b = Vector(a), Vector(b)
    d = b - a
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=radius, radius2=radius, depth=max(d.length, 1e-4))
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = (a + b) / 2
    obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(mat)
    return obj


def parent_to_head(obj):
    """
    Chr_Head オブジェクトの子にする。

    【実測で判明】ボーンペアレント + matrix_world 代入は効かず、
    全オブジェクトが原点へ潰れた（view_layer.update() を挟んでも同じ）。
    Chr_Head 自体が head ボーンに付いているので、その子にすれば結果は同じで、
    オブジェクト親子付け + matrix_parent_inverse なら確実に位置が保たれる。
    """
    head_obj = bpy.data.objects["Chr_Head"]
    obj.parent = head_obj
    obj.parent_type = "OBJECT"
    obj.matrix_parent_inverse = head_obj.matrix_world.inverted()


def main():
    # 作り直しの場合は先に列挙してから消す（計画の安全指針）
    existing = [o.name for o in bpy.data.objects if o.name.startswith(f"{PREFIX}Glasses")]
    removed = []
    for n in existing:
        o = bpy.data.objects[n]
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
        removed.append(n)

    # 親子付けは REST 姿勢で行う。ポーズ中だとその姿勢が基準になってしまう。
    arm_obj = bpy.data.objects[ARM_NAME]
    prev_pose_position = arm_obj.data.pose_position
    arm_obj.data.pose_position = "REST"
    bpy.context.view_layer.update()

    frame_mat = make_material("M_Glasses", (0.06, 0.05, 0.06), roughness=0.3)

    # 【重要】ワールド座標は Chr_Root のオフセット分ずれる。
    # 定数で置くのではなく、REST 姿勢で実測した目と頭の位置を基準にする。
    eye_l = bpy.data.objects["Chr_Eye_L"].matrix_world.translation.copy()
    eye_r = bpy.data.objects["Chr_Eye_R"].matrix_world.translation.copy()
    head_c = bpy.data.objects["Chr_Head"].matrix_world.translation.copy()
    cx = (eye_l.x + eye_r.x) / 2
    ex = abs(eye_l.x - eye_r.x) / 2          # 目の間隔の半分
    front_y = head_c.y - HEAD_R * 0.94       # 顔の前面よりわずかに手前
    ez = (eye_l.z + eye_r.z) / 2

    parts = []
    for side, sx in (("L", -1), ("R", 1)):
        parts.append(add_ring(f"{PREFIX}Glasses_Rim_{side}", RIM_R, RIM_THICK,
                              (cx + ex * sx, front_y, ez), frame_mat))

    # ブリッジ（左右の枠をつなぐ）
    parts.append(add_bar(f"{PREFIX}Glasses_Bridge",
                         (cx - ex + RIM_R * 0.85, front_y, ez + RIM_R * 0.25),
                         (cx + ex - RIM_R * 0.85, front_y, ez + RIM_R * 0.25),
                         RIM_THICK * 0.85, frame_mat))

    # テンプル（耳へ向かう蔓）
    for side, sx in (("L", -1), ("R", 1)):
        parts.append(add_bar(f"{PREFIX}Glasses_Temple_{side}",
                             (cx + (ex + RIM_R * 0.9) * sx, front_y + 0.0008, ez),
                             (cx + HEAD_R * 0.92 * sx, head_c.y + HEAD_R * 0.30, ez - 0.0012),
                             RIM_THICK * 0.8, frame_mat))

    for p in parts:
        parent_to_head(p)

    arm_obj.data.pose_position = prev_pose_position
    bpy.context.view_layer.update()
    return {
        "removed": removed,
        "created": [p.name for p in parts],
        "rim_diameter_mm": round(RIM_R * 2 * 1000, 1),
        "head_diameter_mm": round(HEAD_R * 2 * 1000, 1),
        "parented_to": "head",
        "eye_span_mm": round(ex * 2 * 1000, 1),
        "front_y_mm": round(front_y * 1000, 1),
    }


result = main()
