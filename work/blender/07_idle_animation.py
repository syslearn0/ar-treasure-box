"""
Phase 5-5: Idle（待機モーション）。

Intro の終了姿勢（頭上に紙を掲げた状態）から始まり、ループする。

  フレーム 196-315（120フレーム = 4.0秒 @30fps）

【ループの作り方】
  f196 の姿勢 == f195（Intro の最終フレーム）… 繋ぎ目が飛ばない
  f315 の姿勢 == f196                        … ループの継ぎ目が飛ばない

【クリップの分け方】
  glTF は SCENE モードでオブジェクトごとに1本ずつ出す（Intro と Idle は分かれない）。
  そこで Web 側で THREE.AnimationUtils.subclip を使い、
  フレーム範囲で Intro / Idle に切り分ける。
  こうすれば GLB は1つのまま、再生側で「Introは1回・Idleはループ」を実現できる。

【内容】
  呼吸   … spine のわずかな伸縮（2周期）
  瞬き   … 目メッシュのスケール（ボーンでは潰せないのでオブジェクトのZを縮める）
  視線   … head の小さな揺れ
  紙揺れ … Chr_Paper の微小回転
"""

import math

import bpy
from mathutils import Euler

FPS = 30
IDLE_START = 196
IDLE_END = 315
IDLE_LEN = IDLE_END - IDLE_START      # 119フレーム

# Intro 終了時の姿勢（05_intro_animation.py の最終キーと一致させる）
END_ARM_X, END_ARM_Z, END_ARM_FORE = -22, 176, 16
END_HEAD_X = -12


def sq(along, cross):
    return (cross, along, cross)


def rad(d):
    return math.radians(d)


def key_bone(pb, frame, rot=None, scale=None):
    if rot is not None:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = rot
        pb.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        pb.scale = scale
        pb.keyframe_insert("scale", frame=frame)


def key_obj_scale(obj, frame, s):
    obj.scale = s
    obj.keyframe_insert("scale", frame=frame)


def key_obj_rot(obj, frame, rot):
    obj.rotation_euler = rot
    obj.keyframe_insert("rotation_euler", frame=frame)


def build():
    scene = bpy.context.scene
    scene.frame_end = IDLE_END

    arm_obj = bpy.data.objects["Chr_Armature"]
    pb = arm_obj.pose.bones
    paper = bpy.data.objects["Chr_Paper"]
    eyes = [bpy.data.objects["Chr_Eye_L"], bpy.data.objects["Chr_Eye_R"]]

    # 目の元のスケールを控える（瞬きで戻す先）
    eye_base = [tuple(e.scale) for e in eyes]

    # --- 呼吸: spine を 2周期で伸縮 ---
    breaths = 2
    for i in range(breaths * 2 + 1):
        f = IDLE_START + round(IDLE_LEN * i / (breaths * 2))
        up = (i % 2 == 1)
        key_bone(pb["spine"], f, scale=sq(1.028 if up else 0.994, 0.988 if up else 1.004))
        key_bone(pb["chest"], f, scale=sq(1.015 if up else 1.0, 0.995 if up else 1.0))

    # --- 視線: head をゆっくり揺らす。始点と終点を揃えてループさせる ---
    head_keys = [
        (0.00, (END_HEAD_X, 0, 0)),
        (0.22, (END_HEAD_X - 3, 0, 5)),
        (0.48, (END_HEAD_X + 2, 0, -4)),
        (0.74, (END_HEAD_X - 2, 0, 3)),
        (1.00, (END_HEAD_X, 0, 0)),
    ]
    for t, (rx, ry, rz) in head_keys:
        key_bone(pb["head"], IDLE_START + round(IDLE_LEN * t),
                 rot=(rad(rx), rad(ry), rad(rz)))

    # --- 腕: 掲げたまま、ごくわずかに上下 ---
    for t, d in ((0.00, 0), (0.35, 1.6), (0.70, -1.2), (1.00, 0)):
        f = IDLE_START + round(IDLE_LEN * t)
        for side, zs in (("R", 1), ("L", -1)):
            key_bone(pb[f"upperarm.{side}"], f,
                     rot=(rad(END_ARM_X), 0, rad((END_ARM_Z + d) * zs)))
            key_bone(pb[f"forearm.{side}"], f, rot=(0, 0, rad(END_ARM_FORE * zs)))

    # --- root は動かさないが、ループのため始点と終点にキーを置く ---
    for t in (0.0, 1.0):
        key_bone(pb["root"], IDLE_START + round(IDLE_LEN * t), scale=sq(1.0, 1.0))

    # --- 瞬き: 目を縦に潰す。2回、不規則な間隔で ---
    blinks = [0.28, 0.72]
    for e, base in zip(eyes, eye_base):
        key_obj_scale(e, IDLE_START, base)
        for t in blinks:
            f = IDLE_START + round(IDLE_LEN * t)
            key_obj_scale(e, f - 2, base)
            key_obj_scale(e, f, (base[0], base[1], base[2] * 0.10))
            key_obj_scale(e, f + 2, base)
        key_obj_scale(e, IDLE_END, base)

    # --- 紙の揺れ: 微小回転。始点と終点を揃える ---
    for t, (rx, ry, rz) in (
        (0.00, (0, 0, 0)),
        (0.30, (1.2, 1.8, -0.8)),
        (0.62, (-0.9, -1.5, 0.7)),
        (1.00, (0, 0, 0)),
    ):
        key_obj_rot(paper, IDLE_START + round(IDLE_LEN * t),
                    (rad(rx), rad(ry), rad(rz)))

    scene.frame_set(IDLE_START)
    return {
        "idle_range": [IDLE_START, IDLE_END],
        "idle_seconds": round(IDLE_LEN / FPS, 2),
        "intro_range": [1, 195],
        "intro_seconds": round(194 / FPS, 2),
        "blinks_at": [round((IDLE_START + IDLE_LEN * t - IDLE_START) / FPS, 2) for t in blinks],
        "scene_end": scene.frame_end,
    }


result = build()
