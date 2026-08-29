# たからばこ — WebAR カード

紙のカードに描いた木箱をスマホのカメラで映すと、**箱がその場で立体になり、
中からキャラクターが飛び出して、背中に隠していた手紙を広げて頭上に掲げる**。
アプリのインストールは不要で、QR から開いたブラウザだけで動く。

一度認識してしまえば、あとはカードを画面から外しても**モデルは机の上のその場所に残る**。
横から覗いても、後ろに回り込んでも、そこに置いてあるように見える。

| | |
|---|---|
| AR エンジン | 8th Wall Distributed Engine Binary 1.0.0（セルフホスト・無改変） |
| トラッキング | SLAM World Tracking + Image Targets |
| 3D | Three.js 0.185 |
| ビルド | Vite 8 + TypeScript |
| 配信 | 静的ホスティングのみ。Node.js も Docker も DB も不要 |
| 対応 | iOS Safari / Android Chrome（**デスクトップは非対応**） |

> **はじめて触る人へ** — プログラミング未経験でも自分の Blender モデルを差し替えられるよう、
> 手順とつまずきどころをまとめた **[docs/getting-started.md](docs/getting-started.md)** を用意しています。
> まずはそちらから。

iOS Safari には `immersive-ar` の WebXR が無いので、WebXR は使っていない。
8th Wall が `getUserMedia` のカメラ映像から自前で SLAM を回している。

---

## 中核の設計

**画像認識は「最初の姿勢を一度だけ決める」ためにしか使わない。**
以後の追従は SLAM に任せる。

```
scene
 ├ camera      ← SLAM が毎フレーム更新する
 └ anchorRoot  ← scene の直下。姿勢を一度決めたら以後は動かさない
      └ 箱・キャラクター・手紙
```

`anchorRoot` は画像ターゲットの**子ではない**。ここが全部の肝で、
子にしてしまうと画像が画面外に出た瞬間に姿勢の更新が止まり、モデルが飛ぶ。
`imagelost` で `visible` を触ることも絶対にしない。

実装は [src/xr/imageAnchor.ts](src/xr/imageAnchor.ts)。

### 姿勢を確定させるまでの条件

一発の認識結果をそのまま採用すると、SLAM が収束しきる前の値を掴んで壊れる。
実測では、収束前の `detail.scale` が 0.327〜3.92 と **12 倍**振れていた。
そこで以下を全部満たすまで確定を保留する。

- 400ms 以上・6 サンプル以上たまっている
- 位置のばらつきが 2cm 未満
- スケール推定の max/min が 1.25 倍以内に収束している（**中央値**を採用する）

しきい値は**メートル**で書く。8th Wall のワールド単位はメートルではなく、
実測で 2.7〜8.4 倍の開きがあったので、`worldToMeters()` を通してから比較する。
これを忘れると `2cm` のつもりが実質 `2.4mm` になって、まず認識が通らない。

---

## セットアップ

```bash
npm install
```

`npm install` すると `@8thwall/engine-binary` が入る。各コマンドの先頭で
`scripts/copy-engine.mjs` が走り、それを `public/external/xr/` へ**無加工でコピー**する
（改変禁止のライセンス条項があるため、ビルドのバンドル対象にもしていない）。

```bash
npm run dev
```

PC で UI だけ確認する用（`http://localhost:5173`）。**AR は動かない** —
8th Wall がデスクトップ OS を `UNSUPPORTED_OS` として弾くため。

```bash
npm run dev:https
```

スマホ実機で AR を検証する用。表示される `https://<LAN-IP>:5173` をスマホで開く。
自己署名証明書なので警告を一度許可する。カメラは HTTPS でしか起動しない。

```bash
npm run build
```

`dist/` を生成。これをそのまま静的ホスティングへ置く。

```bash
npm run build:debug
```

画面左上にデバッグ HUD（追跡状態・再アンカー回数・ズレ・FPS）を出したままビルドする。
実機で数値を確認したいときはこちら。

---

## 自分のカードを作る

### 1. カードを用意する

```bash
node scripts/make-postcard.mjs "https://example.com/ar/"
```

`work/art/box.png` の絵と、渡した URL の QR を組んで 2 枚出す。

| 出力 | 用途 |
|---|---|
| `work/postcard.png`（100×148mm / 300dpi） | 紙に印刷する |
| `work/postcard-target-region.png`（追跡領域の切り出し） | タブレットの画面に表示する |

**タブレットに表示するのがいちばん手軽で、認識も速い。** 実寸が大きく取れるためで、
刷り直しもいらない。紙に印刷する場合は必ず実寸 100%（「用紙に合わせる」をオフ）で刷る。

いずれの場合も、**追跡領域の実寸を定規で測って `src/config.ts` の `CARD_WIDTH_M` に入れる**。
画面表示なら端末と表示倍率で変わるので、測るしかない。印刷なら既定レイアウトで 0.088。

カードには文章を書かない。代わりに、白地は特徴点ゼロの死に領域になるので、
手描き風の枠ときらめきで埋めて特徴量を稼いでいる。

### 2. 画像ターゲットを作る

**印刷したものを撮影・スキャンした画像から作ること。** 元のデジタル画像から
作ると、紙の質感や印刷の滲みが乗らず、実機での認識率が落ちる。

```bash
npm run target work/postcard-target-region.png card
```

`public/image-targets/` に `card.json` と `card_luminance.png` ほかが出る。

```bash
node scripts/analyze-target.mjs work/postcard-target-region.png
```

FAST-9 の特徴点数・8×8 グリッドの被覆率・縮小耐性・記述子の弁別性を測る。
「なんとなく良さそう」で進めないための道具。

### 3. 中身を差し替える

編集するのは [src/config.ts](src/config.ts) **だけ**でよい。

```ts
export const MESSAGE = {
  label: 'MESSAGE',      // 見出しの上に小さく出る一言
  heading: 'ありがとう',  // いちばん大きく出る一行
  lines: [],             // 続く行
}
```

手紙の文字は GLB に焼き込んでいない。Web 側の `CanvasTexture` で毎回描いて
紙のメッシュに貼っているので、文面を変えても Blender を触る必要はない。

複数のカードを同時に載せて、当たった `detail.name` で内容を出し分けることもできる。
`TARGETS` に足すだけ（3 件同時までは実機で確認済み。上限は未計測）。

---

## ファイルの役割

### 実行時（ブラウザに届くもの）

| ファイル | 役割 |
|---|---|
| [index.html](index.html) | エンジンの読み込み、著作権表示、UI の DOM 一式 |
| [src/main.ts](src/main.ts) | 全体の指揮。他のファイルは互いをほとんど参照せず、ここが繋ぐ |
| [src/config.ts](src/config.ts) | 差し替えポイントの集約。**中身を変えるときはここだけ** |
| [src/xr/imageAnchor.ts](src/xr/imageAnchor.ts) | 核心。認識結果を貯めて姿勢を一度だけ確定させる |
| [src/xr/engineLoader.ts](src/xr/engineLoader.ts) | エンジンの読み込み待ちと、非対応理由の日本語化 |
| [src/xr/trackingState.ts](src/xr/trackingState.ts) | 追跡状態のステートマシン |
| [src/scene/avatar.ts](src/scene/avatar.ts) | GLB の読み込み、向き合わせ、Intro→Idle の繋ぎ |
| [src/scene/messageTexture.ts](src/scene/messageTexture.ts) | 日本語メッセージを Canvas に描いてテクスチャにする |
| [src/ui/overlay.ts](src/ui/overlay.ts) | 状態に応じた画面 UI |
| [src/ui/debugHud.ts](src/ui/debugHud.ts) | 実測用の数値表示（本番ビルドでは除去される） |

### ビルド時（ブラウザには届かない）

| ファイル | 役割 |
|---|---|
| [scripts/copy-engine.mjs](scripts/copy-engine.mjs) | 8th Wall のバイナリを**無加工で**コピー |
| [scripts/make-postcard.mjs](scripts/make-postcard.mjs) | 印刷用カードと追跡領域の切り出しを、同じ寸法データから生成 |
| [scripts/make-target.mjs](scripts/make-target.mjs) | 対話式の image-target CLI に答えを流し込む |
| [scripts/analyze-target.mjs](scripts/analyze-target.mjs) | 画像ターゲットの品質を数値で測る |
| [work/blender/*.py](work/blender) | 箱・キャラ・リグ・アニメを順番に組み上げる。`blender --background --python` で実行 |

### 黙って壊れる依存関係

型では守れないので、片方を変えたらもう片方も直すこと。

| A | B |
|---|---|
| `config.ts` の `CARD_WIDTH_M` | 実際に映しているカードの実寸（画面上の幅／印刷物の幅） |
| `config.ts` の比率定数（`BOX_WIDTH_RATIO` ほか） | `make-postcard.mjs` のレイアウト定数 |
| `config.ts` の `MODEL_BOX_WIDTH_M` | Blender で作った箱モデルの実寸 |
| `avatar.ts` の `INTRO` / `IDLE` のフレーム範囲 | `work/blender/07_idle_animation.py` のフレーム番号 |

`physicalWidthM` / `AVATAR.offset` / `AVATAR.scale` は `CARD_WIDTH_M` から導出しているので、
実寸が変わったときに直すのは 1 箇所でよい。

---

## 配置

`dist/` の中身をそのままドキュメントルート配下に置くだけ。サーバー側に要るものは何もない。

```
dist/
├─ index.html
├─ .htaccess          ← HTTPS 転送・MIME・キャッシュ。隠しファイルなので上げ忘れに注意
├─ assets/            app-[hash].js / index-[hash].css / postcard_proxy.glb
├─ image-targets/     card.json + card_luminance.png ほか
├─ external/xr/       8th Wall エンジン（無改変）
└─ LICENSES/          8thwall-license.txt
```

`vite.config.ts` で `base: './'` にしてあるので、サブディレクトリに置いても動く。
カメラは HTTPS でしか起動しないので、公開先が HTTPS であることだけ確認する。

Apache 以外（Nginx など）に置く場合は `.htaccess` の代わりに、
`.glb` → `model/gltf-binary`、`.wasm` → `application/wasm` の MIME 設定を移植すること。

Xserver 共有サーバーへ置く場合の具体的な手順は
[docs/deploy-xserver.md](docs/deploy-xserver.md)。

---

## ドキュメント

- [docs/getting-started.md](docs/getting-started.md) — 非エンジニア向けの手引き。環境構築から自分のモデルの差し替えまで
- [docs/measurements.md](docs/measurements.md) — 実機での実測記録。「安定した」を主観で判断しないための記録簿
- [docs/phase1-box-design.md](docs/phase1-box-design.md) — 認識しやすい箱の絵の条件
- [docs/blender-mcp.md](docs/blender-mcp.md) — Blender を MCP 経由で操作する構成と、詰まった点

---

## ライセンス

`public/external/xr/` に置かれるものは **8th Wall Distributed Engine Binary**
（Copyright © 2026 Niantic Spatial, Inc.）であり、XR Engine License Agreement に従う。
リポジトリには含めていない（`npm install` で各自が取得する）。

- 再配布は Niantic Spatial が配布した原形のままに限る（**改変禁止**）
- 著作権表示が必須 → `index.html` のコメントとフッターに記載済み
- ライセンス全文 → [LICENSES/8thwall-license.txt](LICENSES/8thwall-license.txt)
- 個人的・非商用の利用を前提とする

`scripts/copy-engine.mjs` はファイルを一切加工せずコピーするだけ。
Vite のバンドル対象からも外してある。
