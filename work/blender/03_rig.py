"""
Phase 5-2: 仮キャラクターにリグを入れる。

プロキシ段階なのでスキニング（頂点ウェイト）は使わず、
各パーツをボーンに **ボーンペアレント** する。理由:

  - 分離したプリミティブなのでウェイト塗りが無意味
  - glTF へはノード階層＋アニメーションとしてそのまま出る
  - squash and stretch はボーンのスケールで表現できる
  - 最終キャラクターで本式のスキニングに差し替えられる

ボーン構成は必要最小限。glTF が確実に扱えるものだけ（Pose Bones の
位置・回転・スケール）に限定する。
"""

import bpy
from mathutils import Vector

ARM_NAME = "Chr_Armature"
PREFIX = "Chr_"

# 02_character_proxy.py の寸法から算出した関節位置（メートル）
LEG_H = 0.016
TORSO_Z = 0.030
HEAD_Z = 0.0605
HEAD_R = 0.016
TOTAL_H = 0.0765
ARM_X = 0.0157
ARM_Z = 0.0325

# name: (head, tail, parent, connected)
BONES = {
    "root":      ((0.0, 0.0, 0.0),        (0.0, 0.0, 0.010),      None,       False),
    "hips":      ((0.0, 0.0, LEG_H - 0.002), (0.0, 0.0, TORSO_Z - 0.006), "root", False),
    "spine":     ((0.0, 0.0, TORSO_Z - 0.006), (0.0, 0.0, TORSO_Z + 0.008), "hips", True),
    "chest":     ((0.0, 0.0, TORSO_Z + 0.008), (0.0, 0.0, HEAD_Z - HEAD_R * 0.8), "spine", True),
    "head":      ((0.0, 0.0, HEAD_Z - HEAD_R * 0.8), (0.0, 0.0, TOTAL_H), "chest", True),
    "upperarm.L": ((-ARM_X * 0.55, 0.0, ARM_Z + 0.006), (-ARM_X, 0.0, ARM_Z - 0.010), "chest", False),
    "upperarm.R": (( ARM_X * 0.55, 0.0, ARM_Z + 0.006), ( ARM_X, 0.0, ARM_Z - 0.010), "chest", False),
    "thigh.L":   ((-0.008, 0.0, LEG_H), (-0.008, 0.0, 0.002), "hips", False),
    "thigh.R":   (( 0.008, 0.0, LEG_H), ( 0.008, 0.0, 0.002), "hips", False),
}

# メッシュ → ボーン
PARENT_MAP = {
    "Chr_Torso":  "spine",
    "Chr_Head":   "head",
    "Chr_Eye_L":  "head",
    "Chr_Eye_R":  "head",
    "Chr_Arm_L":  "upperarm.L",
    "Chr_Arm_R":  "upperarm.R",
    "Chr_Leg_L":  "thigh.L",
    "Chr_Leg_R":  "thigh.R",
}


def build_armature():
    if ARM_NAME in bpy.data.objects:
        print(f"[abort] {ARM_NAME} は既に存在します")
        return None

    root_empty = bpy.data.objects.get(f"{PREFIX}Root")
    if root_empty is None:
        raise RuntimeError(f"{PREFIX}Root が見つかりません。先に 02_character_proxy.py を実行してください。")

    arm_data = bpy.data.armatures.new(ARM_NAME)
    arm_obj = bpy.data.objects.new(ARM_NAME, arm_data)
    bpy.context.collection.objects.link(arm_obj)
    arm_obj.location = root_empty.location
    arm_data.display_type = "OCTAHEDRAL"

    # 編集ボーンの作成にはアクティブ化と EDIT モードが要る
    bpy.context.view_layer.objects.active = arm_obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    eb = arm_data.edit_bones
    created = {}
    for name, (head, tail, parent, connected) in BONES.items():
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        created[name] = b
    for name, (_h, _t, parent, connected) in BONES.items():
        if parent:
            created[name].parent = created[parent]
            created[name].use_connect = connected

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def parent_meshes(arm_obj):
    """
    ボーンペアレント。ワールド行列を保存してから親を付け替え、
    元の位置へ戻す（Blender はボーンの *tail* を基準に親子付けするため、
    matrix_world を再代入して局所行列を計算し直させるのが確実）。
    """
    done = []
    for mesh_name, bone_name in PARENT_MAP.items():
        obj = bpy.data.objects.get(mesh_name)
        if obj is None:
            print(f"[skip] {mesh_name} が見つかりません")
            continue
        mw = obj.matrix_world.copy()
        obj.parent = arm_obj
        obj.parent_type = "BONE"
        obj.parent_bone = bone_name
        obj.matrix_world = mw
        done.append(f"{mesh_name} -> {bone_name}")
    return done


def main():
    arm_obj = build_armature()
    if arm_obj is None:
        return {"status": "aborted"}

    root_empty = bpy.data.objects.get(f"{PREFIX}Root")
    arm_obj.parent = root_empty

    links = parent_meshes(arm_obj)
    bpy.context.view_layer.update()

    return {
        "armature": arm_obj.name,
        "bones": list(BONES.keys()),
        "bone_count": len(BONES),
        "parented": links,
    }


result = main()
