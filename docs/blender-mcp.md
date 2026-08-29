# Blender MCP 接続

Blender 公式の MCP サーバー（[blender.org/lab/mcp-server](https://www.blender.org/lab/mcp-server/)）を
Claude Code から使うための設定。**設定は完了済み**。

---

## 構成

公式実装は2つの部品に分かれ、TCP ソケットで通信する。

```
Claude Code  ⇐ MCP/stdio ⇒  blender-mcp  ⇐ TCP:9876 ⇒  Blender アドオン
```

| 部品 | 実体 | 場所 |
|---|---|---|
| Blender アドオン | 拡張機能 `mcp` v1.0.0 | Blender 内（インストール済み・有効化済み・自動起動ON） |
| MCP サーバー | `blender-mcp.exe` | `%USERPROFILE%\.blender-mcp\venv\Scripts\` |
| ソース | 公式リポジトリの複製 | `%USERPROFILE%\.blender-mcp\src\` |
| Claude Code 設定 | `.mcp.json` | プロジェクト直下 |

---

## 導入時に踏んだ問題と対処（再現用の記録）

| 問題 | 対処 |
|---|---|
| `extensions.blender.org` に `mcp` が無い | 公式リポジトリ `projects.blender.org/lab/blender_mcp` から取得し、`blender --command extension build` でビルドして `install-file` |
| `extension sync` が「オンラインアクセスが必要」で失敗 | `--online-mode` を付ける。恒久対応として `preferences.system.use_online_access = True` を保存済み |
| `pip install` が wheel ビルドで失敗 | Windows のパス長 260 文字制限。長い一時ディレクトリではなく短いパス `%USERPROFILE%\.blender-mcp\src` から実行 |
| `ModuleNotFoundError: mcp.server.fastmcp` | MCP SDK 2.x では `FastMCP` が `MCPServer` へ改名。公式アドオンは v1 前提なので `pip install "mcp<2"` で 1.29.1 に固定 |
| アドオン起動が「オンラインアクセスが必要」で失敗 | アドオンの `network` 権限のため。`--online-mode` またはプリファレンス保存で解決 |

---

## 使い方

### 1. Blender を起動する（サーバー側）

**GUI で使う場合**（推奨。作業を目で見られる）

普通に Blender を起動するだけ。自動起動を有効にしてあるので、TCP サーバーが立ち上がる。
確認は `編集 → プリファレンス → アドオン → MCP` のパネル。

**バックグラウンドで使う場合**（画面を出さずに動かす）

```bash
"/c/Program Files/Blender Foundation/Blender 5.1/blender.exe" --online-mode --background <file.blend> --command blender_mcp
```

バックグラウンドモードでは遅延応答が使えず、各リクエストは同期的に完了する必要がある。

### 2. 待ち受けを確認する

```bash
netstat -ano | grep 9876
```

`127.0.0.1:9876 LISTENING` が出ていればOK。

### 3. `.mcp.json` を置く

プロジェクト直下に作る。パスは各自の環境に合わせること（このリポジトリには含めていない）。

```json
{
  "mcpServers": {
    "blender": {
      "type": "stdio",
      "command": "<blender-mcp.exe の絶対パス>",
      "args": []
    }
  }
}
```

### 4. Claude Code を再起動する

`.mcp.json` は**起動時にしか読まれない**。追加後は再起動が必要。
再起動後、プロジェクトスコープの MCP サーバーは初回に承認を求められる。

### 5. 経路を検証する（任意）

```bash
"$HOME/.blender-mcp/venv/Scripts/python.exe" "$HOME/.blender-mcp/test_chain.py"
```

ツール一覧と、Blender 内で実行した Python の結果が出れば正常。

---

## 使えるツール（抜粋）

`execute_blender_code` のほか、以下が公開される。

- `get_objects_summary` / `get_object_detail_summary` — シーンの状態取得
- `get_screenshot_of_window_as_image` / `get_screenshot_of_area_as_image` — 画面キャプチャ
- `render_viewport_to_path` / `render_thumbnail_to_path` — レンダリング
- `jump_to_view3d_object_by_name` — 対象へビューを移動
- `search_api_docs` / `get_python_api_docs` / `search_manual_docs` — API・マニュアル検索

---

## 安全上の注意（計画の要件9）

Blender MCP は **LLM が生成した Python を無防備に実行できる**。以下を守る。

- 専用の作業フォルダを使う → `work/blender/`
- 機密ファイルのない環境で使う
- 最初に `.blend` を別名保存する
- 大規模変更の前にバックアップする
- オブジェクト削除の前に対象を列挙する
- 既存ファイルを上書きしない
- 各工程でレンダリングまたはビューポート画像を確認する
- 一度に完成させず、段階ごとに確認する

---

## MCP を使わない経路（併用可）

ヘッドレススクリプトも引き続き有効で、こちらのほうが再現性が高い。

```bash
"/c/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --python work/blender/01_box.py
```

Phase 4 の箱はこの方式で作った。MCP は対話的な調整・確認に向き、
スクリプトは確定した手順の再実行に向く。用途で使い分ける。

### 日本語ロケールの罠

Blender が日本語UIで動いていると、**ノード名もソケット名もローカライズされる**
（実測: `Principled BSDF` → `プリンシプルBSDF`）。
`nodes.get("Principled BSDF")` は常に `None` を返すため、マテリアル設定が
無言で失敗する。**型（`node.type == "BSDF_PRINCIPLED"`）と
`socket.identifier`（翻訳されない）で引くこと。**

---

## Blender 実装メモ（Phase 4-5 で踏んだ罠）

| 事象 | 原因と対処 |
|---|---|
| マテリアル色が無言で無視され灰色になる | 日本語UIだとノード名・ソケット名がローカライズされる（`Principled BSDF` → `プリンシプルBSDF`）。`node.type == "BSDF_PRINCIPLED"` と `socket.identifier`（翻訳されない）で引く |
| `modifiers.new(..., "SMOOTH_BY_ANGLE")` が enum エラー | 4.1 以降 Geometry Nodes アセット化され modifier enum に無い。`EDGE_SPLIT` + `split_angle` で代替 |
| `scene.render.engine = "BLENDER_EEVEE_NEXT"` が TypeError | 5.1 の enum は `BLENDER_EEVEE` のみ。利用可能な enum を列挙して選ぶ |
| レンダリングが真っ白 | 8.6cm の小さい被写体に対しライトが強すぎた。距離0.25m なら 1W オーダーで足りる。ビュー変換も `AgX` にする |
| **squash と stretch が逆に出る** | **ボーンのローカル軸は Y がボーンの伸びる方向。** 上向きボーンでは `pose_bone.scale = (断面, 縦, 断面)`。世界座標の (x,y,z) と勘違いすると上下が入れ替わる |

### squash / stretch の書き方

```python
def sq(along, cross):
    """along = ボーン方向（縦）の倍率, cross = 断面方向の倍率"""
    return (cross, along, cross)

pb["root"].scale = sq(0.62, 1.28)   # 潰れる
pb["root"].scale = sq(1.45, 0.80)   # 伸びる
```

### 腕ボーンの左右対称（実測）

このリグでは、左右の腕で **X 回転は同符号、Z 回転のみ反転**する。

```python
for side, zs in (("R", 1), ("L", -1)):
    pb[f"upperarm.{side}"].rotation_euler = Euler(
        (math.radians(x_deg), 0, math.radians(z_deg * zs)), "XYZ")
```

理由は静止時のボーン軸:

| | X 軸 | Y 軸（ボーン方向） |
|---|---|---|
| upperarm.R | (0.931, -0.262, 0.253) | (0.262, 0, -0.965) |
| upperarm.L | (0.931, **0.262, -0.253**) | (-0.262, 0, -0.965) |

X 軸の **x 成分は反転していない**（どちらも +0.931）。単純に全軸を符号反転すると
左右非対称になる（実測: 右手が前へ、左手が後ろへ出た）。

### 腕の可動範囲（実測値）

- 腕の全長 23.3mm / 肩の高さ 38mm / 頭頂 76.5mm
- `upperarm` の Z 回転で前額面を掃く。Z=176° 前後で手が最高到達
- 到達最高点は **z ≈ 79mm** で、頭頂をわずかに超える
- ローカル X 回転は **負で前、正で後ろ**（腰の後ろへ手を回す動作に使う）

---

## glTF 書き出しの実測（Phase 5 → Web）

`export_animation_mode="SCENE"` でも**アニメーションは1本にまとまらない。**
オブジェクトごとに分かれる（実測: 5本）。

| クリップ名 | チャンネル | 中身 |
|---|---|---|
| `Chr_Armature` | 39 | 13ボーンの TRS |
| `Chr_Paper` | 4 | translation / rotation / scale / **weights** |
| `Chr_Root` | 1 | translation |
| `Box_Lid` / `Box_Body` | 各1 | rotation |

→ Three.js 側では**全クリップを同じ `AnimationMixer` で同時再生**する。
タイムラインが同一なので同期する。

```js
const mixer = new AnimationMixer(gltf.scene)
for (const clip of gltf.animations) mixer.clipAction(clip).play()
```

### 3種類の駆動がすべて通ることを実測で確認

ボーンペアレント / Shape Key（モーフターゲット）/ オブジェクトのスケール・移動、
いずれも Three.js で正しく再生された。

| 時刻 | morph[Half,Packet] | 紙scale | 紙Y(mm) | 蓋回転 | 本体Y(mm) |
|---|---|---|---|---|---|
| 0.2s | 1, 1 | 0.001 | 26 | 0° | 4 |
| 1.9s | 1, 1 | 0.001 | 26 | -81° | 13.7 |
| 4.6s | 1, 1 | 1 | 48 | -78° | 4 |
| 5.2s | 1, 1 | 1 | 94 | -78° | 4 |
| 5.7s | 0.84, 0 | 1 | 94 | -78° | 4 |
| 6.2s | 0, 0 | 1 | 94 | -78° | 4 |

GLB サイズ 141KB（プロキシ形状・テクスチャなし）。目標 8MB に対して十分な余裕。

### 検証ページ

`glb-test.html` + `src/glbtest.ts`。`npm run dev` で開ける。
Vite は既定で `index.html` だけをビルド対象にするため、**本番ビルドには混入しない**（実測で確認）。

---

## Phase 5 完了時点の実装メモ

### glTF は Y-up。Blender の縦(Z)は Three.js では Y

`export_yup=True` で書き出すため、軸が入れ替わる。

```
Blender Z（縦）  →  Three.js Y
Blender Y（奥行）→  Three.js Z
```

瞬きの検証で `eye.scale.z` を見て「動いていない」と誤判定した。正しくは `scale.y`。
**AR アプリ側で位置や向きを扱うときも同じ変換が効く。**

### Intro と Idle の分け方

Blender 側は1本のタイムラインに並べる（Intro 1-195 / Idle 196-315）。
Web 側で `AnimationUtils.subclip` を使ってフレーム範囲で切り出す。
GLB は1つのままで「Intro は1回・Idle はループ」を実現できる。

```js
const intro = AnimationUtils.subclip(clip, `${clip.name}_Intro`, 1, 195, 30)
const idle  = AnimationUtils.subclip(clip, `${clip.name}_Idle`, 196, 315, 30)
introAction.setLoop(LoopOnce, 1); introAction.clampWhenFinished = true
idleAction.setLoop(LoopRepeat, Infinity)
mixer.addEventListener('finished', () => { /* crossFadeTo で Idle へ */ })
```

**ループの継ぎ目は Blender 側で数値を揃えておくこと。**
f195（Intro 終）== f196（Idle 始）== f315（Idle 終）を実測で確認した。

### ボーンペアレントに matrix_world 代入は効かない

眼鏡を head ボーンに付けようとして、全パーツが原点へ潰れた。
`view_layer.update()` を挟んでも直らない。

→ **既にボーンに付いているメッシュ（`Chr_Head`）の子にする**のが確実。

```python
obj.parent = head_obj
obj.parent_type = "OBJECT"
obj.matrix_parent_inverse = head_obj.matrix_world.inverted()
```

### ワールド座標を定数で置かない

`Chr_Root` のオフセット分だけずれる。**実測した既存オブジェクトの位置を基準にする。**

```python
eye_l = bpy.data.objects["Chr_Eye_L"].matrix_world.translation.copy()
```

### ブラウザペイン非表示時は rAF が止まる

`requestAnimationFrame` が回らないためアニメーションが進まず、
スクリーンショットも撮れない。検証は `mixer.update(dt)` を手動ループで回し、
値を読んで判定する。
