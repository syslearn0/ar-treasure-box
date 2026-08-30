import {defineConfig} from 'vite'
// @ts-expect-error 開発サーバー専用。型定義は持たない
import {ensureDevCert} from './scripts/dev-cert.mjs'

/**
 * `npm run dev`   … http://localhost:5173（PC での UI 確認用。ARは動かない）
 * `npm run dev:https` … https://<LAN-IP>:5173（スマホ実機での AR 検証用）
 *
 * 8th Wall はデスクトップOSを非対応として弾く（UNSUPPORTED_OS）ため、
 * AR の動作確認は必ず実機で行う。カメラは HTTPS でしか起動しない。
 *
 * 【HTTPS について — 実測で判明】
 * @vitejs/plugin-basic-ssl は使わない。あれが作る証明書の SAN は
 * localhost / 127.0.0.1 だけで、**LAN の IP が入らない**。
 * PC のブラウザは名前不一致の警告を押し通せるが、iOS Safari は通さないため
 * 「PCでは開けるのに iPad では開けない」になる。
 * 実際、iPad からの TLS 握手は `certificate unknown`（alert 46）で落ちていた。
 * 代わりに scripts/dev-cert.mjs が、この端末の全 LAN IP を SAN に入れた証明書を作る。
 */
const useHttps = process.env.VITE_HTTPS === '1'

export default defineConfig(async () => {
  const https = useHttps ? await ensureDevCert() : null

  return {
    // サブディレクトリ配置でも動くよう、全参照を相対URLにする（Xserver 配置要件）
    base: './',
    build: {
      target: 'es2020',
      assetsDir: 'assets',
      // 8th Wall のバイナリは public/ 経由でそのまま出力されるため、
      // Vite のバンドル対象には含めない（改変禁止条項の遵守）
      rollupOptions: {
        output: {
          entryFileNames: 'assets/app-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      https: https ? {key: https.key, cert: https.cert} : undefined,
    },
  }
})
