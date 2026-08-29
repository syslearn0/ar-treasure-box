"""
Phase 5-3a: 腕の分節と、折り畳まれた紙（Shape Key）を作る。

■ 腕
  現状は上腕だけの1本カプセルなので、肘が曲がらず
  「腰の後ろへ手を伸ばす」「紙を頭上へ掲げる」が表現できない。
  上腕 / 前腕 / 手 の3分割にし、ボーンも forearm と hand を足す。

■ 紙
  Basis を「広げた平らな状態」にする。理由は失敗時の見え方:
  モーフターゲットが読み込まれなくても、紙は平らで文字が読める状態になる。
  折り畳みは Shape Key 側に持たせ、値 1→0 で開く。

  Fold_Half   … 横の折り目で上下2つ折り（Z方向の変位）
  Fold_Packet … 左右を内側へ三つ折り（X方向の変位）

  2つは変位軸が直交しているので、両方1にすると小さな包みになる。
  開くときは Packet → Half の順に戻すと、手紙を開く動きに見える。

  メッセージ本文は焼き込まない。Web 側で CanvasTexture を貼る前提なので、
  UV だけ平らな長方形に張っておく。
"""

import math

import bpy
import bmesh
from mathutils import Vector

PREFIX = "Chr_"
ARM_NAME = "Chr_Armature"

# --- 腕の関節位置（メートル） ---
SHOULDER = (0.0140, 0.0, 0.0380)
ELBOW    = (0.0172, 0.0, 0.0262)
WRIST    = (0.0184, 0.0, 0.0152)
UPPER_R  = 0.0042
FORE_R   = 0.0036
HAND_R   = 0.0048

# --- 紙の寸法 ---
PAPER_W = 0.052
PAPER_H = 0.038
PAPER_SEG_X = 12          # 三つ折り位置 ±W/6 に頂点が乗るよう 12 分割
PAPER_SEG_Z = 8           # 中央の折り目 z=0 に頂点が乗るよう偶数
LAYER_GAP = 0.00035       # 重なった紙が z-fighting しないための隙間


def socket(node, ident):
    for s in node.inputs:
        if s.identifier == ident:
            return s
    return None


def make_material(name, color, roughness=0.6):
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


def capsule_mesh(name, radius, length, segs=12):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                          radius1=radius, radius2=radius, depth=length)
    for z in (length / 2, -length / 2):
        sub = bmesh.new()
        bmesh.ops.create_uvsphere(sub, u_segments=segs, v_segments=max(4, segs // 2),
                                  radius=radius)
        bmesh.ops.translate(sub, verts=sub.verts, vec=(0, 0, z))
        tmp = bpy.data.meshes.new("_tmp")
        sub.to_mesh(tmp)
        sub.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    return mesh


def add_segment(name, a, b, radius, mat):
    """点 a→b を結ぶカプセルを作る。"""
    a, b = Vector(a), Vector(b)
    d = b - a
    obj = bpy.data.objects.new(name, capsule_mesh(name, radius, max(d.length - radius * 1.2, 1e-4)))
    bpy.context.collection.objects.link(obj)
    obj.location = (a + b) / 2
    obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(mat)
    return obj


def sphere(name, radius, location, mat, segs=14, rings=8):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat)
    return obj


# ---------------------------------------------------------------- 腕

def rebuild_arms():
    skin = make_material("M_Chr_Skin", (0.94, 0.78, 0.66))

    # 既存の1本カプセルは役目を終える。削除前に必ず列挙する（計画の安全指針）。
    old = [o.name for o in bpy.data.objects if o.name in ("Chr_Arm_L", "Chr_Arm_R")]
    for n in old:
        o = bpy.data.objects[n]
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me.users == 0:
            bpy.data.meshes.remove(me)

    created = []
    for side, sx in (("L", -1), ("R", 1)):
        sh = (SHOULDER[0] * sx, SHOULDER[1], SHOULDER[2])
        el = (ELBOW[0] * sx, ELBOW[1], ELBOW[2])
        wr = (WRIST[0] * sx, WRIST[1], WRIST[2])
        created.append(add_segment(f"{PREFIX}UpperArm_{side}", sh, el, UPPER_R, skin))
        created.append(add_segment(f"{PREFIX}Forearm_{side}", el, wr, FORE_R, skin))
        created.append(sphere(f"{PREFIX}Hand_{side}", HAND_R,
                              (wr[0], wr[1], wr[2] - HAND_R * 0.6), skin))
    return old, [o.name for o in created]


def extend_rig():
    arm_obj = bpy.data.objects[ARM_NAME]
    bpy.context.view_layer.objects.active = arm_obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    eb = arm_obj.data.edit_bones
    added = []
    for side, sx in (("L", -1), ("R", 1)):
        up = eb.get(f"upperarm.{side}")
        sh = Vector((SHOULDER[0] * sx, SHOULDER[1], SHOULDER[2]))
        el = Vector((ELBOW[0] * sx, ELBOW[1], ELBOW[2]))
        wr = Vector((WRIST[0] * sx, WRIST[1], WRIST[2]))

        # 上腕ボーンを実際の肩→肘に合わせ直す
        up.head, up.tail = sh, el

        fore = eb.get(f"forearm.{side}") or eb.new(f"forearm.{side}")
        fore.head, fore.tail = el, wr
        fore.parent, fore.use_connect = up, True
        added.append(fore.name)

        hand = eb.get(f"hand.{side}") or eb.new(f"hand.{side}")
        hand.head = wr
        hand.tail = wr + Vector((0.0, 0.0, -0.008))
        hand.parent, hand.use_connect = fore, True
        added.append(hand.name)

    bpy.ops.object.mode_set(mode="OBJECT")
    return added


def parent_to_bone(obj_name, bone_name):
    obj = bpy.data.objects.get(obj_name)
    arm_obj = bpy.data.objects[ARM_NAME]
    if obj is None:
        return None
    mw = obj.matrix_world.copy()
    obj.parent = arm_obj
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = mw
    return f"{obj_name} -> {bone_name}"


# ---------------------------------------------------------------- 紙

def build_paper():
    name = f"{PREFIX}Paper"
    if name in bpy.data.objects:
        return None, "既に存在するため作成せず"

    mesh = bpy.data.meshes.new(name)
    verts, faces, uvs = [], [], []
    nx, nz = PAPER_SEG_X, PAPER_SEG_Z
    for iz in range(nz + 1):
        for ix in range(nx + 1):
            u = ix / nx
            v = iz / nz
            verts.append((( u - 0.5) * PAPER_W, 0.0, (v - 0.5) * PAPER_H))
    for iz in range(nz):
        for ix in range(nx):
            a = iz * (nx + 1) + ix
            b = a + 1
            c = a + (nx + 1) + 1
            d = a + (nx + 1)
            faces.append((a, b, c, d))
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()

    # UV（平らな長方形に素直に張る。Web の CanvasTexture 用）
    uv = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            x, _y, z = mesh.vertices[vi].co
            uv.data[li].uv = (x / PAPER_W + 0.5, z / PAPER_H + 0.5)

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(make_material("M_Paper", (0.96, 0.94, 0.88), roughness=0.85))

    # --- Shape Key ---
    basis = obj.shape_key_add(name="Basis", from_mix=False)   # 広げた状態

    half = obj.shape_key_add(name="Fold_Half", from_mix=False)
    for i, v in enumerate(basis.data):
        x, y, z = v.co
        # z=0 の折り目で下半分を上へ折り返し、全体を中央へ寄せる
        nz_ = abs(z) - PAPER_H / 4
        ny = y + (LAYER_GAP if z < 0 else 0.0)
        half.data[i].co = (x, ny, nz_)

    packet = obj.shape_key_add(name="Fold_Packet", from_mix=False)
    third = PAPER_W / 6
    for i, v in enumerate(basis.data):
        x, y, z = v.co
        if x < -third:
            nx_ = -PAPER_W / 3 - x
            ny = y + LAYER_GAP * 2
        elif x > third:
            nx_ = PAPER_W / 3 - x
            ny = y + LAYER_GAP * 3
        else:
            nx_ = x
            ny = y
        packet.data[i].co = (nx_, ny, z)

    for k in (half, packet):
        k.slider_min = 0.0
        k.slider_max = 1.0
        k.value = 1.0     # 初期状態は折り畳み

    return obj, {
        "unfolded_mm": [round(PAPER_W * 1000, 1), round(PAPER_H * 1000, 1)],
        "packet_mm": [round(PAPER_W / 3 * 1000, 1), round(PAPER_H / 2 * 1000, 1)],
        "shape_keys": [k.name for k in obj.data.shape_keys.key_blocks],
    }


def main():
    removed, created = rebuild_arms()
    bones = extend_rig()

    links = []
    for side in ("L", "R"):
        links.append(parent_to_bone(f"{PREFIX}UpperArm_{side}", f"upperarm.{side}"))
        links.append(parent_to_bone(f"{PREFIX}Forearm_{side}", f"forearm.{side}"))
        links.append(parent_to_bone(f"{PREFIX}Hand_{side}", f"hand.{side}"))

    paper, paper_info = build_paper()
    if paper is not None:
        # 右手に持たせる。腰の後ろから引き出す想定なので、初期位置は手のすぐ内側。
        paper.location = (WRIST[0], 0.006, WRIST[2] - 0.010)
        links.append(parent_to_bone(f"{PREFIX}Paper", "hand.R"))

    bpy.context.view_layer.update()
    return {
        "removed_old_arms": removed,
        "created_meshes": created,
        "added_bones": bones,
        "parented": [l for l in links if l],
        "paper": paper_info,
    }


result = main()
