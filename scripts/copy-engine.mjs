/**
 * 8th Wall Distributed Engine Binary をセルフホスト用にコピーする。
 *
 * ライセンス条件（XR Engine License Agreement）:
 *   - 再配布は「Niantic Spatial が配布した original form のまま」に限る
 *   - 改変・派生物作成は禁止
 * → このスクリプトはファイルを *そのまま* コピーするだけで、一切加工しない。
 *
 * プロファイル:
 *   full (既定) … dist 配下を丸ごとコピー。404 リスクゼロ。Phase 2 の検証中はこれ。
 *   slam        … SLAM + Image Targets に必要そうなものだけ。Phase 7 の最適化用。
 *                 実際に必要なファイルは Phase 3 でネットワークログを見て確定する。
 */
import {cp, mkdir, rm, stat, readdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'node_modules', '@8thwall', 'engine-binary', 'dist')
const destXr = path.join(root, 'public', 'external', 'xr')
const destLicense = path.join(root, 'public', 'LICENSES', '8thwall-license.txt')

const profile = process.env.XR_PROFILE ?? 'full'

const SLAM_FILES = [
  'LICENSE',
  'xr.js',
  'xr-slam.js',
  'resources/media-worker.js',
  'resources/powered-by.svg',
]

async function dirSize(dir) {
  let total = 0
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const p = path.join(dir, entry.name)
    total += entry.isDirectory() ? await dirSize(p) : (await stat(p)).size
  }
  return total
}

if (!existsSync(src)) {
  console.error(`[copy-engine] 見つかりません: ${src}`)
  console.error('[copy-engine] 先に `npm install` を実行してください。')
  process.exit(1)
}

await rm(destXr, {recursive: true, force: true})
await mkdir(destXr, {recursive: true})

if (profile === 'slam') {
  for (const rel of SLAM_FILES) {
    const from = path.join(src, rel)
    if (!existsSync(from)) {
      console.warn(`[copy-engine] スキップ（存在せず）: ${rel}`)
      continue
    }
    const to = path.join(destXr, rel)
    await mkdir(path.dirname(to), {recursive: true})
    await cp(from, to)
  }
} else {
  await cp(src, destXr, {recursive: true})
}

// 著作権表示用に LICENSE を配布物へ同梱する（ライセンス要件）
await mkdir(path.dirname(destLicense), {recursive: true})
await cp(path.join(src, 'LICENSE'), destLicense)

const mb = (await dirSize(destXr) / 1024 / 1024).toFixed(2)
console.log(`[copy-engine] profile=${profile} → public/external/xr (${mb} MB)`)
