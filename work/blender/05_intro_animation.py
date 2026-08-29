"""
Phase 5-3b: Intro のブロッキング。

30fps / 195フレーム = 6.5秒。計画の12ステップを時間へ割り付ける。

  0.0-1.5s  箱が揺れる → 蓋が少し浮く → 一度静止してタメ
  1.5-2.5s  蓋が開く → squash and stretch で飛び出す
  2.5-3.3s  周囲を一瞬確認する
  3.3-4.8s  腰の後ろへ手を伸ばす → 折り畳まれた紙を引き抜く
  4.8-6.3s  頭上へ持ち上げる → 紙を勢いよく広げる
  6.3-6.5s  余韻（Idle への繋ぎ）

【座標系の約束（すべて実測済み）】
  - ボーンのローカル Y がボーンの伸びる方向。squash/stretch は sq() を使う
  - 腕の X 回転は左右同符号、Z 回転のみ反転
  - 腕のローカル X は 負で前・正で後ろ
  - キャラクター全体の上下は Chr_Root（Empty）の Z で動かす（ボーン空間の曖昧さを避ける）
  - 紙は手にボーンペアレントしない。手の回転にオフセットが振り回され、
    引き抜きの瞬間に箱の下へ飛ぶ（実測で発覚）。Chr_Root の子にして位置を直接演出する。
"""

import math

import bpy
from mathutils import Euler

FPS = 30
END = 195

ARM = "Chr_Armature"
ROOT = "Chr_Root"
LID = "Box_Lid"
BODY = "Box_Body"
PAPER = "Chr_Paper"

# キャラクターは常に箱の内床に足を付けたまま、**スケールだけ**で隠す。
# 下へ移動させて隠すと箱の底を突き抜けて脚がはみ出す（実測で発覚）。
# 縦0.30倍なら全高 76.5mm → 23mm となり、箱の縁 40mm より低く隠れる。
Z_OUT = 0.004
HIDE_ALONG = 0.30
HIDE_CROSS = 1.30


def sq(along, cross):
    """ボーン方向(縦)と断面方向を指定して pose_bone.scale を作る。"""
    return (cross, along, cross)


def rad(d):
    return math.radians(d)


# ---------------------------------------------------------------- キー打ち

def key_obj(obj, frame, loc=None, rot=None):
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert("location", frame=frame)
    if rot is not None:
        obj.rotation_euler = rot
        obj.keyframe_insert("rotation_euler", frame=frame)


def key_bone(pb, frame, loc=None, rot=None, scale=None):
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)
    if rot is not None:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = rot
        pb.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        pb.scale = scale
        pb.keyframe_insert("scale", frame=frame)


def key_shape(kb, frame, value):
    kb.value = value
    kb.keyframe_insert("value", frame=frame)


def arms(pb, frame, x_deg, z_deg, fore_deg, side=None):
    """左右まとめて。side を指定すると片腕だけ。"""
    for s, zs in (("R", 1), ("L", -1)):
        if side and s != side:
            continue
        key_bone(pb[f"upperarm.{s}"], frame,
                 rot=(rad(x_deg), 0, rad(z_deg * zs)))
        key_bone(pb[f"forearm.{s}"], frame,
                 rot=(0, 0, rad(fore_deg * zs)))


# ---------------------------------------------------------------- 本体

def clear_animation():
    """既存のアニメーションを外す。データは消さず、リンクを切るだけ。"""
    detached = []
    for name in (ARM, ROOT, LID, BODY, PAPER):
        obj = bpy.data.objects.get(name)
        if obj and obj.animation_data:
            detached.append(name)
            obj.animation_data_clear()
    paper = bpy.data.objects.get(PAPER)
    if paper and paper.data.shape_keys and paper.data.shape_keys.animation_data:
        paper.data.shape_keys.animation_data_clear()
        detached.append(f"{PAPER}(shapekeys)")
    return detached


def build():
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = END

    arm_obj = bpy.data.objects[ARM]
    pb = arm_obj.pose.bones
    root = bpy.data.objects[ROOT]
    lid = bpy.data.objects[LID]
    body = bpy.data.objects[BODY]
    paper = bpy.data.objects[PAPER]
    kb = paper.data.shape_keys.key_blocks

    detached = clear_animation()

    root_x, root_y = root.location.x, root.location.y

    # ============================================================ 0.0-1.5s 揺れとタメ
    key_obj(root, 1, loc=(root_x, root_y, Z_OUT))
    key_obj(lid, 1, rot=(0, 0, 0))
    key_obj(body, 1, rot=(0, 0, 0))
    arms(pb, 1, 0, 0, 0)
    key_bone(pb["root"], 1, scale=sq(HIDE_ALONG, HIDE_CROSS))   # 箱の中で潰れている
    key_bone(pb["head"], 1, rot=(rad(10), 0, 0))
    key_shape(kb["Fold_Packet"], 1, 1.0)
    key_shape(kb["Fold_Half"], 1, 1.0)

    # --- 紙の軌跡（Chr_Root ローカル） ---
    # 引き抜く瞬間まで出さない。手に持たせたままだと箱の外へはみ出して見える。
    P_BACK  = (0.004, 0.014, 0.026)     # 背中の後ろ（隠れている）
    # 箱の縁は 40mm。それより低いと引き抜いた紙が箱に隠れて見えない（実測で発覚）。
    P_HAND  = (-0.004, -0.020, 0.048)   # 引き抜いた直後、胸の前
    P_UP    = (0.0, -0.032, 0.094)      # 頭上の表示位置

    def key_paper(frame, loc=None, scale=None, rot=None):
        if loc is not None:
            paper.location = loc
            paper.keyframe_insert("location", frame=frame)
        if scale is not None:
            paper.scale = (scale, scale, scale)
            paper.keyframe_insert("scale", frame=frame)
        if rot is not None:
            paper.rotation_euler = rot
            paper.keyframe_insert("rotation_euler", frame=frame)

    key_paper(1, loc=P_BACK, scale=0.001, rot=(rad(-70), 0, 0))
    key_paper(124, loc=P_BACK, scale=0.001, rot=(rad(-70), 0, 0))

    # 箱がカタカタ鳴る（蓋が跳ね、本体がわずかに傾く）
    for f, lid_deg, body_deg in (
        (10, 0, 0), (14, -5, 1.2), (18, 0, -0.8), (22, -7, 1.5),
        (26, 0, -1.0), (30, -4, 0.6), (34, 0, 0),
    ):
        key_obj(lid, f, rot=(rad(lid_deg), 0, 0))
        key_obj(body, f, rot=(0, rad(body_deg), 0))

    # タメ（完全静止）
    key_obj(lid, 45, rot=(0, 0, 0))
    key_obj(body, 45, rot=(0, 0, 0))
    key_obj(root, 45, loc=(root_x, root_y, Z_OUT))
    key_bone(pb["root"], 45, scale=sq(HIDE_ALONG * 0.88, HIDE_CROSS * 1.05))  # さらに潰れて溜める

    # ============================================================ 1.5-2.5s 蓋が開く・飛び出す
    key_obj(lid, 52, rot=(rad(-88), 0, 0))            # 勢い余って開きすぎ
    key_obj(lid, 62, rot=(rad(-74), 0, 0))            # 少し戻る
    key_obj(lid, 72, rot=(rad(-78), 0, 0))

    key_obj(root, 48, loc=(root_x, root_y, Z_OUT))
    key_obj(root, 58, loc=(root_x, root_y, Z_OUT + 0.010))   # 勢いで浮く
    key_obj(root, 68, loc=(root_x, root_y, Z_OUT - 0.002))   # 沈む
    key_obj(root, 76, loc=(root_x, root_y, Z_OUT))

    key_bone(pb["root"], 50, scale=sq(1.34, 0.82))    # 伸びきる
    key_bone(pb["root"], 60, scale=sq(0.88, 1.10))    # 着地で潰れる
    key_bone(pb["root"], 70, scale=sq(1.06, 0.97))
    key_bone(pb["root"], 78, scale=sq(1.0, 1.0))
    key_bone(pb["head"], 52, rot=(rad(-20), 0, 0))
    key_bone(pb["head"], 66, rot=(rad(6), 0, 0))
    key_bone(pb["head"], 78, rot=(0, 0, 0))
    arms(pb, 54, -30, 40, 10)                          # 飛び出す勢いで腕が上がる
    arms(pb, 72, -6, 6, 4)

    # ============================================================ 2.5-3.3s 周囲を確認
    key_bone(pb["head"], 86, rot=(0, 0, rad(26)))
    key_bone(pb["chest"], 86, rot=(0, 0, rad(7)))
    key_bone(pb["head"], 96, rot=(0, 0, rad(-24)))
    key_bone(pb["chest"], 96, rot=(0, 0, rad(-6)))
    key_bone(pb["head"], 104, rot=(0, 0, 0))
    key_bone(pb["chest"], 104, rot=(0, 0, 0))
    arms(pb, 100, -6, 6, 4)

    # ============================================================ 3.3-4.8s 腰の後ろから紙を引き抜く
    # ローカル X が正 = 後ろ。右腕だけ背中へ回す。
    arms(pb, 116, 52, 16, 26, side="R")
    key_bone(pb["chest"], 116, rot=(0, 0, rad(-10)))
    key_bone(pb["head"], 116, rot=(0, 0, rad(-14)))

    arms(pb, 126, 58, 18, 30, side="R")               # 掴む間
    key_bone(pb["chest"], 126, rot=(0, 0, rad(-11)))

    key_paper(134, loc=P_HAND, scale=1.0, rot=(rad(-40), 0, 0))   # 背中から現れる
    key_paper(146, loc=P_HAND, scale=1.0, rot=(rad(-15), 0, 0))

    arms(pb, 140, -18, 30, 14, side="R")              # 引き抜いて前へ
    key_bone(pb["chest"], 140, rot=(0, 0, rad(4)))
    key_bone(pb["head"], 140, rot=(rad(-6), 0, 0))
    key_bone(pb["root"], 140, scale=sq(1.04, 0.98))

    # ============================================================ 4.8-6.3s 掲げて広げる
    arms(pb, 156, -22, 176, 16)                        # 両腕を頭上へ
    key_bone(pb["root"], 156, scale=sq(1.08, 0.95))
    key_bone(pb["head"], 156, rot=(rad(-12), 0, 0))
    key_bone(pb["chest"], 156, rot=(0, 0, 0))

    key_paper(156, loc=P_UP, scale=1.0, rot=(0, 0, 0))            # 頭上へ
    key_paper(195, loc=P_UP, scale=1.0, rot=(0, 0, 0))

    key_shape(kb["Fold_Packet"], 158, 1.0)
    key_shape(kb["Fold_Packet"], 168, 0.0)             # 三つ折りが開く
    key_shape(kb["Fold_Half"], 168, 1.0)
    key_shape(kb["Fold_Half"], 180, 0.0)               # 二つ折りが開く

    # 広げた勢いで体が少し反る
    key_bone(pb["root"], 170, scale=sq(1.12, 0.93))
    key_bone(pb["root"], 182, scale=sq(0.98, 1.02))
    key_bone(pb["root"], 192, scale=sq(1.0, 1.0))
    arms(pb, 182, -20, 178, 14)
    arms(pb, 195, -22, 176, 16)
    key_bone(pb["head"], 195, rot=(rad(-12), 0, 0))
    key_obj(root, 195, loc=(root_x, root_y, Z_OUT))
    key_obj(lid, 195, rot=(rad(-78), 0, 0))
    key_shape(kb["Fold_Packet"], 195, 0.0)
    key_shape(kb["Fold_Half"], 195, 0.0)

    # アクション名を揃えておく（glTF 書き出し時に扱いやすい）
    for obj in (arm_obj, root, lid, body, paper):
        if obj.animation_data and obj.animation_data.action:
            obj.animation_data.action.name = f"Intro_{obj.name}"
    if paper.data.shape_keys.animation_data:
        paper.data.shape_keys.animation_data.action.name = "Intro_ShapeKeys"

    scene.frame_set(1)
    return {
        "fps": FPS,
        "frames": END,
        "seconds": round(END / FPS, 2),
        "detached_previous": detached,
        "z_out": Z_OUT,
        "hide_scale": [HIDE_ALONG, HIDE_CROSS],
    }


result = build()
