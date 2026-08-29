"""
Phase 4: 手描きの箱に一致する 3D プロキシを作る。

blender --background --python work/blender/01_box.py

安全のため:
  - 新規シーンから組み立てる（既存データを消す操作をしない）
  - 出力は work/blender/out/ 配下のみ
  - 同名の .blend を上書きせず、必ず新規保存パスを指定する

寸法は work/art/box.png の実測から。単位はメートル（ARシーンと同じ実寸系）。
"""

import math
import os
import sys

import bpy
from mathutils import Vector

# ---------------------------------------------------------------- パラメータ

W = 0.086          # 箱の幅
H = 0.0645         # 箱の高さ（正面）
D = 0.050          # 奥行き

LID_RATIO = 0.38   # 蓋が占める高さの割合（絵の実測: 合わせ目が 38%）
LID_H = H * LID_RATIO
BODY_H = H - LID_H

BODY_TOP_W = W * 0.99    # 本体上端の幅（実測 99%）
BODY_BOT_W = W * 0.873   # 本体下端の幅（実測 87.3%）
BODY_TOP_D = D * 0.99
BODY_BOT_D = D * 0.873

# 蓋の輪郭はスーパー楕円 |x/hw|^n + |z/h|^n = 1 で近似する。
# 絵の実測（上から26%の位置で幅90.7%、53%で96.3%）から n≈3.8 が最も合う。
# 角丸矩形では上部が太くなりすぎ、半円では細くなりすぎた。
LID_EXPONENT = 3.8
LID_ARC_SEGS = 28

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


# ---------------------------------------------------------------- ユーティリティ

def reset_scene():
    """新規ファイル相当の状態から始める。既存データの削除ではない。"""
    bpy.ops.wm.read_homefile(use_empty=True)


def new_mesh(name, verts, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def shade_smooth(obj, angle_deg=40.0):
    """
    角度で分割するスムーズシェード。
    Blender 4.1 以降 SMOOTH_BY_ANGLE は Geometry Nodes アセット扱いになり、
    modifiers.new() の enum には無い（5.1 で確認）。EDGE_SPLIT で同等の結果を得る。
    """
    for poly in obj.data.polygons:
        poly.use_smooth = True
    mod = obj.modifiers.new("EdgeSplit", "EDGE_SPLIT")
    mod.split_angle = math.radians(angle_deg)
    mod.use_edge_angle = True
    mod.use_edge_sharp = True


def _socket(node, identifier):
    """
    ソケットを identifier で引く。

    【重要】Blender が日本語ロケールで動いていると、ノード名もソケット *名* も
    ローカライズされる（実測: 'Principled BSDF' → 'プリンシプルBSDF'）。
    name で引くと必ず None になり、色が設定されないまま灰色になる。
    identifier は翻訳されないので、こちらを使う。
    """
    for sock in node.inputs:
        if sock.identifier == identifier:
            return sock
    return None


def _principled(mat):
    """名前ではなく型で Principled BSDF を探す（ロケール非依存）。"""
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def make_material(name, base_color, roughness=0.75):
    mat = bpy.data.materials.new(name)
    bsdf = _principled(mat)
    if bsdf is None:
        print(f"[warn] {name}: Principled BSDF が見つかりません")
        return mat
    for ident, value in (
        ("Base Color", (*base_color, 1.0)),
        ("Roughness", roughness),
        ("Metallic", 0.0),
    ):
        sock = _socket(bsdf, ident)
        if sock is not None:
            sock.default_value = value
    mat.diffuse_color = (*base_color, 1.0)   # Workbench 表示用
    return mat


# ---------------------------------------------------------------- 本体

def build_body():
    """
    下すぼまりの四角い本体。z=0 が箱の底、z=BODY_H が合わせ目。
    絵では下端が上端より狭いので、その台形を再現する。
    """
    hw_t, hd_t = BODY_TOP_W / 2, BODY_TOP_D / 2
    hw_b, hd_b = BODY_BOT_W / 2, BODY_BOT_D / 2

    verts = [
        (-hw_b, -hd_b, 0.0), (hw_b, -hd_b, 0.0), (hw_b, hd_b, 0.0), (-hw_b, hd_b, 0.0),
        (-hw_t, -hd_t, BODY_H), (hw_t, -hd_t, BODY_H), (hw_t, hd_t, BODY_H), (-hw_t, hd_t, BODY_H),
    ]
    faces = [
        (0, 3, 2, 1),   # 底
        # 上面は張らない。キャラクターがここから出てくるため、
        # 内側は Box_Interior_Occluder が受け持つ。
        (0, 1, 5, 4),   # 前
        (1, 2, 6, 5),   # 右
        (2, 3, 7, 6),   # 後
        (3, 0, 4, 7),   # 左
    ]
    obj = new_mesh("Box_Body", verts, faces)
    obj.data.materials.append(make_material("M_Wood", (0.62, 0.48, 0.33)))
    return obj


# ---------------------------------------------------------------- 蓋

def lid_profile():
    """
    正面から見た蓋の輪郭（XZ平面）。左下 → 上 → 右下 の順。
    スーパー楕円なので、半円より平たく、角丸矩形より肩が落ちる。
    """
    hw = W / 2
    n = LID_EXPONENT
    e = 2.0 / n
    pts = []
    for i in range(LID_ARC_SEGS + 1):
        t = math.pi * (1.0 - i / LID_ARC_SEGS)   # π → 0（左下から右下へ）
        c, s_ = math.cos(t), math.sin(t)
        x = hw * math.copysign(abs(c) ** e, c)
        z = LID_H * (abs(s_) ** e)
        pts.append((x, z))
    return pts


def build_lid():
    """
    蓋。回転の軸を「後ろ側の下端」に置き、原点をそこへ合わせる。
    こうしておくと、あとで rotation_euler.x を動かすだけで開閉できる。
    """
    prof = lid_profile()
    hd = D / 2
    n = len(prof)

    verts = [(x, -hd, z) for (x, z) in prof] + [(x, hd, z) for (x, z) in prof]
    faces = []
    for i in range(n - 1):
        faces.append((i, i + 1, n + i + 1, n + i))
    # 前後のフタ（凸なのでファン三角形で埋める）
    faces.append(tuple(range(n)))
    faces.append(tuple(reversed(range(n, 2 * n))))

    obj = new_mesh("Box_Lid", verts, faces)
    obj.data.materials.append(make_material("M_Wood", (0.62, 0.48, 0.33)))

    # ヒンジ（後ろ下端）を原点にする
    hinge = Vector((0.0, hd, 0.0))
    obj.data.transform(
        __import__("mathutils").Matrix.Translation(-hinge)
    )
    obj.location = (0.0, hd, BODY_H)
    return obj


# ---------------------------------------------------------------- オクルーダー

def build_occluder():
    """
    箱の内部。キャラクターの下半身を隠すための暗い面。

    本体が下すぼまりなので、オクルーダーも同じ比率でテーパーさせる。
    直方体のままだと下部が本体からはみ出して見える（実測で発覚）。

    Web側では colorWrite:false / depthWrite:true のオクルーダーとして使う想定。
    名前で識別できるようにしておく。
    """
    inset = 0.003
    top_w = BODY_TOP_W - inset * 2
    top_d = BODY_TOP_D - inset * 2
    ratio = BODY_BOT_W / BODY_TOP_W
    bot_w = top_w * ratio
    bot_d = top_d * ratio

    hw_t, hd_t = top_w / 2, top_d / 2
    hw_b, hd_b = bot_w / 2, bot_d / 2
    top = BODY_H - 0.001
    bottom = 0.003

    verts = [
        (-hw_b, -hd_b, bottom), (hw_b, -hd_b, bottom), (hw_b, hd_b, bottom), (-hw_b, hd_b, bottom),
        (-hw_t, -hd_t, top), (hw_t, -hd_t, top), (hw_t, hd_t, top), (-hw_t, hd_t, top),
    ]
    faces = [
        (0, 1, 2, 3),                                  # 内底
        (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),   # 内壁（法線を内向きに）
    ]
    obj = new_mesh("Box_Interior_Occluder", verts, faces)
    obj.data.materials.append(make_material("M_Interior", (0.03, 0.02, 0.02), roughness=1.0))
    return obj


# ---------------------------------------------------------------- カメラ・照明・描画

def setup_render(transparent=True):
    """Blender 5.1 で利用できるエンジンは 'BLENDER_EEVEE' のみ（実測）。"""
    scene = bpy.context.scene
    available = [i.identifier for i in
                 bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for name in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        if name in available:
            scene.render.engine = name
            break
    print(f"[render] engine = {scene.render.engine}")
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    # 箱は 8.6cm と小さく、ライトも近い。Standard だと簡単に白飛びするので
    # トーンマッピングのあるビュー変換を使う。
    for vt in ("AgX", "Filmic", "Standard"):
        try:
            scene.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    print(f"[render] view_transform = {scene.view_settings.view_transform}")


def add_lights():
    key = bpy.data.lights.new("Key", type="AREA")
    key.energy = 1.6      # 距離約0.25mなので 1W オーダーで足りる
    key.size = 0.25
    ko = bpy.data.objects.new("Key", key)
    ko.location = (0.18, -0.22, 0.28)
    ko.rotation_euler = (math.radians(50), 0, math.radians(38))
    bpy.context.collection.objects.link(ko)

    fill = bpy.data.lights.new("Fill", type="AREA")
    fill.energy = 0.5
    fill.size = 0.35
    fo = bpy.data.objects.new("Fill", fill)
    fo.location = (-0.25, -0.18, 0.10)
    fo.rotation_euler = (math.radians(75), 0, math.radians(-52))
    bpy.context.collection.objects.link(fo)

    world = bpy.data.worlds.new("W")
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs[0].default_value = (0.55, 0.58, 0.62, 1.0)
        bg.inputs[1].default_value = 0.25
    bpy.context.scene.world = world


def add_camera_front(px_w, px_h):
    """正面・平行投影。絵と1:1で重ねて比較するためのカメラ。"""
    cam = bpy.data.cameras.new("Cam_Front")
    cam.type = "ORTHO"
    cam.ortho_scale = W          # 画面幅 = 箱の幅
    cam.clip_start = 0.001
    cam.clip_end = 10.0
    obj = bpy.data.objects.new("Cam_Front", cam)
    obj.location = (0.0, -0.5, H / 2)
    obj.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.collection.objects.link(obj)
    bpy.context.scene.camera = obj
    bpy.context.scene.render.resolution_x = px_w
    bpy.context.scene.render.resolution_y = px_h
    return obj


def add_camera_three_quarter(px_w, px_h):
    cam = bpy.data.cameras.new("Cam_34")
    cam.type = "PERSP"
    cam.lens = 50
    cam.clip_start = 0.001
    cam.clip_end = 10.0
    obj = bpy.data.objects.new("Cam_34", cam)
    obj.location = (0.16, -0.20, 0.13)
    direction = Vector((0.0, 0.0, H * 0.45)) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(obj)
    bpy.context.scene.camera = obj
    bpy.context.scene.render.resolution_x = px_w
    bpy.context.scene.render.resolution_y = px_h
    return obj


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"[render] {path}")


# ---------------------------------------------------------------- main

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    reset_scene()

    body = build_body()
    lid = build_lid()
    occ = build_occluder()
    shade_smooth(lid)

    add_lights()
    setup_render()

    # 1. 正面平行投影（絵と重ねて検証する）
    add_camera_front(1600, 1201)
    render_to(os.path.join(OUT_DIR, "box_front"))

    # 2. 蓋を開けた斜め視点
    lid.rotation_euler = (math.radians(-72), 0, 0)
    add_camera_three_quarter(1200, 900)
    render_to(os.path.join(OUT_DIR, "box_open_34"))

    # 3. 閉じた斜め視点
    lid.rotation_euler = (0, 0, 0)
    render_to(os.path.join(OUT_DIR, "box_closed_34"))

    blend_path = os.path.join(OUT_DIR, "box_v001.blend")
    if os.path.exists(blend_path):
        print(f"[skip-save] 既存ファイルを上書きしません: {blend_path}")
    else:
        bpy.ops.wm.save_as_mainfile(filepath=blend_path)
        print(f"[save] {blend_path}")

    print("")
    print("=== 生成物 ===")
    for o in bpy.data.objects:
        if o.type == "MESH":
            print(f"  {o.name}: 頂点 {len(o.data.vertices)} / 面 {len(o.data.polygons)}")
    print(f"  箱: {W*1000:.1f} x {H*1000:.1f} x {D*1000:.1f} mm")
    print(f"  蓋 {LID_H*1000:.1f}mm / 本体 {BODY_H*1000:.1f}mm")


if __name__ == "__main__":
    main()
