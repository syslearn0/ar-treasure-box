/**
 * @8thwall/image-target-cli を非対話で駆動するラッパー。
 *
 * 本家CLIは完全に対話式でフラグを一切受け付けないが、readline が行をバッファする
 * 実装なので、標準入力へ回答を順に流し込めば再現可能な形で回せる。
 * Phase 1（本番の箱）と Phase 2b（差し替え）で同じ手順を再実行できるようにする。
 *
 * 使い方:
 *   node scripts/make-target.mjs <画像パス> [ターゲット名] [--landscape]
 *
 * 【横長ターゲットの注意】
 * CLI の既定クロップは常に 3:4 の *縦* になる（getDefaultCrop のソースで確認）。
 * 横長の箱を 4:3 で取り込むには orientation に landscape を選ぶ必要があり、
 * これは「既定クロップを使わない」と答えたときにしか訊かれない。
 * そのため --landscape ではクロップ範囲を明示的に流し込む。
 *
 * 出力先: public/image-targets/
 *   <name>.json               ← アプリが fetch する
 *   <name>_luminance.jpg      ← エンジンが imagePath 経由で取りに行く（追跡に使う実体）
 *   <name>_cropped.jpg / _thumbnail.jpg / _original.jpg
 *
 * 重要な仕様（CLI のソースから実測）:
 *   - FLAT ターゲットのクロップは 3:4（縦）か 4:3（横）に *強制* される
 *   - クロップ後の最小サイズは 480 x 640 px
 *   - 生成JSONの imagePath は "image-targets/<name>_luminance.jpg" という
 *     ページからの相対URL。よって出力フォルダ名は image-targets でなければならない。
 */
import {spawn} from 'node:child_process'
import sharp from 'sharp'
import path from 'node:path'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const imagePath = process.argv[2]
const name = process.argv[3] ?? 'box'

if (!imagePath) {
  console.error('使い方: node scripts/make-target.mjs <画像パス> [ターゲット名]')
  process.exit(1)
}
const absImage = path.resolve(imagePath)
if (!existsSync(absImage)) {
  console.error(`画像が見つかりません: ${absImage}`)
  process.exit(1)
}

const outDir = path.join(root, 'public', 'image-targets')

const landscape = process.argv.includes('--landscape')

let answers
if (landscape) {
  // 横長 4:3。CLI は visualWidth から視覚的な高さを width*3/4 として自動計算する。
  const meta = await sharp(absImage).metadata()
  const visualWidth = meta.width
  const visualHeight = Math.round((visualWidth * 3) / 4)
  if (visualHeight > meta.height) {
    console.error(
      `画像が横長すぎます。4:3 にするには高さ ${visualHeight}px 必要ですが ${meta.height}px しかありません。`
    )
    process.exit(1)
  }
  answers = [
    absImage, // Enter the path to the image file:
    'flat', // Select the image type:
    'n', // Use default crop? [Y/n]  ← landscape を選ぶために既定を使わない
    'landscape', // Select the image orientation of the trackable region:
    String(Math.round((meta.height - visualHeight) / 2)), // top offset（縦方向に中央寄せ）
    '0', // left offset
    String(visualWidth), // width
    outDir, // Enter the output folder:
    name, // Enter a name for the image target:
  ]
  console.log(`[make-target] 横長 4:3 モード: ${visualWidth} x ${visualHeight}`)
} else {
  // 縦長 3:4（CLI の既定クロップ）
  answers = [
    absImage, // Enter the path to the image file:
    'flat', // Select the image type:
    'y', // Use default crop? [Y/n]
    outDir, // Enter the output folder:
    name, // Enter a name for the image target:
  ]
}

const cliEntry = path.join(root, 'node_modules', '@8thwall', 'image-target-cli', 'src', 'index.js')

const child = spawn(process.execPath, [cliEntry], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: {...process.env, OVERWRITE_FILES: 'true'},
})

child.stdin.write(`${answers.join('\n')}\n`)
child.stdin.end()

child.on('exit', (code) => {
  if (code === 0) {
    console.log('')
    console.log(`[make-target] 出力: public/image-targets/${name}.json`)
    console.log('[make-target] src/config.ts の TARGET.name / TARGET.url を確認してください。')
  }
  process.exit(code ?? 1)
})
