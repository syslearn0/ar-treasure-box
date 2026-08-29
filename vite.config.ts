import {defineConfig} from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

/**
 * `npm run dev`   … http://localhost:5173（PC での UI 確認用。ARは動かない）
 * `npm run dev:https` … https://<LAN-IP>:5173（スマホ実機での AR 検証用）
 *
 * 8th Wall はデスクトップOSを非対応として弾く（UNSUPPORTED_OS）ため、
 * AR の動作確認は必ず実機で行う。カメラは HTTPS でしか起動しない。
 */
const useHttps = process.env.VITE_HTTPS === '1'

export default defineConfig({
  // サブディレクトリ配置でも動くよう、全参照を相対URLにする（Xserver 配置要件）
  base: './',
  plugins: useHttps ? [basicSsl()] : [],
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
  },
})
