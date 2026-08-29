/**
 * Phase 3 の試験公開用ビルド。デバッグHUDを残したまま本番と同じ静的出力を作る。
 * 本番公開時は `npm run build`（HUDなし）を使う。
 */
process.env.VITE_DEBUG = '1'
const {build} = await import('vite')
await build()
console.log('')
console.log('[build:debug] デバッグHUD付きでビルドしました。本番公開時は npm run build を使ってください。')
