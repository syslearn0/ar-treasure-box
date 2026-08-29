# Xserver（共有レンタルサーバー）への配置手順

公開先の例: **`https://<サーバーID>.xsrv.jp/ar/`**（サブディレクトリ方式）

このURLは最終的にQRコードへ焼き込むので、**印刷したら以後は変更しない**。

---

## 1. ビルド

### 試験公開（Phase 3）— デバッグHUDあり

```bash
npm run build:debug
```

実機で数値を確認する必要があるので、Phase 3 ではこちらを使う。

### 本番公開（Phase 8）— デバッグHUDなし

```bash
npm run build
```

HUDがバンドルから除去されていることは、ビルド後に自動で確認できる:

```bash
grep -q "debug-hud" dist/assets/*.js && echo "NG: HUDが残存" || echo "OK: HUD除去済み"
```

---

## 2. アップロード

`dist/` の**中身**を、Xserver の以下の場所へ丸ごと置く。

FTP でも、サーバーパネルの「ファイルマネージャ」でもよい。

### 実際にたどる場所

メインFTPアカウントで接続すると、**いきなり「ドメイン名」フォルダが並んだ状態**から始まる。
`/home/<サーバーID>/` の部分はログイン時点で通過済みなので、自分で入力する必要はない。

```
<サーバーID>.xsrv.jp/          ← ログイン直後に見えるフォルダ
└─ public_html/                ← ドキュメントルート
   └─ ar/                      ← ここに dist/ の中身を置く
```

参考: サーバー内部の絶対パスは `/home/<サーバーID>/<サーバーID>.xsrv.jp/public_html/ar/` だが、
これは FTP やファイルマネージャの操作では入力しない。

出典: [ホームページのファイルはどこへアップロードすればいいですか？](https://www.xserver.ne.jp/support/faq/service_ftp_setting_upload.php) /
[public_html フォルダとは何ですか？](https://www.xserver.ne.jp/support/faq/service_ftp_public_html_folder.php)

### ⚠️ 必ず守ること

1. **`.htaccess` を忘れない。** 隠しファイルなので、FTPクライアントの設定で
   「隠しファイルを表示」を有効にしないと見落とす。これが無いと HTTPS 転送と
   MIME 設定が効かない。
2. **`dist` フォルダごとではなく、中身を置く。** `public_html/ar/index.html` に
   なるのが正しい。`public_html/ar/dist/index.html` は誤り。
3. **フォルダ構造をそのまま維持する。** `external/xr/` `image-targets/` `assets/`
   `LICENSES/` の階層が崩れると動かない。

### アップロード内容（23ファイル / 約31MB）

```
ar/
├─ index.html
├─ .htaccess                    ← 忘れやすい
├─ assets/
│  ├─ app-[hash].js
│  └─ index-[hash].css
├─ image-targets/
│  ├─ card.json                  ← アプリが fetch する
│  ├─ card_luminance.png         ← エンジンが追跡に使う実体
│  ├─ card_cropped.png / card_original.png / card_thumbnail.png
├─ external/xr/                 ← 8th Wall エンジン（無改変）
│  ├─ xr.js / xr-slam.js / xr-face.js
│  ├─ LICENSE
│  └─ resources/
└─ LICENSES/
   └─ 8thwall-license.txt
```

31MB のうち実際にブラウザがダウンロードするのは **約7.1MB**。
`xr-face.js`(7.7MB) と `resources/` の tflite モデル群は face チャンク未使用のため読まれない。
不要ファイルの削除は Phase 7 で、実機のネットワークログを見てから行う（今削ると 404 のリスク）。

---

## 3. 確認

`https://<サーバーID>.xsrv.jp/ar/` を iPhone / iPad の Safari で開く。

### チェックリスト

- [ ] **HTTPS で開ける**（`http://` で開いても `https://` へ転送される）
- [ ] 「カメラを起動する」ボタンが出る
- [ ] カメラ許可ダイアログが出る（自己署名証明書ではないので警告が出ないこと）
- [ ] 画像ターゲットを認識して立方体が出る
- [ ] ターゲットを画面外にしても立方体が残る
- [ ] Android Chrome でも動く ← **Phase 2a で未確認の項目。ここで確認する**
- [ ] 再スキャン / 再センターが動く

### 404 / MIME エラーの確認

iPhone は Mac Safari のリモートインスペクタ、Android は `chrome://inspect` で
ネットワークタブを見る。Mac が無い場合は、画面に出る診断表示で切り分ける。

想定される問題:

| 症状 | 原因 | 対処 |
|---|---|---|
| **ページ全体が 500 Internal Server Error** | 共有サーバーでは `.htaccess` の一部ディレクティブが許可されないことがある | `.htaccess` の **`Options -Indexes` の行を削除**して再アップロード。それでも直らなければ `<IfModule mod_headers.c>` ブロックごと削除して切り分ける |
| 「ARエンジンを読み込めませんでした」 | `external/xr/xr.js` が 404 | フォルダ構造を確認 |
| 「画像ターゲットを読み込めませんでした」 | `image-targets/card.json` が 404 | 同上 |
| 認識するがモデルが出ない | `card_luminance.png` が 404 | JSON の `imagePath` はページ相対URL。`image-targets/` という名前でなければならない |
| カメラが起動しない | HTTPS になっていない | `.htaccess` を上げ忘れていないか |

---

## 4. Xserver 側の前提

- **無料独自SSL** が初期ドメイン `<サーバーID>.xsrv.jp` に対して有効になっていること
  （サーバーパネル →「SSL設定」で確認。反映に最大1時間程度かかる場合がある）
- サーバー側に常駐プロセスは一切不要。Node.js も Docker も DB も使わない
- ビルドはすべて手元のPCで行い、出来上がった静的ファイルを置くだけ

---

## 5. 更新するとき

`index.html` と `image-targets/` は `.htaccess` で短命キャッシュにしてあるので、
差し替えればすぐ反映される。`assets/` はファイル名にハッシュが付くため
長期キャッシュでも衝突しない。

エンジン (`external/xr/`) はバージョン固定なので、`package-lock.json` の
`@8thwall/engine-binary` を上げない限り再アップロード不要。
