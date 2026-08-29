"""
Phase 5-1: 仮キャラクター（プロキシ形状）を作る。

外見の最終デザインは未確定なので、ここでは「2.5頭身の人物がいる」ことだけを
成立させる。目的は次の3つ。

  1. 箱に対する大きさの基準を決める
  2. リグを入れて変形テストができる状態にする
  3. Intro のブロッキングに進める

まだ作り込まない。顔も服も後回し。

寸法は箱（86 x 64.5 x 50mm）を基準にメートルで。
"""

import math

import bpy
from mathutils import Vector

# ---------------------------------------------------------------- 寸法

BOX_W, BOX_H, BOX_D = 0.086, 0.0645, 0.050
BODY_H = BOX_H * 0.62          # 箱本体の高さ 40mm（蓋を除く）

# 2.5頭身。頭が大きいデフォルメ体型。
HEAD_R = 0.016                 # 頭の半径 16mm → 直径 32mm
TORSO_R = 0.0165               # 胴の半径
LEG_H = 0.016                  # 脚（箱に隠れる前提で短め）
ARM_R = 0.0042
ARM_L = 0.023

CHAR_NAME_PREFIX = "Chr_"


# ---------------------------------------------------------------- 補助

def socket(node, identifier):
    """ソケットを identifier で引く（日本語UIだと name が翻訳されるため）。"""
    for s in node.inputs:
        if s.identifier == identifier:
            return s
    return None


def principled(mat):
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            return n
    return None


def make_material(name, color, roughness=0.55):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    bsdf = principled(mat)
    if bsdf:
        for ident, val in (("Base Color", (*color, 1.0)),
                           ("Roughness", roughness),
                           ("Metallic", 0.0)):
            s = socket(bsdf, ident)
            if s is not None:
                s.default_value = val
    mat.diffuse_color = (*color, 1.0)
    return mat


def add_sphere(name, radius, location, scale=(1, 1, 1), segs=20, rings=12, mat=None):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True

    obj.location = location
    obj.scale = scale
    if mat:
        mesh.materials.append(mat)
    return obj


def add_capsule(name, radius, length, location, rotation=(0, 0, 0), segs=12, mat=None):
    """円柱＋両端の半球。腕・脚用。"""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=radius, radius2=radius, depth=length)
    for z, flip in ((length / 2, 1), (-length / 2, -1)):
        sub = bmesh.new()
        bmesh.ops.create_uvsphere(sub, u_segments=segs, v_segments=max(4, segs // 2),
                                  radius=radius)
        bmesh.ops.translate(sub, verts=sub.verts, vec=(0, 0, z))
        me = bpy.data.meshes.new("_tmp")
        sub.to_mesh(me)
        sub.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True

    obj.location = location
    obj.rotation_euler = rotation
    if mat:
        mesh.materials.append(mat)
    return obj


# ---------------------------------------------------------------- 組み立て

def build_character():
    skin = make_material("M_Chr_Skin", (0.94, 0.78, 0.66))
    cloth = make_material("M_Chr_Cloth", (0.35, 0.55, 0.62))
    dark = make_material("M_Chr_Dark", (0.12, 0.10, 0.12), roughness=0.4)

    parts = []

    # --- 脚（大半は箱に隠れる） ---
    for side, x in (("L", -0.008), ("R", 0.008)):
        parts.append(add_capsule(f"{CHAR_NAME_PREFIX}Leg_{side}", 0.005, LEG_H * 0.6,
                                 (x, 0.0, LEG_H * 0.5), mat=cloth))

    # --- 胴（卵形） ---
    torso_z = LEG_H + TORSO_R * 0.85
    parts.append(add_sphere(f"{CHAR_NAME_PREFIX}Torso", TORSO_R,
                            (0.0, 0.0, torso_z), scale=(1.0, 0.82, 1.15), mat=cloth))

    # --- 頭 ---
    head_z = torso_z + TORSO_R * 1.15 + HEAD_R * 0.72
    parts.append(add_sphere(f"{CHAR_NAME_PREFIX}Head", HEAD_R,
                            (0.0, 0.0, head_z), scale=(1.0, 0.92, 1.0), mat=skin))

    # --- 目（向きが分かるように。あとで瞬きのシェイプキー対象にする） ---
    for side, x in (("L", -0.0058), ("R", 0.0058)):
        parts.append(add_sphere(f"{CHAR_NAME_PREFIX}Eye_{side}", 0.0022,
                                (x, -HEAD_R * 0.86, head_z + HEAD_R * 0.10),
                                scale=(1.0, 0.6, 1.25), segs=12, rings=8, mat=dark))

    # --- 腕（体側に下ろした素立ち） ---
    for side, x in (("L", -1), ("R", 1)):
        sx = x * (TORSO_R * 0.95)
        arm = add_capsule(f"{CHAR_NAME_PREFIX}Arm_{'L' if x < 0 else 'R'}",
                          ARM_R, ARM_L,
                          (sx, 0.0, torso_z + TORSO_R * 0.15),
                          rotation=(0.0, math.radians(x * -12), 0.0), mat=skin)
        parts.append(arm)

    # --- まとめる空オブジェクト ---
    root = bpy.data.objects.new(f"{CHAR_NAME_PREFIX}Root", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.02
    bpy.context.collection.objects.link(root)
    for p in parts:
        p.parent = root

    total_h = head_z + HEAD_R
    return root, parts, total_h, head_z


def main():
    existing = [o.name for o in bpy.data.objects if o.name.startswith(CHAR_NAME_PREFIX)]
    if existing:
        # 削除はしない。列挙して知らせるだけ（計画の安全指針）。
        print(f"[abort] 既に {len(existing)} 個のキャラクター部品があります: {existing}")
        return {"status": "aborted", "existing": existing}

    root, parts, total_h, head_z = build_character()

    # 箱の中に立たせる。足元は箱の内床。
    root.location = (0.0, 0.004, 0.004)

    result = {
        "total_height_mm": round(total_h * 1000, 1),
        "head_diameter_mm": round(HEAD_R * 2 * 1000, 1),
        "heads_tall": round(total_h / (HEAD_R * 2), 2),
        "box_height_mm": round(BOX_H * 1000, 1),
        "box_body_height_mm": round(BODY_H * 1000, 1),
        "parts": [p.name for p in parts],
    }
    print("[character]", result)
    return result


result = main()
